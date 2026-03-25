// Ground truth engine — the hidden simulation.
// Pure functions. No React, no UI.
// Ground truth and perceived state never merge — this is load-bearing.

import { NODE_IDS } from '../data/nodes.js';
import { advancePathogen, initPathogen, isPathodgenCleared } from './pathogen.js';

/**
 * Initialise the ground truth state from a situation definition.
 */
export function initGroundTruth(situationDef) {
  const nodeStates = {};
  for (const nodeId of NODE_IDS) {
    nodeStates[nodeId] = {
      pathogenStrength: 0,
      pathogenType: null,
      inflammation: 0,    // 0-100: caused by responder activity
      isClean: true,
    };
  }

  // Place starting pathogen
  const startingNode = situationDef.pathogen.startingNode;
  nodeStates[startingNode] = {
    pathogenStrength: situationDef.pathogen.startingStrength,
    pathogenType: situationDef.pathogen.type,
    inflammation: 0,
    isClean: false,
  };

  return {
    nodeStates,
    pathogenState: initPathogen(situationDef),
    spleenStress: 0,        // 0-100: accumulated HQ stress from signal volume
    totalCollateral: 0,     // cumulative collateral damage score
    isResolved: false,
    resolutionType: null,   // 'win' | 'coherence_collapse' | 'turn_limit'
    spreadHistory: [],      // [{turn, from, to}] for post-mortem
  };
}

/**
 * Advance ground truth by one turn.
 * Returns { newGroundTruth, events }
 * events: things that happened this turn (spread, etc.) for signal generation
 */
export function advanceGroundTruth(groundTruth, situationDef, deployedCells, turn, routingPressure) {
  const events = [];

  // Advance pathogen
  const prevPathogenState = { ...groundTruth.pathogenState };
  const newPathogenState = advancePathogen(
    groundTruth.pathogenState,
    situationDef,
    deployedCells,
    turn
  );

  // Detect spreads
  for (const [nodeId, p] of Object.entries(newPathogenState)) {
    if (!prevPathogenState[nodeId] && p.strength > 0) {
      events.push({ type: 'spread', to: nodeId, strength: p.strength });
      groundTruth.spreadHistory = [...(groundTruth.spreadHistory ?? []), { turn, to: nodeId }];
    }
  }

  // Update node states from pathogen state
  const newNodeStates = { ...groundTruth.nodeStates };
  for (const nodeId of NODE_IDS) {
    const pathogenHere = newPathogenState[nodeId];
    newNodeStates[nodeId] = {
      ...newNodeStates[nodeId],
      pathogenStrength: pathogenHere?.strength ?? 0,
      pathogenType: pathogenHere?.type ?? null,
      isClean: !pathogenHere || pathogenHere.strength <= 0,
    };
  }

  // Apply responder inflammation
  // Responders cause inflammation at their node — especially without dendritic confirmation
  const updatedNodeStates = applyInflammation(newNodeStates, deployedCells);

  // Update spleen stress from routing pressure
  // routingPressure is a 0-1 value computed by the state layer from recent routing
  const newSpleenStress = Math.min(100, groundTruth.spleenStress + routingPressure * 8);
  const decayedSpleenStress = Math.max(0, newSpleenStress - 3); // slight decay each turn

  // Check resolution
  const pathogenCleared = isPathodgenCleared(newPathogenState);
  const isResolved = pathogenCleared;
  const resolutionType = pathogenCleared ? 'win' : null;

  return {
    newGroundTruth: {
      ...groundTruth,
      nodeStates: updatedNodeStates,
      pathogenState: newPathogenState,
      spleenStress: decayedSpleenStress,
      spreadHistory: groundTruth.spreadHistory ?? [],
      isResolved,
      resolutionType,
    },
    events,
  };
}

function applyInflammation(nodeStates, deployedCells) {
  const result = { ...nodeStates };

  for (const cell of Object.values(deployedCells)) {
    if (cell.type === 'responder' && !cell.inTransit) {
      const nodeId = cell.nodeId;
      if (!result[nodeId]) continue;

      // Responders at clean nodes cause high inflammation (friendly fire)
      // Responders at infected nodes cause low inflammation (appropriate)
      const isClean = result[nodeId].isClean;
      const inflammationIncrease = isClean ? 15 : 5;

      result[nodeId] = {
        ...result[nodeId],
        inflammation: Math.min(100, (result[nodeId].inflammation ?? 0) + inflammationIncrease),
      };
    }
  }

  // Decay inflammation slightly each turn
  for (const nodeId of Object.keys(result)) {
    result[nodeId] = {
      ...result[nodeId],
      inflammation: Math.max(0, (result[nodeId].inflammation ?? 0) - 8),
    };
  }

  return result;
}

/**
 * Get a snapshot of ground truth for post-mortem (safe to expose after game ends).
 */
export function getGroundTruthSnapshot(groundTruth) {
  return {
    nodeStates: { ...groundTruth.nodeStates },
    pathogenState: { ...groundTruth.pathogenState },
    spleenStress: groundTruth.spleenStress,
    spreadHistory: [...(groundTruth.spreadHistory ?? [])],
  };
}

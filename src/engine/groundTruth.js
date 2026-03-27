// Ground truth engine — the hidden simulation.
// Pure functions. No React, no UI.
// Layer 2: multi-situation support, new pathogen types.

import { NODE_IDS } from '../data/nodes.js';
import { advancePathogen, initPathogen, isPathodgenCleared } from './pathogen.js';
import { THREAT_TYPES } from '../data/signals.js';

/**
 * Initialise ground truth for one situation.
 */
export function initGroundTruth(situationDef) {
  const nodeStates = {};
  for (const nodeId of NODE_IDS) {
    nodeStates[nodeId] = {
      pathogenStrength: 0,
      pathogenType: null,
      inflammation: 0,
      isClean: true,
    };
  }

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
    spleenStress: 0,
    totalCollateral: 0,
    isResolved: false,
    resolutionType: null,
    spreadHistory: [],
    turn: 0,
  };
}

/**
 * Advance ground truth one turn.
 * Returns { newGroundTruth, events }
 *
 * @param {Object[]} seededEventsThisTurn - authored ground truth mutations for this turn
 */
export function advanceGroundTruth(groundTruth, situationDef, deployedCells, turn, routingPressure, seededEventsThisTurn = []) {
  const events = [];

  const prevPathogenState = { ...groundTruth.pathogenState };
  let newPathogenState = advancePathogen(
    groundTruth.pathogenState,
    situationDef,
    deployedCells,
    turn,
    groundTruth
  );

  // Apply authored ground truth mutations (seeded events)
  for (const event of seededEventsThisTurn) {
    if (event.type === 'strengthen_pathogen') {
      const existing = newPathogenState[event.nodeId];
      if (existing && existing.strength > 0) {
        newPathogenState = {
          ...newPathogenState,
          [event.nodeId]: { ...existing, strength: Math.min(100, existing.strength + (event.amount ?? 10)) },
        };
      }
    } else if (event.type === 'spawn_pathogen') {
      const existing = newPathogenState[event.nodeId];
      if (!existing || existing.strength <= 0) {
        newPathogenState = {
          ...newPathogenState,
          [event.nodeId]: {
            strength: event.strength ?? 10,
            type: event.pathogenType ?? situationDef.pathogen.type,
          },
        };
      }
    }
  }

  // Detect new spreads
  const spreadHistory = [...(groundTruth.spreadHistory ?? [])];
  for (const [nodeId, p] of Object.entries(newPathogenState)) {
    if (!prevPathogenState[nodeId] && p.strength > 0) {
      events.push({ type: 'spread', to: nodeId, strength: p.strength });
      spreadHistory.push({ turn, to: nodeId });
    }
  }

  // Update node states
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
  const updatedNodeStates = applyInflammation(newNodeStates, deployedCells, situationDef.pathogen.type);

  // Spleen stress from routing pressure
  const newSpleenStress = Math.min(100, groundTruth.spleenStress + routingPressure * 8);
  const decayedSpleenStress = Math.max(0, newSpleenStress - 3);

  const pathogenCleared = isPathodgenCleared(newPathogenState);

  return {
    newGroundTruth: {
      ...groundTruth,
      nodeStates: updatedNodeStates,
      pathogenState: newPathogenState,
      spleenStress: decayedSpleenStress,
      spreadHistory,
      isResolved: pathogenCleared,
      resolutionType: pathogenCleared ? 'win' : null,
      turn,
    },
    events,
  };
}

function applyInflammation(nodeStates, deployedCells, pathogenType) {
  const result = { ...nodeStates };

  // Autoimmune situation: NK cells, Killer T, responders all cause MORE inflammation
  const isAutoimmune = pathogenType === THREAT_TYPES.AUTOIMMUNE;

  for (const cell of Object.values(deployedCells)) {
    const isResponder = ['responder', 'killer_t', 'b_cell', 'nk_cell'].includes(cell.type);
    if (!isResponder || cell.phase !== 'arrived') continue;

    const nodeId = cell.nodeId;
    if (!result[nodeId]) continue;

    const isClean = result[nodeId].isClean;

    let inflammationIncrease;
    if (cell.type === 'killer_t' && isClean) {
      inflammationIncrease = 25; // T-cells attacking self = crisis
    } else if (cell.type === 'nk_cell' && isClean) {
      inflammationIncrease = 15; // NK hitting healthy tissue
    } else if (isClean) {
      inflammationIncrease = 15;
    } else {
      inflammationIncrease = isAutoimmune ? 10 : 5; // autoimmune situation: responders hurt more
    }

    result[nodeId] = {
      ...result[nodeId],
      inflammation: Math.min(100, (result[nodeId].inflammation ?? 0) + inflammationIncrease),
    };
  }

  // Decay
  for (const nodeId of Object.keys(result)) {
    result[nodeId] = {
      ...result[nodeId],
      inflammation: Math.max(0, (result[nodeId].inflammation ?? 0) - 8),
    };
  }

  return result;
}

export function getGroundTruthSnapshot(groundTruth) {
  return {
    nodeStates: { ...groundTruth.nodeStates },
    pathogenState: { ...groundTruth.pathogenState },
    spleenStress: groundTruth.spleenStress,
    spreadHistory: [...(groundTruth.spreadHistory ?? [])],
  };
}

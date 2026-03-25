// Pathogen behaviour — pure functions, no React, no UI.
// Layer 1: bacterial only. Designed to accept other types in Layer 2.

import { NODES } from '../data/nodes.js';

/**
 * Compute new pathogen state after one turn passes.
 * @param {Object} pathogenState - { [nodeId]: { strength, type } }
 * @param {Object} situationDef - the situation definition (pathogen params)
 * @param {Object} deployedCells - current deployed cells state
 * @param {number} turn - current turn number
 * @returns {Object} new pathogen state
 */
export function advancePathogen(pathogenState, situationDef, deployedCells, turn) {
  const def = situationDef.pathogen;
  const newState = {};

  for (const [nodeId, nodePathogen] of Object.entries(pathogenState)) {
    if (!nodePathogen || nodePathogen.strength <= 0) continue;

    // Count responders at this node
    const respondersHere = countRespondersAt(nodeId, deployedCells);
    const clearance = respondersHere * def.clearanceRatePerResponder;

    // Growth minus clearance
    const newStrength = Math.max(0, nodePathogen.strength + def.growthRatePerTurn - clearance);

    if (newStrength > 0) {
      newState[nodeId] = { strength: newStrength, type: def.type };
    }
    // If strength hits 0, node is cleared — don't include in new state
  }

  // Handle spread
  const spreadResult = checkSpread(newState, situationDef, turn);

  return spreadResult;
}

/**
 * Check and apply spread to adjacent nodes.
 */
function checkSpread(pathogenState, situationDef, turn) {
  const def = situationDef.pathogen;
  const result = { ...pathogenState };

  for (const [nodeId, nodePathogen] of Object.entries(pathogenState)) {
    if (nodePathogen.strength >= def.spreadThreshold) {
      const candidates = getSpreadCandidates(nodeId, result, situationDef);
      if (candidates.length > 0) {
        // Spread to first available candidate with a seed amount
        const target = candidates[0];
        if (!result[target] || result[target].strength === 0) {
          result[target] = {
            strength: Math.floor(nodePathogen.strength * 0.3), // seed at 30% of source
            type: def.type,
          };
        }
      }
    }
  }

  return result;
}

/**
 * Get nodes to which pathogen can spread from sourceNodeId.
 * Uses situationDef.pathogen.spreadNodes as ordered preference if available,
 * otherwise uses network connections.
 */
function getSpreadCandidates(sourceNodeId, currentState, situationDef) {
  const def = situationDef.pathogen;
  const sourceNode = NODES[sourceNodeId];
  if (!sourceNode) return [];

  // Use authored spread preference order if defined
  const preferredTargets = def.spreadNodes ?? sourceNode.connections;

  return preferredTargets.filter(targetId => {
    // Must be connected
    if (!sourceNode.connections.includes(targetId)) return false;
    // Don't spread to already-infected nodes
    if (currentState[targetId]?.strength > 0) return false;
    return true;
  });
}

/**
 * Count responders (non-transit) at a given node.
 */
function countRespondersAt(nodeId, deployedCells) {
  return Object.values(deployedCells).filter(
    cell => cell.nodeId === nodeId && cell.type === 'responder' && !cell.inTransit
  ).length;
}

/**
 * Check if pathogen is fully cleared.
 */
export function isPathodgenCleared(pathogenState) {
  return Object.values(pathogenState).every(p => !p || p.strength <= 0);
}

/**
 * Get total pathogen strength across all nodes.
 */
export function getTotalPathogenStrength(pathogenState) {
  return Object.values(pathogenState).reduce((sum, p) => sum + (p?.strength ?? 0), 0);
}

/**
 * Get all infected nodes.
 */
export function getInfectedNodes(pathogenState) {
  return Object.entries(pathogenState)
    .filter(([, p]) => p && p.strength > 0)
    .map(([nodeId, p]) => ({ nodeId, strength: p.strength, type: p.type }));
}

/**
 * Initialise pathogen state from a situation definition.
 */
export function initPathogen(situationDef) {
  const def = situationDef.pathogen;
  return {
    [def.startingNode]: {
      strength: def.startingStrength,
      type: def.type,
    },
  };
}

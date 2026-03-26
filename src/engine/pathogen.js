// Pathogen behaviour — pure functions.
// Layer 2: bacterial, viral, cancer, autoimmune, molecular mimic.

import { NODES } from '../data/nodes.js';
import { CELL_TYPES, getClearancePower } from './cells.js';
import { THREAT_TYPES } from '../data/signals.js';

/**
 * Advance pathogen state one turn.
 * @param {Object} pathogenState - { [nodeId]: { strength, type } }
 * @param {Object} situationDef
 * @param {Object} deployedCells
 * @param {number} turn
 * @param {Object} groundTruth - needed for NK cell effectiveness calculation
 */
export function advancePathogen(pathogenState, situationDef, deployedCells, turn, groundTruth) {
  const def = situationDef.pathogen;
  const newState = {};

  for (const [nodeId, nodePathogen] of Object.entries(pathogenState)) {
    if (!nodePathogen || nodePathogen.strength <= 0) continue;

    const clearance = getClearancePower(nodeId, deployedCells, groundTruth);

    // Type-specific growth behaviour
    const growth = computeGrowth(def, nodePathogen, turn);
    const newStrength = Math.max(0, nodePathogen.strength + growth - clearance);

    if (newStrength > 0) {
      newState[nodeId] = { strength: newStrength, type: nodePathogen.type ?? def.type };
    }
  }

  // Spread
  return checkSpread(newState, situationDef, turn);
}

function computeGrowth(def, nodePathogen, turn) {
  switch (def.type) {
    case THREAT_TYPES.VIRAL:
      // Viral: fast early growth, then slows as immune system activates
      // Replication curve: high in early turns, moderate later
      return def.growthRatePerTurn * (turn < 10 ? 1.3 : 0.8);

    case THREAT_TYPES.CANCER:
      // Cancer: slow linear growth — this is what makes it so dangerous
      return def.growthRatePerTurn; // already set low in situationDef

    case THREAT_TYPES.AUTOIMMUNE:
      // Autoimmune "pathogen" grows proportional to responder deployment
      // (the responders ARE the threat) — handled in groundTruth.js via inflammation
      return def.growthRatePerTurn * 0.5; // slow base — responders amplify it

    case THREAT_TYPES.MIMIC:
      // Mimic: normal growth but hides behind clean signals for first N turns
      return def.growthRatePerTurn;

    case THREAT_TYPES.BACTERIAL:
    default:
      return def.growthRatePerTurn;
  }
}

function checkSpread(pathogenState, situationDef, turn) {
  const def = situationDef.pathogen;
  const result = { ...pathogenState };

  for (const [nodeId, nodePathogen] of Object.entries(pathogenState)) {
    if (nodePathogen.strength < def.spreadThreshold) continue;

    const candidates = getSpreadCandidates(nodeId, result, situationDef);
    if (candidates.length === 0) continue;

    // Viral spreads to ALL adjacent candidates at once (fast spread)
    // Others spread to first candidate only
    if (def.type === THREAT_TYPES.VIRAL) {
      for (const target of candidates.slice(0, 2)) {
        if (!result[target]) {
          result[target] = {
            strength: Math.floor(nodePathogen.strength * 0.25),
            type: def.type,
          };
        }
      }
    } else {
      const target = candidates[0];
      if (!result[target]) {
        result[target] = {
          strength: Math.floor(nodePathogen.strength * 0.3),
          type: def.type,
        };
      }
    }
  }

  return result;
}

function getSpreadCandidates(sourceNodeId, currentState, situationDef) {
  const def = situationDef.pathogen;
  const sourceNode = NODES[sourceNodeId];
  if (!sourceNode) return [];

  const preferredTargets = def.spreadNodes ?? sourceNode.connections;

  return preferredTargets.filter(targetId => {
    if (!sourceNode.connections.includes(targetId)) return false;
    if (currentState[targetId]?.strength > 0) return false;
    return true;
  });
}

// ── Signal accuracy by type ───────────────────────────────────────────────────

/**
 * Get the effective signal accuracy rate for a given pathogen type and strength.
 * Cancer is very quiet. Mimic is silent until late. Viral is intermittent.
 */
export function getSignalAccuracyForType(pathogenType, strength, turn, situationDef) {
  const base = situationDef.signalAccuracyRate ?? 0.70;

  switch (pathogenType) {
    case THREAT_TYPES.CANCER:
      // Cancer barely signals — accuracy drops with low strength
      return strength < 30 ? 0.20 : strength < 60 ? 0.40 : 0.60;

    case THREAT_TYPES.VIRAL:
      // Viral goes quiet during active replication (turns 5-12), then surges
      if (turn >= 5 && turn <= 12) return 0.35;
      return base;

    case THREAT_TYPES.MIMIC:
      // Mimic is completely silent until it crosses a reveal threshold
      if (strength < situationDef.pathogen.mimicRevealThreshold) return 0.05;
      return base;

    case THREAT_TYPES.AUTOIMMUNE:
      // Autoimmune signals well — it's your own immune system making noise
      return 0.90;

    case THREAT_TYPES.BACTERIAL:
    default:
      return base;
  }
}

// ── Queries ───────────────────────────────────────────────────────────────────

export function isPathodgenCleared(pathogenState) {
  return Object.values(pathogenState).every(p => !p || p.strength <= 0);
}

export function getTotalPathogenStrength(pathogenState) {
  return Object.values(pathogenState).reduce((sum, p) => sum + (p?.strength ?? 0), 0);
}

export function getInfectedNodes(pathogenState) {
  return Object.entries(pathogenState)
    .filter(([, p]) => p && p.strength > 0)
    .map(([nodeId, p]) => ({ nodeId, strength: p.strength, type: p.type }));
}

export function initPathogen(situationDef) {
  const def = situationDef.pathogen;
  return {
    [def.startingNode]: {
      strength: def.startingStrength,
      type: def.type,
    },
  };
}

// Ground truth engine — the hidden simulation.
// Pure functions. No React, no UI.
//
// Per-site state: pathogens dict, inflammation, tissueIntegrity, tissueIntegrityCeiling.
// No single-pathogen 'pathogenState' field — all pathogens live inside nodeStates.

import { NODE_IDS } from '../data/nodes.js';
import { advanceInstance, computeSpreads, shouldWallOff, generatePathogenUid, computeNodeClearanceAllocations, computePathogenBreakdown } from './pathogen.js';
import { nodeHasActivePathogen } from '../data/pathogens.js';
import {
  TISSUE_RECOVERY_RATE,
  TISSUE_RECOVERY_INFLAMMATION_REDUCTION,
  TISSUE_SCAR_THRESHOLD,
  TISSUE_SCAR_BONUS,
  INFLAMMATION_DECAY_RATE_INFECTED,
  INFLAMMATION_DECAY_RATE_CLEAR,
  PARASITE_TRANSIT_PENALTY_PER_BURDEN,
} from '../data/gameConfig.js';
import { getEffectiveIntegrityRecovery, getEffectiveInflammationDecayMultiplier } from '../data/runModifiers.js';

// ── Initialisation ─────────────────────────────────────────────────────────────

export function makeCleanSiteState() {
  return {
    pathogens: [],             // PathogenInstance[] — each has uid, type, actualLoad, detected_level, perceived_type, lastKnownLoad
    immune: [],                // uid[] — uids of pathogens cleared from this node (prevents re-spread of same lineage)
    inflammation: 0,           // 0–100
    lastKnownInflammation: 0,  // last observed inflammation (fog-of-war)
    turnsSinceLastVisible: 0,  // turns elapsed since node was last visible
    tissueIntegrity: 100,      // 0–100
    tissueIntegrityCeiling: 100,
    lowestIntegrityReached: 100,
    isWalledOff: false,        // fungi granuloma
    immuneSuppressed: false,   // active parasite above suppression threshold
    transitPenalty: 0,         // extra turns added to deployment (parasite logistics)
  };
}

/** Initialise ground truth for an endless run — all sites start clean. */
export function initGroundTruth() {
  const nodeStates = {};
  for (const nodeId of NODE_IDS) {
    nodeStates[nodeId] = makeCleanSiteState();
  }
  return {
    nodeStates,
    turn: 0,
    spreadHistory: [],
  };
}

// ── Per-node deterministic advancement ────────────────────────────────────────

/**
 * Advance one site's pathogens, inflammation, and tissue integrity for one turn.
 * Shared by advanceGroundTruth (actual) and projection.js (preview).
 * Does NOT handle spreads, spawns, scar ceiling updates, or events — those are
 * managed by advanceGroundTruth only.
 *
 * Returns the updated node values plus pathogenBreakdowns (used by projection UI;
 * ignored by the actual turn engine).
 */
export function advanceNodeSite(ns, nodeId, deployedCells, systemicStress, modifiers = null) {
  const updatedPathogens = [];
  const newImmuneUids = [...(ns.immune ?? [])];
  let totalTissueDamage = 0;
  let totalInflammationAdded = 0;
  let totalToxinOutput = 0;
  let immuneSuppressedThisTurn = false;
  const pathogenBreakdowns = {};

  // Pre-compute equalized clearance allocations across all pathogens at this node.
  const clearanceAllocations = computeNodeClearanceAllocations(
    ns.pathogens ?? [], nodeId, deployedCells, ns, modifiers
  );

  for (const instance of (ns.pathogens ?? [])) {
    const clearanceOverride = clearanceAllocations[instance.uid] ?? null;
    const { newInstance, tissueIntegrityDelta, inflammationDelta, toxinOutput, suppressImmune } =
      advanceInstance(instance, nodeId, deployedCells, ns, systemicStress, modifiers, clearanceOverride);

    pathogenBreakdowns[instance.uid] = computePathogenBreakdown(
      instance, nodeId, deployedCells, ns, systemicStress, modifiers, clearanceOverride
    );

    if (newInstance) {
      updatedPathogens.push(newInstance);
    }

    totalTissueDamage += tissueIntegrityDelta;
    totalInflammationAdded += inflammationDelta;
    totalToxinOutput += toxinOutput;
    if (suppressImmune) immuneSuppressedThisTurn = true;
  }

  // Update inflammation
  const hasInfection = updatedPathogens.length > 0;
  const effectiveInflammationAdd = immuneSuppressedThisTurn ? totalInflammationAdded * 0.5 : totalInflammationAdded;
  const baseDecayRate = hasInfection ? INFLAMMATION_DECAY_RATE_INFECTED : INFLAMMATION_DECAY_RATE_CLEAR;
  const decayRate = baseDecayRate * getEffectiveInflammationDecayMultiplier(nodeId, modifiers);
  const newInflammation = Math.min(100, Math.max(0,
    ns.inflammation + effectiveInflammationAdd - decayRate
  ));

  // Update tissue integrity
  let newIntegrity = ns.tissueIntegrity + totalTissueDamage;
  const recoveryRate = Math.max(0,
    TISSUE_RECOVERY_RATE - Math.floor(newInflammation / TISSUE_RECOVERY_INFLAMMATION_REDUCTION)
  );
  if (recoveryRate > 0) {
    newIntegrity = Math.min(ns.tissueIntegrityCeiling, newIntegrity + getEffectiveIntegrityRecovery(recoveryRate, modifiers));
  }
  newIntegrity = Math.max(0, Math.min(100, newIntegrity));

  // Scar ceiling update
  const newLowest = Math.min(ns.lowestIntegrityReached, newIntegrity);
  let newCeiling = ns.tissueIntegrityCeiling;
  if (newIntegrity < TISSUE_SCAR_THRESHOLD && newLowest < ns.lowestIntegrityReached) {
    newCeiling = Math.min(ns.tissueIntegrityCeiling, newLowest + TISSUE_SCAR_BONUS);
  }

  // Parasite transit penalty
  const parasiteBurden = updatedPathogens.find(i => i.type === 'parasite')?.parasiticBurden ?? 0;
  const transitPenalty = Math.floor(parasiteBurden / PARASITE_TRANSIT_PENALTY_PER_BURDEN);

  return {
    updatedPathogens,
    newImmuneUids,
    immuneSuppressedThisTurn,
    newInflammation,
    newIntegrity,
    newCeiling,
    newLowest,
    transitPenalty,
    toxinOutput: totalToxinOutput,
    pathogenBreakdowns,
  };
}

// ── Turn advancement ───────────────────────────────────────────────────────────

/**
 * Advance ground truth one turn.
 *
 * @param {Object} groundTruth
 * @param {Object} deployedCells
 * @param {number} turn
 * @param {number} systemicStress  — passed in so pathogens can react to it
 * @param {Array}  pendingSpawns   — [{ type, nodeId, initialLoad }] from spawner
 * @returns {{ newGroundTruth, events, perSiteOutputs }}
 *   events: [{ type, nodeId, pathogenType? }]
 *   perSiteOutputs: { [nodeId]: { toxinOutput } } — for systemic stress calculation
 */
export function advanceGroundTruth(groundTruth, deployedCells, turn, systemicStress, pendingSpawns = [], modifiers = null) {
  const events = [];
  let nodeStates = { ...groundTruth.nodeStates };
  const perSiteOutputs = {};

  // ── 1. Advance all pathogen instances ───────────────────────────────────────
  for (const nodeId of NODE_IDS) {
    const ns = { ...nodeStates[nodeId] };

    const {
      updatedPathogens,
      newImmuneUids,
      immuneSuppressedThisTurn,
      newInflammation,
      newIntegrity,
      newCeiling,
      newLowest,
      transitPenalty,
      toxinOutput,
    } = advanceNodeSite(ns, nodeId, deployedCells, systemicStress, modifiers);

    perSiteOutputs[nodeId] = { toxinOutput };

    // Events: granuloma formation and pathogen cleared/walled-off
    let isWalledOff = ns.isWalledOff;
    for (const instance of (ns.pathogens ?? [])) {
      const stillPresent = updatedPathogens.some(p => p.uid === instance.uid);
      if (!stillPresent) {
        events.push({ type: 'pathogen_cleared', nodeId, pathogenType: instance.type });
        if (instance.uid && !newImmuneUids.includes(instance.uid)) {
          newImmuneUids.push(instance.uid);
        }
      } else {
        const updated = updatedPathogens.find(p => p.uid === instance.uid);
        if (updated && shouldWallOff(updated) && !isWalledOff) {
          isWalledOff = true;
          events.push({ type: 'site_walled_off', nodeId, pathogenType: instance.type });
        }
      }
    }
    // Clear walled off status if fungi cleared
    if (isWalledOff && !updatedPathogens.some(i => i.type === 'fungi')) {
      isWalledOff = false;
    }

    nodeStates[nodeId] = {
      ...ns,
      pathogens: updatedPathogens,
      immune: newImmuneUids,
      immuneSuppressed: immuneSuppressedThisTurn,
      isWalledOff,
      inflammation: newInflammation,
      tissueIntegrity: newIntegrity,
      tissueIntegrityCeiling: newCeiling,
      lowestIntegrityReached: newLowest,
      transitPenalty,
    };
  }

  // ── 8. Apply spreads ──────────────────────────────────────────────────────
  const spreads = computeSpreads(nodeStates, modifiers);
  const spreadHistory = [...(groundTruth.spreadHistory ?? [])];
  for (const spread of spreads) {
    const target = nodeStates[spread.toNodeId];
    if (!target) continue;
    // computeSpreads already checked these, but guard against stale state from earlier spreads this tick
    if (target.pathogens.some(i => i.type === spread.type && !isInstanceClearedSimple(i))) continue;
    if (spread.uid && target.immune?.includes(spread.uid)) continue;

    nodeStates[spread.toNodeId] = {
      ...target,
      pathogens: [
        ...target.pathogens,
        makeNewInstance(spread.type, spread.initialLoad, spread.uid),
      ],
    };
    events.push({ type: 'pathogen_spread', from: spread.fromNodeId, to: spread.toNodeId, pathogenType: spread.type });
    spreadHistory.push({ turn, to: spread.toNodeId, from: spread.fromNodeId, pathogenType: spread.type });
  }

  // ── 9. Apply pending spawns from spawner ──────────────────────────────────
  for (const spawn of pendingSpawns) {
    const target = nodeStates[spawn.nodeId];
    if (!target) continue;
    // Only spawn if this pathogen type isn't already active here
    if (target.pathogens.some(i => i.type === spawn.type && !isInstanceClearedSimple(i))) continue;

    nodeStates[spawn.nodeId] = {
      ...target,
      pathogens: [
        ...target.pathogens,
        makeNewInstance(spawn.type, spawn.initialLoad ?? 8),
      ],
    };
    events.push({ type: 'pathogen_spawned', nodeId: spawn.nodeId, pathogenType: spawn.type });
  }

  return {
    newGroundTruth: {
      ...groundTruth,
      nodeStates,
      turn,
      spreadHistory,
    },
    events,
    perSiteOutputs,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────


function makeNewInstance(type, initialLoad, uid = null) {
  return {
    uid: uid ?? generatePathogenUid(),
    type,
    actualLoad: initialLoad,
    detected_level: 'none',
    perceived_type: null,
    lastKnownLoad: null,       // set when node is observed; null = never seen
  };
}

function isInstanceClearedSimple(instance) {
  return (instance.actualLoad ?? 0) <= 0;
}

export function getGroundTruthSnapshot(groundTruth) {
  return {
    nodeStates: { ...groundTruth.nodeStates },
    spreadHistory: [...(groundTruth.spreadHistory ?? [])],
  };
}

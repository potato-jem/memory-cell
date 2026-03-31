// Ground truth engine — the hidden simulation.
// Pure functions. No React, no UI.
//
// Per-site state: pathogens dict, inflammation, tissueIntegrity, tissueIntegrityCeiling.
// No single-pathogen 'pathogenState' field — all pathogens live inside nodeStates.

import { NODE_IDS } from '../data/nodes.js';
import { advanceInstance, computeSpreads, shouldWallOff, generatePathogenUid } from './pathogen.js';
import { nodeHasActivePathogen } from '../data/pathogens.js';
import { CELL_CONFIG } from '../data/cellConfig.js';
import {
  TISSUE_RECOVERY_RATE,
  TISSUE_SCAR_THRESHOLD,
  TISSUE_SCAR_BONUS,
  INFLAMMATION_DAMAGE_THRESHOLD_1,
  INFLAMMATION_DAMAGE_THRESHOLD_2,
  INFLAMMATION_DAMAGE_THRESHOLD_3,
  INFLAMMATION_DAMAGE_RATE_1,
  INFLAMMATION_DAMAGE_RATE_2,
  INFLAMMATION_DAMAGE_RATE_3,
  INFLAMMATION_RECOVERY_THRESHOLD,
  INFLAMMATION_DECAY_RATE_INFECTED,
  INFLAMMATION_DECAY_RATE_CLEAR,
  ATTACK_CELL_INFLAMMATION_ON_INFECTED,
  ATTACK_CELL_INFLAMMATION_ON_CLEAN,
  KILLER_T_INFLAMMATION_ON_CLEAN,
  PARASITE_TRANSIT_PENALTY_PER_BURDEN,
} from '../data/gameConfig.js';
import { getEffectiveIntegrityRecovery } from '../data/runModifiers.js';

// ── Initialisation ─────────────────────────────────────────────────────────────

export function makeCleanSiteState() {
  return {
    pathogens: [],             // PathogenInstance[] — each has uid, type, tracked value, detected_level, perceived_type
    immune: [],                // uid[] — uids of pathogens cleared from this node (prevents re-spread of same lineage)
    inflammation: 0,           // 0–100
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
    const updatedPathogens = [];
    const newImmuneUids = [...(ns.immune ?? [])];
    let totalTissueDamage = 0;
    let totalInflammationAdded = 0;
    let totalToxinOutput = 0;
    let immuneSuppressedThisTurn = false;

    for (const instance of (ns.pathogens ?? [])) {
      const { newInstance, tissueIntegrityDelta, inflammationDelta, toxinOutput, suppressImmune } =
        advanceInstance(instance, nodeId, deployedCells, ns, systemicStress, modifiers);

      if (newInstance) {
        updatedPathogens.push(newInstance);
        // Check for granuloma
        if (shouldWallOff(newInstance) && !ns.isWalledOff) {
          ns.isWalledOff = true;
          events.push({ type: 'site_walled_off', nodeId, pathogenType: instance.type });
        }
      } else {
        events.push({ type: 'pathogen_cleared', nodeId, pathogenType: instance.type });
        // Record immunity to this lineage so the same uid cannot re-spread here
        if (instance.uid && !newImmuneUids.includes(instance.uid)) {
          newImmuneUids.push(instance.uid);
        }
      }

      totalTissueDamage += tissueIntegrityDelta;
      totalInflammationAdded += inflammationDelta;
      totalToxinOutput += toxinOutput;
      if (suppressImmune) immuneSuppressedThisTurn = true;
    }

    // Clear walled off status if fungi cleared
    if (ns.isWalledOff && !updatedPathogens.some(i => i.type === 'fungi')) {
      ns.isWalledOff = false;
    }

    ns.pathogens = updatedPathogens;
    ns.immune = newImmuneUids;
    ns.immuneSuppressed = immuneSuppressedThisTurn;
    perSiteOutputs[nodeId] = { toxinOutput: totalToxinOutput };

    // ── 2. Immune cell inflammation contribution ───────────────────────────────
    const immuneInflammation = computeImmuneCellInflammation(nodeId, deployedCells, ns);
    totalInflammationAdded += immuneInflammation;

    // ── 3. Update inflammation ─────────────────────────────────────────────────
    const hasInfection = updatedPathogens.length > 0;
    const suppressionActive = ns.immuneSuppressed;
    const effectiveInflammationAdd = suppressionActive ? totalInflammationAdded * 0.5 : totalInflammationAdded;
    const decayRate = hasInfection ? INFLAMMATION_DECAY_RATE_INFECTED : INFLAMMATION_DECAY_RATE_CLEAR;
    const newInflammation = Math.min(100, Math.max(0,
      ns.inflammation + effectiveInflammationAdd - decayRate
    ));

    // ── 4. Inflammation tissue damage ──────────────────────────────────────────
    totalTissueDamage += inflammationDamageTick(newInflammation);

    // ── 5. Update tissue integrity ─────────────────────────────────────────────
    let newIntegrity = ns.tissueIntegrity + totalTissueDamage;

    // Recovery: +2/turn when no infection and inflammation is low
    if (!hasInfection && newInflammation < INFLAMMATION_RECOVERY_THRESHOLD) {
      newIntegrity = Math.min(ns.tissueIntegrityCeiling, newIntegrity + getEffectiveIntegrityRecovery(TISSUE_RECOVERY_RATE, modifiers));
    }

    newIntegrity = Math.max(0, Math.min(100, newIntegrity));

    // ── 6. Scar ceiling update ─────────────────────────────────────────────────
    const newLowest = Math.min(ns.lowestIntegrityReached, newIntegrity);
    let newCeiling = ns.tissueIntegrityCeiling;
    if (newIntegrity < TISSUE_SCAR_THRESHOLD && newLowest < ns.lowestIntegrityReached) {
      // Integrity just dropped further below scar threshold — lower the ceiling
      newCeiling = Math.min(ns.tissueIntegrityCeiling, newLowest + TISSUE_SCAR_BONUS);
    }

    // ── 7. Parasite transit penalty ────────────────────────────────────────────
    const parasiteBurden = updatedPathogens.find(i => i.type === 'parasite')?.parasiticBurden ?? 0;
    const transitPenalty = Math.floor(parasiteBurden / PARASITE_TRANSIT_PENALTY_PER_BURDEN);

    nodeStates[nodeId] = {
      ...ns,
      immune: newImmuneUids,
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

// ── Immune cell inflammation contribution ─────────────────────────────────────

function computeImmuneCellInflammation(nodeId, deployedCells, ns) {
  const hasInfection = (ns.pathogens ?? []).length > 0;
  let added = 0;
  for (const cell of Object.values(deployedCells)) {
    if (cell.nodeId !== nodeId || cell.phase !== 'arrived') continue;
    if (!CELL_CONFIG[cell.type]?.isAttack) continue;
    // More inflammation if attacking a clean site (collateral / autoimmune)
    if (!hasInfection) {
      added += cell.type === 'killer_t' ? KILLER_T_INFLAMMATION_ON_CLEAN : ATTACK_CELL_INFLAMMATION_ON_CLEAN;
    } else {
      added += ATTACK_CELL_INFLAMMATION_ON_INFECTED;
    }
  }
  return added;
}

// ── Inflammation damage tick ──────────────────────────────────────────────────

function inflammationDamageTick(inflammation) {
  if (inflammation >= INFLAMMATION_DAMAGE_THRESHOLD_3) return -INFLAMMATION_DAMAGE_RATE_3;
  if (inflammation >= INFLAMMATION_DAMAGE_THRESHOLD_2) return -INFLAMMATION_DAMAGE_RATE_2;
  if (inflammation >= INFLAMMATION_DAMAGE_THRESHOLD_1) return -INFLAMMATION_DAMAGE_RATE_1;
  return 0;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Mini inline lookup to avoid circular import with pathogens.js registry
const PATHOGEN_REGISTRY_TV = {
  extracellular_bacteria: 'infectionLoad',
  virus:                  'cellularCompromise',
  fungi:                  'infectionLoad',
  parasite:               'parasiticBurden',
  toxin_producer:         'infectionLoad',
  prion:                  'corruptionLevel',
  intracellular_bacteria: 'cellularCompromise',
  cancer:                 'cellularCompromise',
  autoimmune:             'infectionLoad',
  benign:                 'infectionLoad',
};

function makeNewInstance(type, initialLoad, uid = null) {
  const tv = PATHOGEN_REGISTRY_TV[type] ?? 'infectionLoad';
  return {
    uid: uid ?? generatePathogenUid(),
    type,
    [tv]: initialLoad,
    detected_level: 'none',
    perceived_type: null,
  };
}

function isInstanceClearedSimple(instance) {
  const tv = PATHOGEN_REGISTRY_TV[instance.type] ?? 'infectionLoad';
  return (instance[tv] ?? 0) <= 0;
}

export function getGroundTruthSnapshot(groundTruth) {
  return {
    nodeStates: { ...groundTruth.nodeStates },
    spreadHistory: [...(groundTruth.spreadHistory ?? [])],
  };
}

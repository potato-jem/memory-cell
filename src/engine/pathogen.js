// Pathogen engine — per-instance advancement, clearance, spread, and damage output.
// Pure functions. No React, no UI.
//
// A PathogenInstance lives in nodeStates[nodeId].pathogens[] (array).
// Each instance has a uid, type, actualLoad, detected_level, and perceived_type.
//
// All functions accept an optional `modifiers` (runModifiers) parameter.
// When null/undefined, base config values are used (fully backward compatible).

import { NODES } from '../data/nodes.js';

// ── UID generation ─────────────────────────────────────────────────────────────

let _uidCounter = 0;
export function generatePathogenUid() {
  return `path_${++_uidCounter}`;
}
import { PATHOGEN_REGISTRY, isInstanceCleared, getPrimaryLoad } from '../data/pathogens.js';
import {
  CELL_CONFIG,
  getEffectiveClearanceRate,
  getEffectiveEffectiveness,
} from '../data/cellConfig.js';
import {
  getEffectiveGrowthRate,
  getEffectiveSpreadThreshold,
  getEffectiveDamageRate,
  getEffectivePathogenClearanceMultiplier,
  getEffectiveInflammationRate,
  getNodeCellClearanceMultiplier,
} from '../data/runModifiers.js';

// ── Clearance ─────────────────────────────────────────────────────────────────

/**
 * How much of a pathogen instance's primary value is removed this turn.
 *
 * Clearability is cell-side: CELL_CONFIG[cell.type].clearablePathogens[pathogenType]
 * gives the per-cell effectiveness multiplier (0 = cannot clear this pathogen).
 *
 * Effectiveness also scales with the pathogen's current detected_level:
 * CELL_CONFIG[cell.type].effectivenessByLevel[detected_level]
 *
 * @param {Object} instance    - the specific pathogen instance being cleared
 * @param {string} nodeId
 * @param {Object} deployedCells
 * @param {Object} nodeState
 * @param {Object} modifiers
 */
export function getClearancePower(instance, nodeId, deployedCells, nodeState, modifiers = null) {
  const pathogenType = instance.type;
  const detectedLevel = instance.detected_level ?? 'none';

  let total = 0;
  for (const cell of Object.values(deployedCells)) {
    if (cell.nodeId !== nodeId || cell.phase !== 'arrived') continue;
    const cellCfg = CELL_CONFIG[cell.type];
    const clearMod = cellCfg?.clearablePathogens?.[pathogenType] ?? 0;
    if (clearMod === 0) continue;
    const effectiveRate = getEffectiveClearanceRate(cell.type, modifiers);
    const levelEffectiveness = getEffectiveEffectiveness(cell.type, detectedLevel, modifiers);
    total += effectiveRate * clearMod * levelEffectiveness;
  }

  // Pathogen-specific clearance multiplier (e.g. upgrade makes a type easier to clear)
  total *= getEffectivePathogenClearanceMultiplier(pathogenType, modifiers);

  // Node-level clearance multiplier (scar: cellular_exhaustion reduces clearance at a node)
  total *= getNodeCellClearanceMultiplier(nodeId, modifiers);

  // Parasite immune suppression: all clearance at this node halved
  if (nodeState?.immuneSuppressed) total *= 0.5;

  return total;
}

// ── Instance advancement ───────────────────────────────────────────────────────

/**
 * Advance one pathogen instance for one turn.
 *
 * Returns:
 *   newInstance          — updated instance (null if cleared)
 *   tissueIntegrityDelta — how much integrity to subtract (negative = damage)
 *   inflammationDelta    — how much inflammation to add
 *   toxinOutput          — direct systemic stress contribution this turn
 *   suppressImmune       — whether parasite threshold now suppresses immunity
 */
export function advanceInstance(instance, nodeId, deployedCells, nodeState, systemicStress, modifiers = null) {
  const def = PATHOGEN_REGISTRY[instance.type];
  if (!def) return { newInstance: null, tissueIntegrityDelta: 0, inflammationDelta: 0, toxinOutput: 0 };

  const currentLoad = getPrimaryLoad(instance);

  const clearance = getClearancePower(instance, nodeId, deployedCells, nodeState, modifiers);
  const growth = computeGrowth(def, currentLoad, systemicStress, instance.type, modifiers);

  // Walled Off fungi: ticks down very slowly, neither grows nor clears normally
  let rawNew;
  if (nodeState?.isWalledOff && instance.type === 'fungi') {
    rawNew = Math.max(0, currentLoad - 0.5);
  } else {
    rawNew = Math.max(0, currentLoad + growth - clearance);
  }
  const newLoad = Math.min(100, rawNew);

  // Damage & inflammation (scaled by load/100)
  const loadFraction = currentLoad / 100;
  const effectiveDamageRate = getEffectiveDamageRate(instance.type, def.tissueDamageRate ?? 0, modifiers);
  let tissueIntegrityDelta = -effectiveDamageRate * loadFraction;
  let inflammationDelta = getEffectiveInflammationRate(instance.type, def.inflammationRate ?? 0, modifiers) * loadFraction;

  // Prion: no inflammation, but tissue damage above hidden threshold
  if (instance.type === 'prion') {
    inflammationDelta = 0;
    tissueIntegrityDelta = currentLoad >= def.hiddenUntil
      ? -(def.tissueDamageAboveThreshold ?? 0)
      : 0;
  }

  // Parasite immune suppression flag
  const suppressImmune = def.immuneSuppression && currentLoad >= (def.suppressionThreshold ?? 50);

  // Toxin output
  const toxinOutput = def.toxinOutputRate ? currentLoad * def.toxinOutputRate : 0;

  // Viral clearance tissue cost: destroying compromised cells damages tissue
  if (instance.type === 'virus' || instance.type === 'intracellular_bacteria') {
    const compromiseCleared = Math.max(0, currentLoad - newLoad);
    tissueIntegrityDelta -= compromiseCleared * (def.clearanceTissueCost ?? 0);
  }

  if (newLoad <= 0) {
    return { newInstance: null, tissueIntegrityDelta, inflammationDelta, toxinOutput, suppressImmune: false };
  }

  return {
    newInstance: { ...instance, actualLoad: newLoad },
    tissueIntegrityDelta,
    inflammationDelta,
    toxinOutput,
    suppressImmune,
  };
}

function computeGrowth(def, currentLoad, systemicStress, pathogenType, modifiers) {
  let rate = getEffectiveGrowthRate(pathogenType, def.replicationRate, modifiers);

  // Fungi thrive in high systemic stress
  if (def.highStressMultiplier && systemicStress > 70) {
    rate *= def.highStressMultiplier;
  }

  switch (def.growthModel) {
    case 'logistic':
      return rate * currentLoad * (1 - currentLoad / 100);
    case 'exponential':
      return rate * currentLoad;
    case 'linear':
    default:
      return rate;
  }
}

// ── Spread ────────────────────────────────────────────────────────────────────

/**
 * Check all infected nodes and return any new spreads.
 * Returns an array of { type, uid, fromNodeId, toNodeId, initialLoad }.
 * uid is inherited from the source instance so target nodes can track immunity lineage.
 */
export function computeSpreads(nodeStates, modifiers = null) {
  const spreads = [];

  for (const [nodeId, ns] of Object.entries(nodeStates)) {
    if (!ns.pathogens?.length) continue;
    const node = NODES[nodeId];
    if (!node) continue;

    for (const instance of ns.pathogens) {
      if (isInstanceCleared(instance)) continue;

      const def = PATHOGEN_REGISTRY[instance.type];
      if (!def || def.spreadThreshold == null) continue;

      const effectiveThreshold = getEffectiveSpreadThreshold(instance.type, def.spreadThreshold, modifiers);
      if (effectiveThreshold == null) continue;

      const load = getPrimaryLoad(instance);
      if (load < effectiveThreshold) continue;

      // Find adjacent nodes that don't already have this pathogen lineage
      for (const targetId of node.connections) {
        const targetNs = nodeStates[targetId];
        if (!targetNs) continue;
        // Block if target already has an active pathogen of the same type
        if (targetNs.pathogens?.some(i => i.type === instance.type && !isInstanceCleared(i))) continue;
        // Block if target is immune to this lineage uid
        if (instance.uid && targetNs.immune?.includes(instance.uid)) continue;
        // Block if target already has this uid active (same lineage, already spread here)
        if (instance.uid && targetNs.pathogens?.some(i => i.uid === instance.uid)) continue;
        spreads.push({
          type: instance.type,
          uid: instance.uid,
          fromNodeId: nodeId,
          toNodeId: targetId,
          initialLoad: def.spreadStrength ?? 10,
        });
        break; // one spread target per source per turn
      }
    }
  }

  return spreads;
}

// ── Granuloma ─────────────────────────────────────────────────────────────────

/** Returns true if a fungi instance should trigger/maintain Walled Off status. */
export function shouldWallOff(instance) {
  if (!instance || instance.type !== 'fungi') return false;
  const def = PATHOGEN_REGISTRY.fungi;
  return getPrimaryLoad(instance) >= (def.granulomaThreshold ?? 60);
}

// Pathogen engine — per-instance advancement, clearance, spread, and damage output.
// Pure functions. No React, no UI.
//
// A PathogenInstance lives at nodeStates[nodeId].pathogens[pathogenType].
// Each type tracks exactly one primary value (infectionLoad, cellularCompromise, etc.).
//
// All functions accept an optional `modifiers` (runModifiers) parameter.
// When null/undefined, base config values are used (fully backward compatible).

import { NODES } from '../data/nodes.js';
import { PATHOGEN_REGISTRY, isInstanceCleared, getPrimaryLoad } from '../data/pathogens.js';
import { CLEARANCE_RATES, getEffectiveClearanceRate } from '../data/cellConfig.js';
import {
  getEffectiveGrowthRate,
  getEffectiveSpreadThreshold,
  getEffectiveDamageRate,
  getEffectivePathogenClearanceMultiplier,
} from '../data/runModifiers.js';

// ── Clearance ─────────────────────────────────────────────────────────────────

/**
 * How much of a pathogen's primary value is removed this turn by present immune cells.
 * Only cell types listed in clearableBy contribute.
 */
export function getClearancePower(pathogenType, nodeId, deployedCells, nodeState, modifiers = null) {
  const def = PATHOGEN_REGISTRY[pathogenType];
  if (!def) return 0;
  const clearableBy = def.clearableBy ?? [];

  let total = 0;
  for (const cell of Object.values(deployedCells)) {
    if (cell.nodeId !== nodeId || cell.phase !== 'arrived') continue;
    if (!clearableBy.includes(cell.type)) continue;
    const effectiveRate = getEffectiveClearanceRate(cell.type, modifiers);
    total += effectiveRate * (cell.effectiveness ?? 1.0);
  }

  // Pathogen-specific clearance multiplier (e.g. upgrade makes a type easier to clear)
  total *= getEffectivePathogenClearanceMultiplier(pathogenType, modifiers);

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

  const tv = def.trackedValue;
  const currentLoad = instance[tv] ?? 0;

  const clearance = getClearancePower(instance.type, nodeId, deployedCells, nodeState, modifiers);
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
  let inflammationDelta = (def.inflammationRate ?? 0) * loadFraction;

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
    newInstance: { ...instance, [tv]: newLoad },
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
 * Returns an array of { type, fromNodeId, toNodeId, initialLoad }.
 */
export function computeSpreads(nodeStates, modifiers = null) {
  const spreads = [];

  for (const [nodeId, ns] of Object.entries(nodeStates)) {
    if (!ns.pathogens) continue;
    const node = NODES[nodeId];
    if (!node) continue;

    for (const [pathogenType, instance] of Object.entries(ns.pathogens)) {
      if (isInstanceCleared(instance)) continue;

      const def = PATHOGEN_REGISTRY[pathogenType];
      if (!def || def.spreadThreshold == null) continue;

      const effectiveThreshold = getEffectiveSpreadThreshold(pathogenType, def.spreadThreshold, modifiers);
      if (effectiveThreshold == null) continue;

      const load = getPrimaryLoad(instance);
      if (load < effectiveThreshold) continue;

      // Find adjacent nodes that don't already have this pathogen
      for (const targetId of node.connections) {
        const targetNs = nodeStates[targetId];
        if (!targetNs) continue;
        if (targetNs.pathogens?.[pathogenType] && !isInstanceCleared(targetNs.pathogens[pathogenType])) continue;
        spreads.push({
          type: pathogenType,
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

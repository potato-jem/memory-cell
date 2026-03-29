// Pathogen engine — per-instance advancement, clearance, spread, and damage output.
// Pure functions. No React, no UI.
//
// A PathogenInstance lives at nodeStates[nodeId].pathogens[pathogenType].
// Each type tracks exactly one primary value (infectionLoad, cellularCompromise, etc.).

import { NODES } from '../data/nodes.js';
import { PATHOGEN_REGISTRY, isInstanceCleared, getPrimaryLoad } from '../data/pathogens.js';
import { CLEARANCE_RATES } from './cells.js';

// ── Clearance ─────────────────────────────────────────────────────────────────

/**
 * How much of a pathogen's primary value is removed this turn by present immune cells.
 * Only cell types listed in clearableBy contribute.
 */
export function getClearancePower(pathogenType, nodeId, deployedCells, nodeState) {
  const def = PATHOGEN_REGISTRY[pathogenType];
  if (!def) return 0;
  const clearableBy = def.clearableBy ?? [];

  let total = 0;
  for (const cell of Object.values(deployedCells)) {
    if (cell.nodeId !== nodeId || cell.phase !== 'arrived') continue;
    if (!clearableBy.includes(cell.type)) continue;
    const base = CLEARANCE_RATES[cell.type] ?? 0;
    total += base * (cell.effectiveness ?? 1.0);
  }

  // Parasite immune suppression: if node has active parasite above threshold,
  // all clearance at this node is halved
  if (nodeState?.immuneSuppressed) total *= 0.5;

  return total;
}

// ── Instance advancement ───────────────────────────────────────────────────────

/**
 * Advance one pathogen instance for one turn.
 *
 * Returns:
 *   newInstance       — updated instance (null if cleared)
 *   tissueIntegrityDelta — how much integrity to subtract (negative = damage)
 *   inflammationDelta    — how much inflammation to add
 *   toxinOutput          — direct systemic stress contribution this turn
 *   compromiseCleared    — for viruses: how much cellularCompromise was removed (for tissue cost)
 */
export function advanceInstance(instance, nodeId, deployedCells, nodeState, systemicStress) {
  const def = PATHOGEN_REGISTRY[instance.type];
  if (!def) return { newInstance: null, tissueIntegrityDelta: 0, inflammationDelta: 0, toxinOutput: 0 };

  const tv = def.trackedValue;
  const currentLoad = instance[tv] ?? 0;

  // Clearance
  const clearance = getClearancePower(instance.type, nodeId, deployedCells, nodeState);

  // Growth
  const growth = computeGrowth(def, currentLoad, systemicStress);

  // Walled Off sites don't grow or clear (contained but stable)
  let rawNew;
  if (nodeState?.isWalledOff && instance.type === 'fungi') {
    rawNew = Math.max(0, currentLoad - 0.5); // ticks down very slowly
  } else {
    rawNew = Math.max(0, currentLoad + growth - clearance);
  }
  const newLoad = Math.min(100, rawNew);

  // Damage & inflammation (scaled by load/100)
  const loadFraction = currentLoad / 100;
  let tissueIntegrityDelta = -(def.tissueDamageRate ?? 0) * loadFraction;
  let inflammationDelta = (def.inflammationRate ?? 0) * loadFraction;

  // Prion: no inflammation, but tissue damage above hidden threshold
  if (instance.type === 'prion') {
    inflammationDelta = 0;
    tissueIntegrityDelta = currentLoad >= def.hiddenUntil
      ? -(def.tissueDamageAboveThreshold ?? 0)
      : 0;
  }

  // Parasite immune suppression flag (affects future rounds via nodeState)
  const suppressImmune = def.immuneSuppression && currentLoad >= (def.suppressionThreshold ?? 50);

  // Toxin output
  const toxinOutput = def.toxinOutputRate ? currentLoad * def.toxinOutputRate : 0;

  // Viral clearance tissue cost: track how much compromise was cleared
  let compromiseCleared = 0;
  if (instance.type === 'virus' || instance.type === 'intracellular_bacteria') {
    compromiseCleared = Math.max(0, currentLoad - newLoad);
    const clearanceTissueCost = def.clearanceTissueCost ?? 0;
    tissueIntegrityDelta -= compromiseCleared * clearanceTissueCost;
  }

  if (newLoad <= 0) {
    return { newInstance: null, tissueIntegrityDelta, inflammationDelta, toxinOutput, suppressImmune: false };
  }

  const newInstance = { ...instance, [tv]: newLoad };
  return { newInstance, tissueIntegrityDelta, inflammationDelta, toxinOutput, suppressImmune };
}

function computeGrowth(def, currentLoad, systemicStress) {
  let rate = def.replicationRate;

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
export function computeSpreads(nodeStates) {
  const spreads = [];

  for (const [nodeId, ns] of Object.entries(nodeStates)) {
    if (!ns.pathogens) continue;
    const node = NODES[nodeId];
    if (!node) continue;

    for (const [pathogenType, instance] of Object.entries(ns.pathogens)) {
      if (isInstanceCleared(instance)) continue;

      const def = PATHOGEN_REGISTRY[pathogenType];
      if (!def || def.spreadThreshold == null) continue;

      const load = getPrimaryLoad(instance);
      if (load < def.spreadThreshold) continue;

      // Find adjacent nodes that don't already have this pathogen
      for (const targetId of node.connections) {
        const targetNs = nodeStates[targetId];
        if (!targetNs) continue;
        if (targetNs.pathogens?.[pathogenType] && !isInstanceCleared(targetNs.pathogens[pathogenType])) continue;
        // Only spread to one new node per turn per source (deterministic: first eligible)
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


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

// ── Inflammation scaling ──────────────────────────────────────────────────────

/**
 * Returns an effectiveness multiplier based on site inflammation and cell config.
 * Innate cells underperform in cold tissue, peak at moderate inflammation, and
 * diminish slightly at very high inflammation. Adaptive cells work best at low
 * inflammation and degrade as it rises.
 *
 * Config shape: { lowThreshold, lowMult, highThreshold, highMult, midMult? }
 * midMult defaults to 1.0 if absent.
 */
function getInflammationScalingMultiplier(cfg, inflammation) {
  if (!cfg) return 1.0;
  if (inflammation < cfg.lowThreshold) return cfg.lowMult;
  if (inflammation < cfg.highThreshold) return cfg.midMult ?? 1.0;
  return cfg.highMult;
}

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

    // Stationary bonus (e.g. macrophage grows stronger the longer it holds a position)
    let stationaryMult = 1.0;
    const stationaryBonusCfg = cellCfg?.stationaryBonus;
    if (stationaryBonusCfg && cell.stationaryTurns > 0) {
      stationaryMult = Math.min(
        stationaryBonusCfg.maxMultiplier,
        1.0 + stationaryBonusCfg.gainPerTurn * cell.stationaryTurns
      );
    }

    // Specialization multiplier (e.g. b-cell tuned to a specific pathogen type)
    const specializationMult = cell.specialization?.[pathogenType] ?? 1.0;

    // Inflammation scaling: innate cells bonus in inflamed tissue; adaptive cells penalized
    const inflammationMult = getInflammationScalingMultiplier(
      cellCfg?.inflammationScaling,
      nodeState?.inflammation ?? 0
    );

    total += effectiveRate * clearMod * levelEffectiveness * stationaryMult * specializationMult * inflammationMult;
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
 * Returns each attacking cell's potential clearance contribution against this
 * pathogen, sorted ascending by collateral damage then by inflammation (least
 * harmful first). This order ensures that when a pathogen has little load left,
 * gentler cells consume it first — minimising wasteful side effects.
 */
function computeSortedClearanceContributions(instance, nodeId, deployedCells, nodeState, modifiers, def) {
  const pathogenType = instance.type;
  const detectedLevel = instance.detected_level ?? 'none';
  const collateralModifier = def.collateralModifier ?? 1.0;
  const inflammation = nodeState?.inflammation ?? 0;

  // Node- and pathogen-level multipliers (same as getClearancePower applies to the total)
  const pathogenClearanceMult = getEffectivePathogenClearanceMultiplier(pathogenType, modifiers);
  const nodeClearanceMult = getNodeCellClearanceMultiplier(nodeId, modifiers);
  const suppressionMult = nodeState?.immuneSuppressed ? 0.5 : 1.0;
  const globalMult = pathogenClearanceMult * nodeClearanceMult * suppressionMult;

  const contributions = [];

  for (const cell of Object.values(deployedCells)) {
    if (cell.nodeId !== nodeId || cell.phase !== 'arrived') continue;
    const cellCfg = CELL_CONFIG[cell.type];
    const clearMod = cellCfg?.clearablePathogens?.[pathogenType] ?? 0;
    if (clearMod === 0) continue;

    const effectiveRate = getEffectiveClearanceRate(cell.type, modifiers);
    const levelEffectiveness = getEffectiveEffectiveness(cell.type, detectedLevel, modifiers);

    let stationaryMult = 1.0;
    const stationaryBonusCfg = cellCfg?.stationaryBonus;
    if (stationaryBonusCfg && cell.stationaryTurns > 0) {
      stationaryMult = Math.min(
        stationaryBonusCfg.maxMultiplier,
        1.0 + stationaryBonusCfg.gainPerTurn * cell.stationaryTurns
      );
    }

    const specializationMult = cell.specialization?.[pathogenType] ?? 1.0;
    const inflammationMult = getInflammationScalingMultiplier(cellCfg?.inflammationScaling, inflammation);

    let potential = effectiveRate * clearMod * levelEffectiveness * stationaryMult * specializationMult * inflammationMult * globalMult;
    if (potential <= 0) continue;

    const cellCollateralRate = (cellCfg.collateralRate ?? 0) * collateralModifier;
    const cellInflammationRate = cellCfg.inflammationRate ?? 0;

    contributions.push({ potential, cellCollateralRate, cellInflammationRate });
  }

  // Sort: least harmful first (collateral ASC, then inflammation ASC)
  contributions.sort((a, b) => {
    const collateralDiff = a.cellCollateralRate - b.cellCollateralRate;
    if (collateralDiff !== 0) return collateralDiff;
    return a.cellInflammationRate - b.cellInflammationRate;
  });

  return contributions;
}

/**
 * Advance one pathogen instance for one turn.
 *
 * Returns:
 *   newInstance          — updated instance (null if cleared)
 *   tissueIntegrityDelta — how much integrity to subtract (negative = damage)
 *   inflammationDelta    — how much inflammation to add
 *   toxinOutput          — direct systemic stress contribution this turn
 *   suppressImmune       — whether parasite threshold now suppresses immunity
 *
 * Cell-driven inflammation and collateral tissue damage are now folded into
 * inflammationDelta and tissueIntegrityDelta respectively. Side effects are
 * proportional to clearance actually applied (capped by available pathogen load),
 * with gentle cells allocated first to minimise damage on nearly-dead pathogens.
 */
export function advanceInstance(instance, nodeId, deployedCells, nodeState, systemicStress, modifiers = null) {
  const def = PATHOGEN_REGISTRY[instance.type];
  if (!def) return { newInstance: null, tissueIntegrityDelta: 0, inflammationDelta: 0, toxinOutput: 0 };

  const currentLoad = getPrimaryLoad(instance);
  const growth = computeGrowth(def, currentLoad, systemicStress, instance.type, modifiers);

  // Walled Off fungi: ticks down very slowly, no cell involvement
  if (nodeState?.isWalledOff && instance.type === 'fungi') {
    const newLoad = Math.min(100, Math.max(0, currentLoad - 0.5));
    const loadFraction = currentLoad / 100;
    const effectiveDamageRate = getEffectiveDamageRate(instance.type, def.tissueDamageRate ?? 0, modifiers);
    const tissueIntegrityDelta = -effectiveDamageRate * loadFraction;
    const inflammationDelta = getEffectiveInflammationRate(instance.type, def.inflammationRate ?? 0, modifiers) * loadFraction;
    const toxinOutput = def.toxinOutputRate ? currentLoad * def.toxinOutputRate : 0;
    const suppressImmune = def.immuneSuppression && currentLoad >= (def.suppressionThreshold ?? 50);
    if (newLoad <= 0) {
      return { newInstance: null, tissueIntegrityDelta, inflammationDelta, toxinOutput, suppressImmune: false };
    }
    return { newInstance: { ...instance, actualLoad: newLoad }, tissueIntegrityDelta, inflammationDelta, toxinOutput, suppressImmune };
  }

  // ── Cell clearance with side-effect allocation ─────────────────────────────
  // attackableLoad: max clearance that can connect this turn
  const attackableLoad = Math.max(0, currentLoad + growth);

  const contributions = computeSortedClearanceContributions(instance, nodeId, deployedCells, nodeState, modifiers, def);

  let remaining = attackableLoad;
  let totalClearance = 0;
  let cellInflammation = 0;
  let cellCollateral = 0;

  for (const contrib of contributions) {
    const actual = Math.min(contrib.potential, remaining);
    remaining -= actual;
    totalClearance += actual;
    if (actual > 0) {
      cellInflammation += actual * contrib.cellInflammationRate;
      cellCollateral += actual * contrib.cellCollateralRate;
    }
  }

  // Also apply any excess clearance beyond attackableLoad (side effects already capped)
  // i.e. total clearance applied matches getClearancePower-based result
  const excessClearance = contributions.reduce((sum, c) => sum + c.potential, 0) - totalClearance;
  totalClearance += Math.max(0, excessClearance);

  const newLoad = Math.min(100, Math.max(0, currentLoad + growth - totalClearance));

  // ── Damage & inflammation ─────────────────────────────────────────────────
  const loadFraction = currentLoad / 100;
  const effectiveDamageRate = getEffectiveDamageRate(instance.type, def.tissueDamageRate ?? 0, modifiers);
  let tissueIntegrityDelta = -effectiveDamageRate * loadFraction;
  let inflammationDelta = getEffectiveInflammationRate(instance.type, def.inflammationRate ?? 0, modifiers) * loadFraction;

  // Fold in cell-driven side effects
  inflammationDelta += cellInflammation;
  tissueIntegrityDelta -= cellCollateral;

  // Prion: no inflammation, but tissue damage above hidden threshold
  // if (instance.type === 'prion') {
  //   inflammationDelta = 0;
  //   tissueIntegrityDelta = currentLoad >= def.hiddenUntil
  //     ? -(def.tissueDamageAboveThreshold ?? 0)
  //     : 0;
  // }

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

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
import { PATHOGEN_REGISTRY, PATHOGEN_DISPLAY_NAMES, isInstanceCleared, getPrimaryLoad } from '../data/pathogens.js';
import {
  CELL_CONFIG,
  getEffectiveClearanceRate,
  getEffectiveEffectiveness,
  getCellClearablePathogens,
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
export function getClearancePower(instance, nodeId, deployedCells, nodeState, modifiers = null, cellTypeState = null) {
  const pathogenType = instance.type;
  const detectedLevel = instance.detected_level ?? 'none';

  let total = 0;
  for (const cell of Object.values(deployedCells)) {
    if (cell.nodeId !== nodeId || cell.phase !== 'arrived') continue;
    const cellCfg = CELL_CONFIG[cell.type];
    const clearMod = getCellClearablePathogens(cell.type, modifiers, cellTypeState)[pathogenType] ?? 0;
    if (clearMod === 0) continue;
    const effectiveRate = getEffectiveClearanceRate(cell.type, modifiers);
    const levelEffectiveness = getEffectiveEffectiveness(cell.type, detectedLevel, modifiers);

    // Stationary bonus (e.g. macrophage grows stronger the longer it holds a position)
    const stationaryBonusCfg = cellCfg?.stationaryBonus;
    const actualRate = stationaryBonusCfg
      ? Math.min(stationaryBonusCfg.maxClearanceRate, effectiveRate + stationaryBonusCfg.gainPerTurn * (cell.stationaryTurns ?? 0))
      : effectiveRate;

    // Specialization multiplier — read from global cellTypeState (per type, not per cell)
    const specializationMult = cellTypeState?.[cell.type]?.specialization?.[pathogenType] ?? 1.0;

    // Inflammation scaling: innate cells bonus in inflamed tissue; adaptive cells penalized
    const inflammationMult = getInflammationScalingMultiplier(
      cellCfg?.inflammationScaling,
      nodeState?.inflammation ?? 0
    );

    const pathogenMult = getEffectivePathogenClearanceMultiplier(pathogenType, modifiers);
    const nodeMult = getNodeCellClearanceMultiplier(nodeId, modifiers);
    const suppPct = nodeState?.immuneSuppressed ? -0.5 : 0;
    const combinedFactor = Math.max(0, 1 + (inflammationMult - 1) + (nodeMult - 1) + suppPct);
    total += actualRate * clearMod * levelEffectiveness * specializationMult * pathogenMult * combinedFactor;
  }

  return total;
}

// ── Instance advancement ───────────────────────────────────────────────────────

/**
 * Returns each attacking cell's potential clearance contribution against this
 * pathogen, sorted ascending by collateral damage then by inflammation (least
 * harmful first). This order ensures that when a pathogen has little load left,
 * gentler cells consume it first — minimising wasteful side effects.
 */
function computeSortedClearanceContributions(instance, nodeId, deployedCells, nodeState, modifiers, def, cellTypeState) {
  const pathogenType = instance.type;
  const detectedLevel = instance.detected_level ?? 'none';
  const collateralModifier = def.collateralModifier ?? 1.0;
  const inflammation = nodeState?.inflammation ?? 0;

  const pathogenClearanceMult = getEffectivePathogenClearanceMultiplier(pathogenType, modifiers);
  const nodeClearanceMult = getNodeCellClearanceMultiplier(nodeId, modifiers);
  const suppPct = nodeState?.immuneSuppressed ? -0.5 : 0;

  const contributions = [];

  for (const cell of Object.values(deployedCells)) {
    if (cell.nodeId !== nodeId || cell.phase !== 'arrived') continue;
    const cellCfg = CELL_CONFIG[cell.type];
    const clearMod = getCellClearablePathogens(cell.type, modifiers, cellTypeState)[pathogenType] ?? 0;
    if (clearMod === 0) continue;

    const effectiveRate = getEffectiveClearanceRate(cell.type, modifiers);
    const levelEffectiveness = getEffectiveEffectiveness(cell.type, detectedLevel, modifiers);

    const stationaryBonusCfg = cellCfg?.stationaryBonus;
    const actualRate = stationaryBonusCfg
      ? Math.min(stationaryBonusCfg.maxClearanceRate, effectiveRate + stationaryBonusCfg.gainPerTurn * (cell.stationaryTurns ?? 0))
      : effectiveRate;

    const specializationMult = cellTypeState?.[cell.type]?.specialization?.[pathogenType] ?? 1.0;
    const inflammationMult = getInflammationScalingMultiplier(cellCfg?.inflammationScaling, inflammation);
    const combinedFactor = Math.max(0, 1 + (inflammationMult - 1) + (nodeClearanceMult - 1) + suppPct);

    let potential = actualRate * clearMod * levelEffectiveness * specializationMult * pathogenClearanceMult * combinedFactor;
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

// ── Multi-pathogen clearance allocation ───────────────────────────────────────

/**
 * Compute clearance allocations for all cells at a node using proportional attention.
 *
 * Each cell calculates its base potential Dn against each eligible pathogen.
 * D_T = sum of all Dn across pathogens. The cell's attention fraction for pathogen n
 * is Dn/D_T. Actual clearance = Dn × (Dn/D_T) × combinedModifier.
 *
 * Modifiers (inflammation, node scar, suppression) are additive percentage points
 * applied as a single combined factor.
 *
 * @returns {{ allocations: {[uid]: totalClearance}, cellAllocations: {[cellId]: {[uid]: clearance}} }}
 */
export function computeNodeClearanceAllocations(pathogens, nodeId, deployedCells, nodeState, modifiers, cellTypeState) {
  const allocations = {};
  const cellAllocations = {};
  for (const p of pathogens) allocations[p.uid] = 0;

  const nodeMult = getNodeCellClearanceMultiplier(nodeId, modifiers);
  const nodePct = nodeMult - 1;
  const suppPct = nodeState?.immuneSuppressed ? -0.5 : 0;

  for (const [cellId, cell] of Object.entries(deployedCells)) {
    if (cell.nodeId !== nodeId || cell.phase !== 'arrived') continue;
    const cellCfg = CELL_CONFIG[cell.type];
    const effectiveRate = getEffectiveClearanceRate(cell.type, modifiers);
    const stationaryBonus = cellCfg?.stationaryBonus;
    const actualRate = stationaryBonus
      ? Math.min(stationaryBonus.maxClearanceRate, effectiveRate + stationaryBonus.gainPerTurn * (cell.stationaryTurns ?? 0))
      : effectiveRate;
    if (actualRate <= 0) continue;

    const inflammationMult = getInflammationScalingMultiplier(cellCfg?.inflammationScaling, nodeState?.inflammation ?? 0);
    const inflammPct = inflammationMult - 1;
    const combinedFactor = Math.max(0, 1 + inflammPct + nodePct + suppPct);

    const clearableMap = getCellClearablePathogens(cell.type, modifiers, cellTypeState);

    // Compute base potential Dn for each eligible pathogen
    const basePotentials = pathogens
      .filter(p => (p.actualLoad ?? 0) > 0)
      .map(p => {
        const clearMod = clearableMap[p.type] ?? 0;
        if (clearMod === 0) return null;
        const levelEff = getEffectiveEffectiveness(cell.type, p.detected_level ?? 'none', modifiers);
        const specMult = cellTypeState?.[cell.type]?.specialization?.[p.type] ?? 1.0;
        const pathogenMult = getEffectivePathogenClearanceMultiplier(p.type, modifiers);
        const Dn = actualRate * clearMod * levelEff * specMult * pathogenMult;
        return Dn > 0 ? { uid: p.uid, Dn } : null;
      })
      .filter(Boolean);

    if (basePotentials.length === 0) continue;

    const D_T = basePotentials.reduce((s, bp) => s + bp.Dn, 0);
    const cellAlloc = {};
    for (const { uid, Dn } of basePotentials) {
      const attention = Dn / D_T;
      const clearance = Dn * attention * combinedFactor;
      cellAlloc[uid] = clearance;
      allocations[uid] = (allocations[uid] ?? 0) + clearance;
    }
    cellAllocations[cellId] = cellAlloc;
  }

  return { allocations, cellAllocations };
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
export function advanceInstance(instance, nodeId, deployedCells, nodeState, systemicStress, modifiers = null, clearanceOverride = null, cellTypeState = null) {
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

  const contributions = computeSortedClearanceContributions(instance, nodeId, deployedCells, nodeState, modifiers, def, cellTypeState);

  let totalClearance = 0;
  let cellInflammation = 0;
  let cellCollateral = 0;

  if (clearanceOverride !== null) {
    // Use equalized clearance from computeNodeClearanceAllocations.
    // Side effects are attributed proportionally across contributing cells.
    totalClearance = Math.min(clearanceOverride, attackableLoad);
    const naturalTotal = contributions.reduce((s, c) => s + c.potential, 0);
    const scale = naturalTotal > 0 ? totalClearance / naturalTotal : 0;
    for (const contrib of contributions) {
      const actual = contrib.potential * scale;
      if (actual > 0) {
        cellInflammation += actual * contrib.cellInflammationRate;
        cellCollateral += actual * contrib.cellCollateralRate;
      }
    }
  } else {
    let remaining = attackableLoad;
    for (const contrib of contributions) {
      const actual = Math.min(contrib.potential, remaining);
      remaining -= actual;
      totalClearance += actual;
      if (actual > 0) {
        cellInflammation += actual * contrib.cellInflammationRate;
        cellCollateral += actual * contrib.cellCollateralRate;
      }
    }
    // Apply excess clearance beyond attackableLoad (side effects already capped)
    const excessClearance = contributions.reduce((sum, c) => sum + c.potential, 0) - totalClearance;
    totalClearance += Math.max(0, excessClearance);
  }

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

export function computeGrowth(def, currentLoad, systemicStress, pathogenType, modifiers) {
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

/**
 * Returns a direction hint for the inflammation label based on current state.
 * Helps the player know whether to raise or lower inflammation.
 */
function getInflammationLabel(cfg, inflammation, inflammMult) {
  if (!cfg || inflammMult === 1.0) return 'inflammation';
  if (inflammation < cfg.lowThreshold) return 'inflammation (too low)';
  if (inflammation >= cfg.highThreshold) return 'inflammation (too high)';
  return 'inflammation';
}

/**
 * Build a labeled breakdown of the load delta for one pathogen instance.
 * Used by the projection system to render tooltips.
 *
 * Structure per cell type:
 *   strength  — base potential before any modifiers (includes stationary, spec, pathogen mult)
 *   modifiers — additive % effects: inflammation + node + pathogen + suppression + attention
 *
 * Attention: when multiple pathogens are present, each cell splits its budget proportionally
 * to its effectiveness against each. The attention fraction (Dn/D_T) is shown as ×M.
 *
 * Returns: BreakdownItem[]
 *   { label, amount, strengthValue, strengthFactors, modifierPct, modifierFactors }
 *   Positive amount = adds to load (bad), negative = removes load (good).
 */
export function computePathogenBreakdown(instance, nodeId, deployedCells, nodeState, systemicStress, modifiers, clearanceOverride, cellTypeState, cellAllocations = null, allPathogens = null) {
  const def = PATHOGEN_REGISTRY[instance.type];
  if (!def) return [];

  const currentLoad = getPrimaryLoad(instance);
  const growth = computeGrowth(def, currentLoad, systemicStress, instance.type, modifiers);

  if (nodeState?.isWalledOff && instance.type === 'fungi') {
    return [{ label: 'Walled off (slow decay)', amount: -0.5 }];
  }

  const breakdown = [{ label: 'Base growth', amount: growth }];

  const pathogenType = instance.type;
  const detectedLevel = instance.detected_level ?? 'none';
  const pathogenMult = getEffectivePathogenClearanceMultiplier(pathogenType, modifiers);
  const nodeMult = getNodeCellClearanceMultiplier(nodeId, modifiers);
  const suppressed = nodeState?.immuneSuppressed ?? false;
  const suppPct = suppressed ? -50 : 0;
  const nodePctRaw = Math.round((nodeMult - 1) * 100);
  const pathPctRaw = Math.round((pathogenMult - 1) * 100);

  // ── Pass 1: per-cell-type base potentials ─────────────────────────────────
  const strengthByType = {};        // full base potential vs this pathogen (actualRate × clearMod × levelEff × specMult × pathogenMult)
  const baseRateByType = {};        // base-only component (effectiveRate × clearMod × levelEff × pathogenMult) — for sub-item display
  const statDeltaByType = {};       // stationary delta (strength - baseRate portion)
  const statTurnsByType = {};       // capped stationary turns for display
  const specMultByType = {};        // specialization mult per type
  const inflammMultByType = {};     // inflammation mult per type
  const countByType = {};           // number of cells of this type

  for (const [cellId, cell] of Object.entries(deployedCells)) {
    if (cell.nodeId !== nodeId || cell.phase !== 'arrived') continue;
    const cellCfg = CELL_CONFIG[cell.type];
    const clearMod = getCellClearablePathogens(cell.type, modifiers, cellTypeState)[pathogenType] ?? 0;
    if (clearMod === 0) continue;

    const effectiveRate = getEffectiveClearanceRate(cell.type, modifiers);
    const levelEff = getEffectiveEffectiveness(cell.type, detectedLevel, modifiers);
    const specMult = cellTypeState?.[cell.type]?.specialization?.[pathogenType] ?? 1.0;
    const inflammMult = getInflammationScalingMultiplier(cellCfg?.inflammationScaling, nodeState?.inflammation ?? 0);
    const stationaryBonusCfg = cellCfg?.stationaryBonus;
    const actualRate = stationaryBonusCfg
      ? Math.min(stationaryBonusCfg.maxClearanceRate, effectiveRate + stationaryBonusCfg.gainPerTurn * (cell.stationaryTurns ?? 0))
      : effectiveRate;

    const baseRate = effectiveRate * clearMod * levelEff * pathogenMult;         // no stationary, no spec
    const statDeltaRaw = (actualRate - effectiveRate) * clearMod * levelEff * pathogenMult; // stationary only, no spec
    const strength = actualRate * clearMod * levelEff * specMult * pathogenMult; // full: (base+stat)×spec
    if (strength <= 0) continue;

    if (stationaryBonusCfg && stationaryBonusCfg.gainPerTurn > 0) {
      const maxEff = (stationaryBonusCfg.maxClearanceRate - effectiveRate) / stationaryBonusCfg.gainPerTurn;
      const effTurns = Math.min(cell.stationaryTurns ?? 0, Math.max(0, maxEff));
      statTurnsByType[cell.type] = (statTurnsByType[cell.type] ?? 0) + effTurns;
    }

    strengthByType[cell.type]    = (strengthByType[cell.type] ?? 0) + strength;
    baseRateByType[cell.type]    = (baseRateByType[cell.type] ?? 0) + baseRate;
    statDeltaByType[cell.type]   = (statDeltaByType[cell.type] ?? 0) + statDeltaRaw;
    specMultByType[cell.type]    = specMult;
    inflammMultByType[cell.type] = inflammMult;
    countByType[cell.type]       = (countByType[cell.type] ?? 0) + 1;
  }

  // ── Pass 2: attention fractions (multi-pathogen only) ─────────────────────
  const multiPathogen = (allPathogens?.length ?? 0) > 1;
  const attentionByType = {}; // Dn / D_T per cell type

  if (multiPathogen && allPathogens) {
    const totalStrengthByType = {}; // sum of base potentials vs ALL pathogens
    for (const [cellId, cell] of Object.entries(deployedCells)) {
      if (cell.nodeId !== nodeId || cell.phase !== 'arrived') continue;
      if (!strengthByType[cell.type]) continue;

      const cellCfg = CELL_CONFIG[cell.type];
      const effectiveRate = getEffectiveClearanceRate(cell.type, modifiers);
      const stationaryBonusCfg = cellCfg?.stationaryBonus;
      const actualRate = stationaryBonusCfg
        ? Math.min(stationaryBonusCfg.maxClearanceRate, effectiveRate + stationaryBonusCfg.gainPerTurn * (cell.stationaryTurns ?? 0))
        : effectiveRate;

      const clearableMap = getCellClearablePathogens(cell.type, modifiers, cellTypeState);
      let total = 0;
      for (const p of allPathogens) {
        if ((p.actualLoad ?? 0) <= 0) continue;
        const cm = clearableMap[p.type] ?? 0;
        if (cm === 0) continue;
        const le = getEffectiveEffectiveness(cell.type, p.detected_level ?? 'none', modifiers);
        const sm = cellTypeState?.[cell.type]?.specialization?.[p.type] ?? 1.0;
        const pm = getEffectivePathogenClearanceMultiplier(p.type, modifiers);
        total += actualRate * cm * le * sm * pm;
      }
      totalStrengthByType[cell.type] = (totalStrengthByType[cell.type] ?? 0) + total;
    }
    for (const t of Object.keys(strengthByType)) {
      const D_T = totalStrengthByType[t] ?? 0;
      attentionByType[t] = D_T > 0 ? strengthByType[t] / D_T : 1.0;
    }
  }

  // ── Cap fraction (clearance capped by attackableLoad) ────────────────────
  const attackableLoad = Math.max(0, currentLoad + growth);
  const capFraction = (clearanceOverride ?? 0) > 0
    ? Math.min(1, attackableLoad / clearanceOverride)
    : 1.0;

  // ── Build breakdown items ─────────────────────────────────────────────────
  const MIN_DISPLAY = 0.05;

  for (const cellType of Object.keys(strengthByType)) {
    const name = CELL_CONFIG[cellType]?.displayName ?? cellType;
    const count = countByType[cellType];
    const attention = multiPathogen ? (attentionByType[cellType] ?? 1.0) : 1.0;
    const inflMult = inflammMultByType[cellType];
    const inflPct = Math.round((inflMult - 1) * 100);

    // Additive modifier sum (percentage points)
    const modSumPct = inflPct + nodePctRaw + pathPctRaw + suppPct;
    const combinedFactor = Math.max(0, 1 + modSumPct / 100);

    // Overall factor = combined modifiers × attention (quadratic attention model)
    // actual clearance = strength × attention × combinedFactor
    const overallFactor = combinedFactor * attention;
    const modifierOnlyPct = Math.round((combinedFactor - 1) * 100);

    const amount = -(strengthByType[cellType] * overallFactor * capFraction);
    if (Math.abs(amount) < MIN_DISPLAY && strengthByType[cellType] < MIN_DISPLAY) continue;

    // Strength sub-factors
    const strengthFactors = [];
    const baseLabel = count > 1 ? `base ×${count}` : 'base';
    strengthFactors.push({ label: baseLabel, text: baseRateByType[cellType].toFixed(2) });
    const statDelta = statDeltaByType[cellType] ?? 0;
    if (statDelta >= MIN_DISPLAY) {
      const turns = Math.round(statTurnsByType[cellType] ?? 0);
      strengthFactors.push({ label: `stationary ×${turns}`, text: `+${statDelta.toFixed(2)}` });
    }
    const specPct = Math.round((specMultByType[cellType] - 1) * 100);
    if (Math.abs(specPct) >= 1) {
      strengthFactors.push({ label: 'specialisation', text: specPct >= 0 ? `+${specPct}%` : `${specPct}%` });
    }

    // Modifier sub-factors (additive %)
    const modifierFactors = [];
    if (Math.abs(inflPct) >= 1) {
      const label = getInflammationLabel(CELL_CONFIG[cellType]?.inflammationScaling, nodeState?.inflammation ?? 0, inflMult);
      modifierFactors.push({ label, text: inflPct >= 0 ? `+${inflPct}%` : `${inflPct}%` });
    }
    if (Math.abs(nodePctRaw) >= 1) modifierFactors.push({ label: 'node scar', text: nodePctRaw >= 0 ? `+${nodePctRaw}%` : `${nodePctRaw}%` });
    if (Math.abs(pathPctRaw) >= 1) modifierFactors.push({ label: 'pathogen modifier', text: pathPctRaw >= 0 ? `+${pathPctRaw}%` : `${pathPctRaw}%` });
    if (suppressed) modifierFactors.push({ label: 'immune suppression', text: '-50%' });

    const attentionPct = (multiPathogen && attention < 0.995) ? Math.round(attention * 100) : null;

    breakdown.push({
      label: count > 1 ? `${name} ×${count}` : name,
      amount,
      strengthValue: strengthByType[cellType],
      strengthFactors,
      modifierPct: modifierOnlyPct,
      modifierFactors,
      attentionPct,
    });
  }

  return breakdown;
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

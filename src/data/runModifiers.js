// Runtime modifier system — accumulates effects from upgrades, scars, and decisions.
//
// runModifiers lives in game state and starts empty (all values at their defaults).
// When an upgrade, scar, or decision is applied, use applyModifierPatch() to merge
// a modifier patch into the current state.
//
// Engine functions accept modifiers as an optional parameter. Passing null/undefined
// always falls back to base config values, so existing calls without modifiers still work.
//
// ── Modifier schema ───────────────────────────────────────────────────────────
//
// cells[cellType]:
//   clearanceRateMultiplier     — multiplies base clearanceRate from cellConfig
//   trainingTicksDelta          — added to base trainingTicks (negative = faster)
//   deploymentCostDelta         — added to base deployCost (clamped to min 1)
//   effectivenessBackedBonus    — added to effectiveness when scout-confirmed (capped at 1.0)
//   effectivenessUnbackedBonus  — added to effectiveness without scout confirmation
//   autoimmuneSurchargeMultiplier — scales inflammation added when attacking clean sites
//
// nodes[nodeId]:
//   addedConnections    — array of nodeIds this node gains edges to
//   removedConnections  — array of nodeIds whose edge to this node is blocked
//   exitCostDelta       — added to signalTravelCost (negative = faster to leave)
//   spawnWeightMultiplier — scales spawn probability for this node across all types
//
// pathogens[pathogenType]:
//   growthRateMultiplier    — multiplies replicationRate
//   spreadThresholdDelta    — added to spreadThreshold (higher = harder to spread)
//   damageRateMultiplier    — multiplies tissueDamageRate
//   clearanceRateMultiplier — multiplies how fast this pathogen is cleared
//
// detection[cellType][threatType]:
//   accuracyBonus — added to correctId probability (redistributed from miss)
//
// systemic:
//   stressDecayBonus         — added to STRESS_DECAY_RATE
//   feverStressMultiplier    — multiplies STRESS_FEVER_PER_TURN
//   integrityRecoveryBonus   — added to TISSUE_RECOVERY_RATE per site per turn
//   tokenCapacityBonus       — added to INITIAL_TOKEN_CAPACITY at run start
//
// spawn[pathogenType]:
//   weightMultiplier — multiplies TYPE_BASE_WEIGHT for this pathogen

export function makeRunModifiers() {
  return {
    cells:     {},
    nodes:     {},
    pathogens: {},
    detection: {},
    systemic:  {},
    spawn:     {},
  };
}

// ── Modifier patch application ────────────────────────────────────────────────
// Merges a patch onto the current runModifiers. Scalars are replaced (last write wins).
// Arrays (addedConnections, removedConnections) are union-merged.
//
// For stacking numeric upgrades, read the current value before patching:
//   const current = state.runModifiers.cells?.responder?.clearanceRateMultiplier ?? 1.0;
//   const patch = { cells: { responder: { clearanceRateMultiplier: current * 1.3 } } };

export function applyModifierPatch(runModifiers, patch) {
  return deepMerge(runModifiers ?? makeRunModifiers(), patch);
}

function deepMerge(base, patch) {
  if (patch === null || patch === undefined) return base;
  if (typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const result = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (Array.isArray(v) && Array.isArray(base[k])) {
      result[k] = [...new Set([...base[k], ...v])];
    } else if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
      result[k] = deepMerge(base[k], v);
    } else {
      result[k] = v;
    }
  }
  return result;
}

// ── Systemic modifier accessors ───────────────────────────────────────────────

export function getEffectiveStressDecay(baseDecay, modifiers) {
  const bonus = modifiers?.systemic?.stressDecayBonus ?? 0;
  return baseDecay + bonus;
}

export function getEffectiveFeverStress(baseFeverStress, modifiers) {
  const multiplier = modifiers?.systemic?.feverStressMultiplier ?? 1.0;
  return baseFeverStress * multiplier;
}

export function getEffectiveIntegrityRecovery(baseRate, modifiers) {
  const bonus = modifiers?.systemic?.integrityRecoveryBonus ?? 0;
  return baseRate + bonus;
}

// ── Node modifier accessors ───────────────────────────────────────────────────

export function getEffectiveConnections(nodeId, baseConnections, modifiers) {
  const m = modifiers?.nodes?.[nodeId];
  if (!m) return baseConnections;
  let connections = [...baseConnections];
  if (m.addedConnections?.length) {
    for (const c of m.addedConnections) {
      if (!connections.includes(c)) connections.push(c);
    }
  }
  if (m.removedConnections?.length) {
    connections = connections.filter(c => !m.removedConnections.includes(c));
  }
  return connections;
}

export function getEffectiveExitCost(nodeId, baseExitCost, modifiers) {
  const delta = modifiers?.nodes?.[nodeId]?.exitCostDelta ?? 0;
  return Math.max(0, baseExitCost + delta);
}

export function getNodeSpawnMultiplier(nodeId, modifiers) {
  return modifiers?.nodes?.[nodeId]?.spawnWeightMultiplier ?? 1.0;
}

// ── Pathogen modifier accessors ───────────────────────────────────────────────

export function getEffectiveGrowthRate(pathogenType, baseRate, modifiers) {
  const multiplier = modifiers?.pathogens?.[pathogenType]?.growthRateMultiplier ?? 1.0;
  return baseRate * multiplier;
}

export function getEffectiveSpreadThreshold(pathogenType, baseThreshold, modifiers) {
  if (baseThreshold == null) return null;
  const delta = modifiers?.pathogens?.[pathogenType]?.spreadThresholdDelta ?? 0;
  return baseThreshold + delta;
}

export function getEffectiveDamageRate(pathogenType, baseDamageRate, modifiers) {
  const multiplier = modifiers?.pathogens?.[pathogenType]?.damageRateMultiplier ?? 1.0;
  return baseDamageRate * multiplier;
}

export function getEffectivePathogenClearanceMultiplier(pathogenType, modifiers) {
  return modifiers?.pathogens?.[pathogenType]?.clearanceRateMultiplier ?? 1.0;
}

// ── Detection modifier accessors ──────────────────────────────────────────────

export function getDetectionAccuracyBonus(cellType, threatType, modifiers) {
  return modifiers?.detection?.[cellType]?.[threatType]?.accuracyBonus ?? 0;
}

// ── Spawn modifier accessors ──────────────────────────────────────────────────

export function getSpawnTypeWeightMultiplier(pathogenType, modifiers) {
  return modifiers?.spawn?.[pathogenType]?.weightMultiplier ?? 1.0;
}

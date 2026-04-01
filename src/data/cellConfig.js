// Cell type registry — single source of truth for all per-type properties.
// Engine code and UI both import from here (cells.js re-exports DEPLOY_COSTS etc. for backward compat).
//
// Balance parameters (costs, rates, timing) and behavioral flags all live here.
// For a quick balance pass, scan the CELL_CONFIG values below.
//
// Modifier accessors at the bottom apply runModifiers on top of base values.

// ── Per-cell detection upgrade probability tables ─────────────────────────────
// [detected_level] → { upgradeChance, misclassifyChance? }
//
// upgradeChance:     probability a roll increases detected_level one step
// misclassifyChance: (threat→classified only) probability of wrong classification
//
// Design intent:
//   Patrols (neutrophil): good at discovery (none→unknown), weak at classification
//   Macrophages: decent all-round
//   Scouts (dendritic): excellent at all levels, especially classification

const MACROPHAGE_DETECTION_PROBS = {
  none:          { upgradeChance: 0.40 },
  unknown:       { upgradeChance: 0.45 },
  threat:        { upgradeChance: 0.30, misclassifyChance: 0.40 },
  misclassified: { upgradeChance: 0.20 },
};

const NEUTROPHIL_DETECTION_PROBS = {
  none:          { upgradeChance: 0.50 },
  unknown:       { upgradeChance: 0.50 },
  threat:        { upgradeChance: 0.20, misclassifyChance: 0.50 },
  misclassified: { upgradeChance: 0.15 },
};

const DENDRITIC_DETECTION_PROBS = {
  none:          { upgradeChance: 0.70 },
  unknown:       { upgradeChance: 0.75 },
  threat:        { upgradeChance: 0.60, misclassifyChance: 0.15 },
  misclassified: { upgradeChance: 0.50 },
};

export const CELL_CONFIG = {

  // ── Recon ──────────────────────────────────────────────────────────────────

  dendritic: {
    displayName:           'Scout',
    deployCost:            2,        // tokens held for cell's lifetime
    clearanceRate:         0,        // recon only — no pathogen clearance
    trainingTicks:         20,
    displayOrder:          3,
    color:                 '#c084fc',          // hex — SVG cell dots (BodyMap)
    textClass:             'text-purple-400',  // Tailwind — UI labels
    dotClass:              'bg-purple-600',    // Tailwind — roster/detail dots
    startingCount:         0,
    // ── Role flags ──
    isRecon:               true,
    isAttack:              false,
    isPatrol:              false,
    isScout:               true,     // dwells then auto-returns; emits scout_arrived event
    requiresClassified:    false,
    coversAdjacentNodes:   false,
    // ── Detection ──
    detectionRolls:        3,
    detectionUpgradeProbs: DENDRITIC_DETECTION_PROBS,
    // ── Clearance ──
    clearablePathogens:    {},       // recon only — no pathogen clearance
    effectivenessByLevel:  {         // N/A — clearanceRate=0
      none: 1.0, unknown: 1.0, threat: 1.0, misclassified: 1.0, classified: 1.0,
    },
  },

  neutrophil: {
    displayName:           'Patrol',
    deployCost:            1,
    clearanceRate:         0,        // patrols do not clear pathogens
    trainingTicks:         10,
    displayOrder:          1,
    color:                 '#60a5fa',
    textClass:             'text-blue-400',
    dotClass:              'bg-blue-600',
    startingCount:         0,
    // ── Role flags ──
    isRecon:               true,
    isAttack:              false,
    isPatrol:              true,     // cycles adjacent nodes on a dwell timer
    isScout:               false,
    requiresClassified:    false,
    coversAdjacentNodes:   false,
    // ── Detection ──
    detectionRolls:        2,
    detectionUpgradeProbs: NEUTROPHIL_DETECTION_PROBS,
    // ── Clearance ──
    clearablePathogens:    {},       // clearanceRate=0 — included here for completeness
    effectivenessByLevel:  {         // N/A — clearanceRate=0
      none: 1.0, unknown: 1.0, threat: 1.0, misclassified: 1.0, classified: 1.0,
    },
  },

  macrophage: {
    displayName:           'Macrophage',
    deployCost:            1,
    clearanceRate:         4,
    trainingTicks:         10,
    displayOrder:          2,
    color:                 '#fbbf24',
    textClass:             'text-amber-400',
    dotClass:              'bg-amber-600',
    startingCount:         0,
    // ── Role flags ──
    isRecon:               true,
    isAttack:              false,
    isPatrol:              false,
    isScout:               false,
    requiresClassified:    false,
    coversAdjacentNodes:   true,     // grants visibility to adjacent nodes
    // ── Detection ──
    detectionRolls:        0,
    detectionUpgradeProbs: MACROPHAGE_DETECTION_PROBS,
    // ── Clearance ──
    clearablePathogens: {
      extracellular_bacteria: 1.0,
      fungi:                  1.0,
      toxin_producer:         1.0,
      parasite:               0.5,  // innate phagocytosis — slower than specialist
      prion:                  0.5,  // autophagy of misfolded proteins — very slow
      benign:                 1.0,
    },
    effectivenessByLevel:  {         // clears regardless of detection level
      none: 1.0, unknown: 1.0, threat: 1.0, misclassified: 1.0, classified: 1.0,
    },
  },

  // ── Attack ──────────────────────────────────────────────────────────────────

  responder: {
    displayName:           'Responder',
    deployCost:            3,
    clearanceRate:         12,
    trainingTicks:         15,
    displayOrder:          4,
    color:                 '#f87171',
    textClass:             'text-red-400',
    dotClass:              'bg-red-700',
    startingCount:         0,
    // ── Role flags ──
    isRecon:               false,
    isAttack:              true,
    isPatrol:              false,
    isScout:               false,
    requiresClassified:    false,
    coversAdjacentNodes:   false,
    // ── Detection ──
    detectionRolls:        0,
    detectionUpgradeProbs: null,
    // ── Clearance ──
    clearablePathogens: {
      extracellular_bacteria: 1.0,
      fungi:                  1.0,
      toxin_producer:         1.0,
      benign:                 1.0,
    },
    effectivenessByLevel: {         // penalty without classified intel
      none:          0.6,
      unknown:       0.6,
      threat:        0.6,
      misclassified: 0.6,
      classified:    1.0,
    },
  },

  killer_t: {
    displayName:           'Killer T',
    deployCost:            4,
    clearanceRate:         20,
    trainingTicks:         25,
    displayOrder:          5,
    color:                 '#fb7185',
    textClass:             'text-red-300',
    dotClass:              'bg-red-600',
    startingCount:         0,
    // ── Role flags ──
    isRecon:               false,
    isAttack:              true,
    isPatrol:              false,
    isScout:               false,
    requiresClassified:    true,    // cannot deploy without a classified pathogen at target
    coversAdjacentNodes:   false,
    // ── Detection ──
    detectionRolls:        0,
    detectionUpgradeProbs: null,
    // ── Clearance ──
    clearablePathogens: {
      virus:                  1.0,
      intracellular_bacteria: 1.0,
      cancer:                 1.0,
      benign:                 1.0,
    },
    effectivenessByLevel: {         // zero effectiveness without classified intel
      none:          0,
      unknown:       0,
      threat:        0,
      misclassified: 0,
      classified:    1.0,
    },
  },

  b_cell: {
    displayName:           'B-Cell',
    deployCost:            2,
    clearanceRate:         8,
    trainingTicks:         20,
    displayOrder:          6,
    color:                 '#4ade80',
    textClass:             'text-green-400',
    dotClass:              'bg-green-600',
    startingCount:         0,
    // ── Role flags ──
    isRecon:               false,
    isAttack:              true,
    isPatrol:              false,
    isScout:               false,
    requiresClassified:    false,
    coversAdjacentNodes:   false,
    // ── Detection ──
    detectionRolls:        0,
    detectionUpgradeProbs: null,
    // ── Clearance ──
    clearablePathogens: {
      extracellular_bacteria: 1.0,
      benign:                 1.0,
    },
    effectivenessByLevel: {         // small penalty without classified intel
      none:          0.85,
      unknown:       0.85,
      threat:        0.85,
      misclassified: 0.85,
      classified:    1.0,
    },
  },

  nk_cell: {
    displayName:           'NK Cell',
    deployCost:            3,
    clearanceRate:         15,
    trainingTicks:         20,
    displayOrder:          7,
    color:                 '#fb923c',
    textClass:             'text-orange-400',
    dotClass:              'bg-orange-600',
    startingCount:         0,
    // ── Role flags ──
    isRecon:               false,
    isAttack:              true,
    isPatrol:              false,
    isScout:               false,
    requiresClassified:    false,
    coversAdjacentNodes:   false,
    // ── Detection ──
    detectionRolls:        0,
    detectionUpgradeProbs: null,
    // ── Clearance ──
    clearablePathogens: {
      virus:    1.0,
      parasite: 1.0,  // NK cells target parasite-infected host cells
      cancer:   1.0,
      benign:   1.0,
    },
    effectivenessByLevel: {         // operates without prior intelligence
      none:          1.0,
      unknown:       1.0,
      threat:        1.0,
      misclassified: 1.0,
      classified:    1.0,
    },
  },
};

// ── Derived ordered list ───────────────────────────────────────────────────────
// Cell types sorted by displayOrder — use for roster lists, start screen, etc.
export const CELL_TYPE_ORDER = Object.entries(CELL_CONFIG)
  .sort(([, a], [, b]) => a.displayOrder - b.displayOrder)
  .map(([k]) => k);

// ── Convenience sets ──────────────────────────────────────────────────────────

export const ATTACK_CELL_TYPES = new Set(
  Object.entries(CELL_CONFIG).filter(([, v]) => v.isAttack).map(([k]) => k)
);

export const RECON_CELL_TYPES = new Set(
  Object.entries(CELL_CONFIG).filter(([, v]) => v.isRecon).map(([k]) => k)
);

export const PATROL_CELL_TYPES = new Set(
  Object.entries(CELL_CONFIG).filter(([, v]) => v.isPatrol).map(([k]) => k)
);

// ── Derived flat tables (backward compatibility and quick lookups) ─────────────

export const DEPLOY_COSTS = Object.fromEntries(
  Object.entries(CELL_CONFIG).map(([k, v]) => [k, v.deployCost])
);

export const CLEARANCE_RATES = Object.fromEntries(
  Object.entries(CELL_CONFIG).map(([k, v]) => [k, v.clearanceRate])
);

export const CELL_DISPLAY_NAMES = Object.fromEntries(
  Object.entries(CELL_CONFIG).map(([k, v]) => [k, v.displayName])
);

// ── Modifier-aware accessors ──────────────────────────────────────────────────
// Use these in engine code. They apply active runModifiers on top of base values.
// All accept modifiers as an optional last argument — null/undefined = base values.

export function getEffectiveClearanceRate(cellType, modifiers) {
  const base = CELL_CONFIG[cellType]?.clearanceRate ?? 0;
  const multiplier = modifiers?.cells?.[cellType]?.clearanceRateMultiplier ?? 1.0;
  return base * multiplier;
}

export function getEffectiveDeployCost(cellType, modifiers) {
  const base = CELL_CONFIG[cellType]?.deployCost ?? 1;
  const delta = modifiers?.cells?.[cellType]?.deploymentCostDelta ?? 0;
  return Math.max(1, base + delta);
}

export function getEffectiveTrainingTicks(cellType, modifiers) {
  const base = CELL_CONFIG[cellType]?.trainingTicks ?? 15;
  const delta = modifiers?.cells?.[cellType]?.trainingTicksDelta ?? 0;
  return Math.max(1, base + delta);
}

/**
 * Returns the clearance effectiveness of a cell type for a pathogen at a given
 * detection level. Higher levels (classified) unlock full effectiveness.
 *
 * detectedLevel: the detected_level of the specific pathogen instance being cleared.
 * Modifiers can add per-level bonuses via cells[type].effectivenessLevelBonus[level].
 */
export function getEffectiveEffectiveness(cellType, detectedLevel, modifiers) {
  const cfg = CELL_CONFIG[cellType];
  if (!cfg) return 1.0;
  const base = cfg.effectivenessByLevel?.[detectedLevel] ?? 1.0;
  const bonus = modifiers?.cells?.[cellType]?.effectivenessLevelBonus?.[detectedLevel] ?? 0;
  return Math.min(1.0, base + bonus);
}

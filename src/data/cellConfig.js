// Cell type registry — single source of truth for all per-type properties.
// Engine code and UI both import from here (cells.js re-exports DEPLOY_COSTS etc. for backward compat).
//
// Balance parameters (costs, rates, timing) and behavioral flags all live here.
// For a quick balance pass, scan the CELL_CONFIG values below.
//
// Modifier accessors at the bottom apply runModifiers on top of base values.

export const CELL_CONFIG = {

  // ── Recon ──────────────────────────────────────────────────────────────────

  dendritic: {
    displayName:           'Dendritic',
    deployCost:            2,        // tokens held for cell's lifetime
    clearanceRate:         0,        // recon only — no pathogen clearance
    trainingTicks:         20,
    displayOrder:          3,
    color:                 '#c084fc',          // hex — SVG cell dots (BodyMap)
    textClass:             'text-purple-400',  // Tailwind — UI labels
    dotClass:              'bg-purple-600',    // Tailwind — roster/detail dots
    startingCount:         0,
    // ── Role flags ──
    isDetector:            true,     // detects presence: 'none' → 'unknown'
    isClassifier:          true,     // classifies type: 'unknown' → 'classified'
    isAttack:              false,
    autoReturn:            true,     // returns when done: no unknowns + clear detection roll
    requiresClassified:    false,
    coversAdjacentNodes:   false,
    // ── Clearance ──
    clearablePathogens:    {},       // recon only — no pathogen clearance
    effectivenessByLevel:  {         // N/A — clearanceRate=0
      none: 1.0, unknown: 1.0, classified: 1.0,
    },
  },

  macrophage: {
    displayName:           'Macrophage',
    deployCost:            1,
    clearanceRate:         0,        // starts at 0 — grows via stationaryBonus each turn
    trainingTicks:         10,
    displayOrder:          2,
    stationaryBonus: {
      gainPerTurn:      1,   // clearance gained per stationary turn (after clearance)
      maxClearanceRate: 4,   // absolute cap on clearance rate
    },
    inflammationRate:      0.2,   // inflation per unit of clearance applied (medium-low)
    collateralRate:        0.1,   // tissue damage per unit of clearance × pathogen collateralModifier (low)
    inflammationScaling: {        // innate: underperforms in cold tissue, peaks in inflamed
      lowThreshold: 30, lowMult: 0.6,
      highThreshold: 60, highMult: 0.85,
    },
    color:                 '#fbbf24',
    textClass:             'text-amber-400',
    dotClass:              'bg-amber-600',
    startingCount:         0,
    // ── Role flags ──
    isDetector:            true,     // detects presence: 'none' → 'unknown'
    isClassifier:          false,    // cannot classify — sends for specialist (dendritic) if needed
    isAttack:              false,
    autoReturn:            false,    // macrophage holds position — does not auto-return
    requiresClassified:    false,
    coversAdjacentNodes:   false,    // adjacency detection available as upgrade only
    // ── Clearance ──
    clearablePathogens: {
      extracellular_bacteria: 1.0,
      fungi:                  1.0,
      toxin_producer:         1.0,
      parasite:               0.5,  // innate phagocytosis — slower than specialist
      // prion:                  0.5,  // autophagy of misfolded proteins — very slow
      benign:                 1.0,
    },
    effectivenessByLevel:  {         // clears regardless of detection level
      none: 1.0, unknown: 1.0, classified: 1.0,
    },
  },

  // ── Attack ──────────────────────────────────────────────────────────────────

  neutrophil: {
    displayName:           'Neutrophil',
    deployCost:            1,
    clearanceRate:         5,
    trainingTicks:         5,
    displayOrder:          1,
    cellLifetime:          15,  // 3 turns × 5 ticks/turn — dies after deployment, cannot be recalled
    inflammationRate:      0.5,   // high — neutrophil activity is a major driver of inflammation
    collateralRate:        0.4,   // high — granule release damages surrounding tissue
    inflammationScaling: {        // innate: underperforms in cold tissue, peaks in inflamed
      lowThreshold: 30, lowMult: 0.6,
      highThreshold: 60, highMult: 0.85,
    },
    color:                 '#60a5fa',
    textClass:             'text-blue-400',
    dotClass:              'bg-blue-600',
    startingCount:         0,
    // ── Role flags ──
    isDetector:            false,
    isClassifier:          false,
    isAttack:              true,
    autoReturn:            true,
    requiresClassified:    false,
    coversAdjacentNodes:   false,
    // ── Clearance ──
    clearablePathogens:    {
      extracellular_bacteria: 1.0,
      fungi:                  1.0,
      benign:   1.0,
    },
    effectivenessByLevel:  {
      none:       0,
      unknown:    0.8,
      classified: 1.0,
    },
  },

  eosinophil: {
    displayName:           'Eosinophil',
    deployCost:            3,
    clearanceRate:         5,
    trainingTicks:         15,
    displayOrder:          4,
    inflammationRate:      0.3,   // medium — degranulation generates moderate inflammation
    collateralRate:        0.25,  // medium — degranulation damages surrounding tissue
    color:                 '#f87171',
    textClass:             'text-red-400',
    dotClass:              'bg-red-700',
    startingCount:         0,
    // ── Role flags ──
    isDetector:            false,
    isClassifier:          false,
    isAttack:              true,
    autoReturn:            true,
    requiresClassified:    false,
    coversAdjacentNodes:   false,
    // ── Clearance ──
    clearablePathogens: {
      parasite: 1.0,
    },
    effectivenessByLevel: {
      none:       0.5,
      unknown:    0.5,
      classified: 1.0,
    },
  },

  killer_t: {
    displayName:           'Killer T',
    deployCost:            4,
    clearanceRate:         20,
    trainingTicks:         25,
    displayOrder:          5,
    inflammationRate:      0.15,  // low — targeted cytotoxic kills, minimal bystander signaling
    collateralRate:        0.25,  // medium — cell killing has some tissue cost
    inflammationScaling: {        // adaptive: degrades in high inflammation
      lowThreshold: 30, lowMult: 1.0,
      midMult: 0.6,
      highThreshold: 60, highMult: 0.3,
    },
    color:                 '#fb7185',
    textClass:             'text-red-300',
    dotClass:              'bg-red-600',
    startingCount:         0,
    // ── Role flags ──
    isDetector:            false,
    isClassifier:          false,
    isAttack:              true,
    autoReturn:            true,
    requiresClassified:    true,    // cannot deploy without a classified pathogen at target
    coversAdjacentNodes:   false,
    isSpecialist:          true,    // locks onto the first pathogen type it successfully clears
    // ── Clearance ──
    clearablePathogens: {
      virus:                  1.0,
      intracellular_bacteria: 1.0,
      cancer:                 1.0,
      benign:                 1.0,
    },
    effectivenessByLevel: {         // zero effectiveness without classified intel
      none:       0,
      unknown:    0,
      classified: 1.0,
    },
  },

  b_cell: {
    displayName:           'B-Cell',
    deployCost:            2,
    clearanceRate:         3,
    trainingTicks:         20,
    displayOrder:          6,
    inflammationRate:      0.15,  // low — antibody-mediated clearance, low bystander signaling
    collateralRate:        0.2,   // medium — opsonization/MAC has some tissue cost
    inflammationScaling: {        // adaptive: degrades in high inflammation
      lowThreshold: 30, lowMult: 1.0,
      midMult: 0.6,
      highThreshold: 60, highMult: 0.3,
    },
    specializationSlots:        1,    // max pathogen types to maintain top specialization in
    specializationGainPerTurn:  0.15, // specialization score gain per turn actively fighting that type
    specializationDecayPerTurn: 0.15, // decay per turn for non-top-slot types (zero-sum)
    specializationMax:          2.5,  // max clearance multiplier for a specialized type
    specializationMin:          0.2,  // floor for non-specialized types
    color:                 '#4ade80',
    textClass:             'text-green-400',
    dotClass:              'bg-green-600',
    startingCount:         0,
    // ── Role flags ──
    isDetector:            false,
    isClassifier:          false,
    isAttack:              true,
    autoReturn:            true,
    requiresClassified:    false,
    coversAdjacentNodes:   false,
    // ── Clearance ──
    clearablePathogens: {
      extracellular_bacteria: 1.0,
      virus: 1.0,
      fungi: 1.0,
      parasite: .5,
      intracellular_bacteria: .5,
      toxin_producer: 1.0,
      benign:                 1.0,
    },
    effectivenessByLevel: {
      none:       0,
      unknown:    0.25,
      classified: 1.0,
    },
  },

  nk_cell: {
    displayName:           'NK Cell',
    deployCost:            3,
    clearanceRate:         15,
    trainingTicks:         20,
    displayOrder:          7,
    inflammationRate:      0.5,   // high — NK cytokine release is a major inflammation driver
    collateralRate:        0.4,   // high — perforin/granzyme release damages surrounding cells
    inflammationScaling: {        // innate: underperforms in cold tissue, peaks in inflamed
      lowThreshold: 30, lowMult: 0.6,
      highThreshold: 60, highMult: 0.85,
    },
    color:                 '#fb923c',
    textClass:             'text-orange-400',
    dotClass:              'bg-orange-600',
    startingCount:         0,
    // ── Role flags ──
    isDetector:            false,
    isClassifier:          false,
    isAttack:              true,
    autoReturn:            true,
    requiresClassified:    false,
    coversAdjacentNodes:   false,
    // ── Clearance ──
    clearablePathogens: {
      virus:    1.0,
      intracellular_bacteria: 1.0,  // NK cells target parasite-infected host cells
      cancer:   1.0,
      benign:   1.0,
    },
    effectivenessByLevel: {
      none:       1.0,
      unknown:    1.0,
      classified: 1.0,
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
  Object.entries(CELL_CONFIG).filter(([, v]) => v.isDetector || v.isClassifier).map(([k]) => k)
);

export const ALL_CELL_TYPES = new Set(
  Object.entries(CELL_CONFIG).map(([k]) => k)
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

/**
 * Returns the effective clearablePathogens dict for a given cell type.
 * For specialist cell types that have locked a specializedType, all other pathogen types return 0.
 * specializedType is read from cellTypeState (runtime state).
 */
export function getCellClearablePathogens(cellType, modifiers, cellTypeState) {
  const cfg = CELL_CONFIG[cellType];
  const base = cfg?.clearablePathogens ?? {};
  if (!cfg?.isSpecialist) return base;
  const specializedType = cellTypeState?.[cellType]?.specializedType;
  if (!specializedType) return base;
  return { [specializedType]: base[specializedType] ?? 1.0 };
}

// Cell type registry — single source of truth for all per-type properties.
// Engine code and UI both import from here (cells.js re-exports for backward compatibility).
//
// Balance parameters (deploy costs, clearance rates) live here alongside
// behavioral properties. For a quick balance pass, scan the CELL_CONFIG values below.
//
// Modifier accessors at the bottom of this file read from runModifiers to
// compute effective values during a run (upgrades/scars adjust these at runtime).

export const CELL_CONFIG = {
  dendritic: {
    displayName:                 'Scout',
    deployCost:                  2,      // tokens held for cell's lifetime
    clearanceRate:               0,      // recon only — no pathogen clearance
    detectionRolls:              3,      // rolls per node visit
    isRecon:                     true,
    isAttack:                    false,
    isPatrol:                    false,
    requiresScoutConfirmation:   false,
    effectivenessWithoutBacking: null,   // N/A — not an attack cell
    effectivenessWithBacking:    null,
  },
  neutrophil: {
    displayName:                 'Patrol',
    deployCost:                  1,
    clearanceRate:               0,      // patrol does not clear pathogens
    detectionRolls:              2,
    isRecon:                     true,
    isAttack:                    false,
    isPatrol:                    true,
    requiresScoutConfirmation:   false,
    effectivenessWithoutBacking: null,
    effectivenessWithBacking:    null,
  },
  macrophage: {
    displayName:                 'Macrophage',
    deployCost:                  1,
    clearanceRate:               4,
    detectionRolls:              1,
    isRecon:                     true,
    isAttack:                    false,
    isPatrol:                    false,
    requiresScoutConfirmation:   false,
    effectivenessWithoutBacking: null,
    effectivenessWithBacking:    null,
  },
  responder: {
    displayName:                 'Responder',
    deployCost:                  3,
    clearanceRate:               12,
    isRecon:                     false,
    isAttack:                    true,
    isPatrol:                    false,
    requiresScoutConfirmation:   false,
    effectivenessWithoutBacking: 0.6,    // without scout confirmation
    effectivenessWithBacking:    1.0,    // with scout confirmation
  },
  killer_t: {
    displayName:                 'Killer T',
    deployCost:                  4,
    clearanceRate:               20,
    isRecon:                     false,
    isAttack:                    true,
    isPatrol:                    false,
    requiresScoutConfirmation:   true,   // cannot deploy without scout confirmation
    effectivenessWithoutBacking: null,   // N/A — requires confirmation to deploy
    effectivenessWithBacking:    1.0,
  },
  b_cell: {
    displayName:                 'B-Cell',
    deployCost:                  2,
    clearanceRate:               8,
    isRecon:                     false,
    isAttack:                    true,
    isPatrol:                    false,
    requiresScoutConfirmation:   false,
    effectivenessWithoutBacking: 0.85,
    effectivenessWithBacking:    1.0,
  },
  nk_cell: {
    displayName:                 'NK Cell',
    deployCost:                  3,
    clearanceRate:               15,
    isRecon:                     false,
    isAttack:                    true,
    isPatrol:                    false,
    requiresScoutConfirmation:   false,
    effectivenessWithoutBacking: 1.0,    // operates without prior intelligence
    effectivenessWithBacking:    1.0,
  },
};

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

// ── Derived flat tables (for backward compatibility and quick lookups) ─────────

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
// Use these in engine code. They apply any active runModifiers on top of base values.
// All accept modifiers as an optional last argument — if null/undefined, base values are used.

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

export function getEffectiveTrainingTicks(cellType, baseTicks, modifiers) {
  // baseTicks comes from gameConfig.js TRAINING_TICKS (balance params live there)
  const delta = modifiers?.cells?.[cellType]?.trainingTicksDelta ?? 0;
  return Math.max(1, baseTicks + delta);
}

export function getEffectiveEffectiveness(cellType, hasDendriticBacking, modifiers) {
  const cfg = CELL_CONFIG[cellType];
  if (!cfg) return 1.0;
  const base = hasDendriticBacking
    ? (cfg.effectivenessWithBacking ?? 1.0)
    : (cfg.effectivenessWithoutBacking ?? 1.0);
  const bonus = hasDendriticBacking
    ? (modifiers?.cells?.[cellType]?.effectivenessBackedBonus ?? 0)
    : (modifiers?.cells?.[cellType]?.effectivenessUnbackedBonus ?? 0);
  return Math.min(1.0, base + bonus);
}

// Spawn configuration — all spawn probability weights and schedules.
// Extracted from spawner.js so designers can tune spawn rates and distributions
// without touching engine logic.

// ── Per-node weights for each pathogen type ───────────────────────────────────
// Higher = more likely to spawn there. Weights are relative, not absolute.
// Nodes not listed default to weight 0 (cannot spawn that type there).

export const BASE_WEIGHTS = {
  extracellular_bacteria: { GUT: 30, LIVER: 20, THROAT: 15, CHEST: 15, BLOOD: 10, PERIPHERY: 8,  MUSCLE: 12 },
  virus:                  { THROAT: 35, CHEST: 25, BLOOD: 20, GUT: 10, LIVER: 5,  PERIPHERY: 5,  MUSCLE: 5  },
  fungi:                  { CHEST: 30, LIVER: 25, BLOOD: 20, GUT: 15, THROAT: 5,  PERIPHERY: 5,  MUSCLE: 8  },
  toxin_producer:         { GUT: 40, LIVER: 30, BLOOD: 20, CHEST: 5,  THROAT: 3,  PERIPHERY: 2,  MUSCLE: 5  },
  parasite:               { BLOOD: 30, GUT: 25, LIVER: 20, PERIPHERY: 15, CHEST: 7, THROAT: 3,   MUSCLE: 20 },
  benign:                 { THROAT: 30, GUT: 25, CHEST: 20, LIVER: 15, BLOOD: 5,  PERIPHERY: 5,  MUSCLE: 10 },
  intracellular_bacteria: { CHEST: 25, LIVER: 25, BLOOD: 20, GUT: 20, THROAT: 5,  PERIPHERY: 5,  MUSCLE: 10 },
  cancer:                 { CHEST: 25, LIVER: 25, BLOOD: 20, GUT: 15, THROAT: 5,  PERIPHERY: 10, MUSCLE: 15 },
  prion:                  { BLOOD: 40, CHEST: 20, LIVER: 20, GUT: 10, PERIPHERY: 5, THROAT: 5,   MUSCLE: 10 },
};

// ── Relative frequency across pathogen types ──────────────────────────────────
export const TYPE_BASE_WEIGHT = {
  extracellular_bacteria: 30,
  virus:                  25,
  fungi:                  20,
  toxin_producer:         12,
  benign:                 18,
  parasite:               8,
  intracellular_bacteria: 5,
  cancer:                 5,
  prion:                  3,
};

// ── Turn thresholds before each type can spawn ────────────────────────────────
export const UNLOCK_TURN = {
  extracellular_bacteria: 0,
  virus:                  0,
  fungi:                  0,
  toxin_producer:         3,
  benign:                 0,
  parasite:               5,
  intracellular_bacteria: 12,
  cancer:                 20,
  prion:                  30,
};

// ── Scheduled probability spikes ──────────────────────────────────────────────
export const SPAWN_SCHEDULE = [
  { turn: 3,  typeBoost: 'extracellular_bacteria', typeMultiplier: 2.0, globalBoost: 0.2  },
  { turn: 7,  typeBoost: null,                     typeMultiplier: 1,   globalBoost: 0.25 },
  { turn: 15, typeBoost: 'virus',                  typeMultiplier: 2.5, globalBoost: 0.2  },
  { turn: 25, typeBoost: null,                     typeMultiplier: 1,   globalBoost: 0.3  },
];

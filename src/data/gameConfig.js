// Central game configuration — all tunable constants in one place.

export const TICKS_PER_TURN = 5;             // real seconds per simulation "turn" (ground truth / signal cadence)
export const TICK_RATE_MS = 1000;            // game loop interval in ms

// Cell transit times (in ticks = real seconds)
export const ATTACK_TRANSIT_PER_HOP = 5;    // responders / B-cells / NK / macrophage: 5s per network hop
export const SCOUT_TRANSIT_PER_HOP = 10;    // dendritic scouts: 10s per hop each way (2 turns each way)
export const PATROL_DWELL_TICKS = 10;       // how long a patrol cell stays at a node before moving on

// Signal timeouts (in ticks = seconds). null = never auto-expire.
export const WARNING_SIGNAL_TIMEOUT = 60;   // anomaly_detected / collateral_damage expire after 60s if unactioned
export const ALERT_SIGNAL_TIMEOUT = null;   // threat_confirmed / threat_expanding never expire automatically
export const INFO_SIGNAL_TIMEOUT = null;    // patrol_clear / false_alarm: keep latest, no expiry

// Visibility: collateral_damage signals only generated when patrol/macrophage covers the node
export const INFLAMMATION_REQUIRES_VISIBILITY = true;

// ── Cell manufacturing ────────────────────────────────────────────────────────
// tokenCapacity starts at INITIAL_TOKEN_CAPACITY and grows by 1 every
// TOKEN_CAPACITY_REGEN_INTERVAL ticks, capped at TOKEN_CAPACITY_MAX.
// Each cell in the roster holds its DEPLOY_COST permanently until decommissioned.

export const INITIAL_TOKEN_CAPACITY = 12;
export const TOKEN_CAPACITY_MAX = 20;
export const TOKEN_CAPACITY_REGEN_INTERVAL = 60; // ticks between +1 capacity (~1 per minute)

// Bone-marrow production time per cell type (ticks = seconds)
export const TRAINING_TICKS = {
  dendritic:  20,
  neutrophil: 10,
  responder:  15,
  killer_t:   25,
  b_cell:     20,
  nk_cell:    20,
  macrophage: 10,
};

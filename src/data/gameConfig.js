// Central game configuration — all tunable constants in one place.

export const TICKS_PER_TURN = 5;             // ticks per simulation turn

// Cell timing (in ticks)
export const PATROL_DWELL_TICKS = 10;       // how long a patrol cell stays at a node before moving to an adjacent one
export const SCOUT_DWELL_TICKS = 10;        // how long a scout dwells at destination before auto-returning (2 turns)

// ── Cell manufacturing ────────────────────────────────────────────────────────
// tokenCapacity starts at INITIAL_TOKEN_CAPACITY and grows by 1 every
// TOKEN_CAPACITY_REGEN_INTERVAL ticks, capped at TOKEN_CAPACITY_MAX.
// Each cell in the roster holds its DEPLOY_COST permanently until decommissioned.

export const INITIAL_TOKEN_CAPACITY = 12;
export const TOKEN_CAPACITY_MAX = 30;
export const TOKEN_CAPACITY_REGEN_INTERVAL = 60; // ticks between +1 capacity (~1 per minute)

// ── Inflammation ───────────────────────────────────────────────────────────────
// Inflammation damages tissue integrity once it crosses 25.
// Damage rate increases at each threshold.
export const INFLAMMATION_DAMAGE_THRESHOLD_1 = 25;  // begins damaging
export const INFLAMMATION_DAMAGE_THRESHOLD_2 = 50;
export const INFLAMMATION_DAMAGE_THRESHOLD_3 = 75;
export const INFLAMMATION_DAMAGE_RATE_1 = 1;        // integrity lost/turn at tier 1
export const INFLAMMATION_DAMAGE_RATE_2 = 2;        // at tier 2
export const INFLAMMATION_DAMAGE_RATE_3 = 3;        // at tier 3
export const INFLAMMATION_RECOVERY_THRESHOLD = 30;  // inflammation below this allows integrity recovery

// ── Tissue integrity ───────────────────────────────────────────────────────────
export const TISSUE_RECOVERY_RATE = 2;              // integrity restored/turn when clear + low inflammation
export const TISSUE_SCAR_THRESHOLD = 40;            // if integrity drops below this, ceiling is set permanently
export const TISSUE_SCAR_BONUS = 25;                // ceiling = lowestPointReached + 25 

// ── Systemic stress ────────────────────────────────────────────────────────────
// Stress is NOT a health bar — it is the input to consequences.
export const STRESS_INFLAMED_SITE_THRESHOLD = 50;   // inflammation above this contributes to stress
export const STRESS_PER_INFLAMED_SITE_FIRST = 1;    // first inflamed site
export const STRESS_PER_INFLAMED_SITE_EXTRA = 2;    // each additional site (non-linear)
export const STRESS_FEVER_PER_TURN = 3;             // fever running adds this per turn
export const STRESS_LOW_INTEGRITY_SITE = 6;         // any site with low integrity
export const STRESS_LOW_INTEGRITY_THRESHOLD = 20;   // threshold for low integrity
export const STRESS_MULTI_INFECTION_BONUS = 2;      // multiple simultaneously infected sites
export const STRESS_MULTI_INFECTION_THRESHOLD = 3;  // multiple simultaneously infected sites threshold
export const STRESS_TOXIN_MULTIPLIER = 0.5;         // toxinOutput × this → direct stress per turn
export const BASE_STRESS_DECAY_RATE = 5;            // per turn base
export const NO_INFECTION_STRESS_DECAY_RATE = 20;   // per turn when no active infections

// ── Systemic integrity hits ────────────────────────────────────────────────────
// Systemic integrity takes hits when stress is sustained above thresholds.
export const INTEGRITY_HIT_STRESS_80 = 1;           // per turn when stress 80–89
export const INTEGRITY_HIT_STRESS_90 = 3;           // per turn when stress 90–99
export const INTEGRITY_HIT_STRESS_100 = 5;          // per turn when stress = 100

// ── Probabilistic spawn system ─────────────────────────────────────────────────
export const SPAWN_BASE_CHANCE = 0.55;              // probability of spawning something this turn (turn 0)
export const SPAWN_FLOOR_CHANCE = 0.15;             // minimum floor regardless of decay
export const SPAWN_DECAY_PER_TURN = 0.008;          // base chance decays each turn
export const SPAWN_IDLE_BOOST = 0.35;               // added when no active infections
export const SPAWN_OVERWHELM_PENALTY = 0.30;        // subtracted when 3+ active infections

// ── Inflammation dynamics ──────────────────────────────────────────────────────
// Inflammation decays each turn regardless of other factors.
export const INFLAMMATION_DECAY_RATE_INFECTED = 3;   // inflammation lost/turn while infection active
export const INFLAMMATION_DECAY_RATE_CLEAR = 8;      // inflammation lost/turn when no active infection

// ── Immune cell inflammation contribution ──────────────────────────────────────
// Attack cells at a node add inflammation each turn they are present.
export const ATTACK_CELL_INFLAMMATION_ON_INFECTED = 5;     // per attack cell at infected node
export const ATTACK_CELL_INFLAMMATION_ON_CLEAN = 15;       // per attack cell at clean node
export const KILLER_T_INFLAMMATION_ON_CLEAN = 25;          // killer T specifically (higher cascade risk)

// ── Parasite transit penalty ───────────────────────────────────────────────────
export const PARASITE_TRANSIT_PENALTY_PER_BURDEN = 25;     // +1 turn penalty per N parasiticBurden

// ── Win condition ──────────────────────────────────────────────────────────────
// Spawning stops once this many unique pathogens have spawned.
// Win triggers when that target is reached and all nodes are clear.
export const WIN_PATHOGEN_TARGET = 10;


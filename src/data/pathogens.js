// Pathogen type registry — all tunable parameters in one place.
// Each type defines which value it tracks, how it grows, what damages it causes,
// and which cell types can clear it.

export const PATHOGEN_TYPES = {
  EXTRACELLULAR_BACTERIA: 'extracellular_bacteria',
  VIRUS:                  'virus',
  FUNGI:                  'fungi',
  PARASITE:               'parasite',
  TOXIN_PRODUCER:         'toxin_producer',
  PRION:                  'prion',
  BENIGN:                 'benign',
  // Stubs — behaviour defined but not yet fully tuned:
  INTRACELLULAR_BACTERIA: 'intracellular_bacteria',
  CANCER:                 'cancer',
  AUTOIMMUNE:             'autoimmune',
};

// Maps pathogen type → signal vocabulary key (used by signalGenerator)
export const PATHOGEN_SIGNAL_TYPE = {
  extracellular_bacteria: 'bacterial',
  intracellular_bacteria: 'bacterial',
  virus:                  'viral',
  fungi:                  'fungal',
  parasite:               'parasitic',
  toxin_producer:         'toxin',
  prion:                  'prion',
  benign:                 'benign',
  cancer:                 'cancer',
  autoimmune:             'autoimmune',
};

// Human-readable display names
export const PATHOGEN_DISPLAY_NAMES = {
  extracellular_bacteria: 'Bacteria',
  intracellular_bacteria: 'Intracellular Bacteria',
  virus:                  'Virus',
  fungi:                  'Fungi',
  parasite:               'Parasite',
  toxin_producer:         'Toxin Producer',
  prion:                  'Prion',
  cancer:                 'Cancer',
  autoimmune:             'Autoimmune',
  benign:                 'Benign variation',
};

/**
 * For each type, the 'trackedValue' is the field on a PathogenInstance that
 * represents its presence/severity. All other tracked values are 0.
 *
 * Growth formula:
 *   LOGISTIC:    load += load * rate * (1 - load/100)   — slows as cap approaches
 *   EXPONENTIAL: value += value * rate                  — uncapped until clearance
 *   LINEAR:      value += rate                          — flat per turn
 *
 * Clearance: each clearableBy cell type reduces the tracked value by its CLEARANCE_RATE.
 * If clearableBy is empty, the value cannot be reduced by immune cells.
 */
export const PATHOGEN_REGISTRY = {

  extracellular_bacteria: {
    trackedValue:      'infectionLoad',
    growthModel:       'logistic',
    replicationRate:   0.30,          // moderate logistic growth
    spreadThreshold:   80,            // spreads when infectionLoad > 80
    spreadStrength:    10,            // new site starts at this load
    // Damage per turn (at full load 100; scaled linearly by load/100)
    tissueDamageRate:  8,             // integrity lost/turn at load 100
    inflammationRate:  15,            // inflammation added/turn at load 100
    clearableBy:       ['neutrophil', 'macrophage', 'responder', 'b_cell'],
  },

  virus: {
    trackedValue:      'cellularCompromise',
    growthModel:       'exponential',
    replicationRate:   0.50,          // fast: compromise × rate per turn
    spreadThreshold:   60,            // spreads when cellularCompromise > 60
    spreadStrength:    8,
    // Viruses don't damage tissue directly — clearing does (handled in groundTruth)
    tissueDamageRate:  0,
    clearanceTissueCost: 0.2,         // integrity lost per unit of compromise cleared
    inflammationRate:  10,
    clearableBy:       ['killer_t', 'nk_cell'],
  },

  fungi: {
    trackedValue:      'infectionLoad',
    growthModel:       'logistic',
    replicationRate:   0.12,          // slow
    spreadThreshold:   null,          // does not spread between sites
    granulomaThreshold: 60,           // above this: site becomes Walled Off
    tissueDamageRate:  5,
    inflammationRate:  8,
    highStressMultiplier: 2.0,        // replication doubles when systemicStress > 70
    clearableBy:       ['macrophage', 'responder'],
  },

  parasite: {
    trackedValue:      'parasiticBurden',
    growthModel:       'logistic',
    replicationRate:   0.15,
    spreadThreshold:   null,
    tissueDamageRate:  4,             // slow direct damage
    inflammationRate:  5,
    immuneSuppression: true,          // at burden > 50: inflammation generation halved
    suppressionThreshold: 50,
    movementPenalty:   true,          // transit to/from site +1T per 25 burden
    clearableBy:       [],            // requires eosinophil (not yet implemented)
  },

  toxin_producer: {
    trackedValue:      'infectionLoad',
    growthModel:       'logistic',
    replicationRate:   0.08,          // very slow growth
    spreadThreshold:   null,
    tissueDamageRate:  2,
    inflammationRate:  4,
    toxinOutputRate:   0.6,           // toxinOutput = infectionLoad × toxinOutputRate
    clearableBy:       ['macrophage', 'responder', 'neutrophil'],
  },

  prion: {
    trackedValue:      'corruptionLevel',
    growthModel:       'linear',
    replicationRate:   8,             // flat +8 corruption per turn
    spreadThreshold:   null,
    hiddenUntil:       50,            // invisible to player below this
    tissueDamageRate:  0,
    tissueDamageAboveThreshold: 2,    // 2 integrity/turn when corruption > 50
    inflammationRate:  0,             // no inflammation signal
    clearableBy:       [],            // cannot be cleared
  },

  // ── Stubs ──────────────────────────────────────────────────────────────────

  intracellular_bacteria: {
    trackedValue:      'cellularCompromise',
    growthModel:       'logistic',
    replicationRate:   0.10,
    spreadThreshold:   null,
    tissueDamageRate:  6,
    inflammationRate:  6,
    clearableBy:       ['killer_t'],
  },

  cancer: {
    trackedValue:      'cellularCompromise',
    growthModel:       'linear',
    replicationRate:   4,             // flat +4 per turn
    spreadThreshold:   null,
    tissueDamageRate:  3,
    inflammationRate:  3,
    clearableBy:       ['nk_cell', 'killer_t'],
  },

  // Benign: starts at 100, decays naturally. No tissue damage. Slight inflammation.
  // Cleared by any immune cell. Creates false-positive signals for the player.
  benign: {
    trackedValue:      'infectionLoad',
    growthModel:       'linear',
    replicationRate:   -4,            // decays 4/turn naturally (gone in ~25T without cells)
    spreadThreshold:   null,
    tissueDamageRate:  0,
    inflammationRate:  3,             // just enough to look suspicious
    clearableBy:       ['neutrophil', 'macrophage', 'responder', 'killer_t', 'b_cell', 'nk_cell'],
  },

  autoimmune: {
    trackedValue:      'infectionLoad',  // represents self-tissue reactivity
    growthModel:       'logistic',
    replicationRate:   0.20,
    spreadThreshold:   null,
    tissueDamageRate:  10,           // high self-damage
    inflammationRate:  20,
    clearableBy:       [],           // regulatory T-cell ability (future)
  },
};

// ── Queries ───────────────────────────────────────────────────────────────────

/** Returns true if a pathogen instance has been fully cleared. */
export function isInstanceCleared(instance) {
  if (!instance) return true;
  const def = PATHOGEN_REGISTRY[instance.type];
  if (!def) return true;
  return (instance[def.trackedValue] ?? 0) <= 0;
}

/** Returns the primary load value for display/logic. */
export function getPrimaryLoad(instance) {
  if (!instance) return 0;
  const def = PATHOGEN_REGISTRY[instance.type];
  if (!def) return 0;
  return instance[def.trackedValue] ?? 0;
}

/** True if any pathogen is active at this node state. */
export function nodeHasActivePathogen(nodeState) {
  if (!nodeState?.pathogens) return false;
  return Object.values(nodeState.pathogens).some(inst => !isInstanceCleared(inst));
}

/** True if all nodes are clear. */
export function allNodesClear(nodeStates) {
  return Object.values(nodeStates).every(ns => !nodeHasActivePathogen(ns));
}

/** Returns the dominant (highest-load) pathogen type at a node, or null. */
export function getDominantPathogen(nodeState) {
  if (!nodeState?.pathogens) return null;
  let best = null;
  let bestLoad = 0;
  for (const [type, inst] of Object.entries(nodeState.pathogens)) {
    const load = getPrimaryLoad(inst);
    if (load > bestLoad) { best = type; bestLoad = load; }
  }
  return best ? { type: best, load: bestLoad } : null;
}

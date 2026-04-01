// Pathogen type registry — all tunable parameters in one place.
// Each type defines which value it tracks, how it grows, and what damage it causes.
//
// Which cell types can clear each pathogen is defined on the cell side:
// see CELL_CONFIG[type].clearablePathogens in cellConfig.js.

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
 *
 * Growth formula:
 *   LOGISTIC:    load += load * rate * (1 - load/100)   — slows as cap approaches
 *   EXPONENTIAL: value += value * rate                  — uncapped until clearance
 *   LINEAR:      value += rate                          — flat per turn
 */
export const PATHOGEN_REGISTRY = {

  extracellular_bacteria: {
    actualLoad:              0,
    growthModel:       'logistic',
    replicationRate:   0.30,          // moderate logistic growth
    detectionModifier: 1.0,           // standard detectability
    spreadThreshold:   80,            // spreads when infectionLoad > 80
    spreadStrength:    10,            // new site starts at this load
    // Damage per turn (at full load 100; scaled linearly by load/100)
    tissueDamageRate:  8,             // integrity lost/turn at load 100
    inflammationRate:  15,            // inflammation added/turn at load 100
  },

  virus: {
    actualLoad:              0,
    growthModel:       'exponential',
    replicationRate:   0.15,          // compromise × rate per turn (was 0.50 → 0.30 → 0.15 — too fast to respond to)
    detectionModifier: 0.8,           // hides inside cells
    spreadThreshold:   60,            // spreads when > 60
    spreadStrength:    8,
    // Viruses don't damage tissue directly — clearing does (handled in groundTruth)
    tissueDamageRate:  0,
    clearanceTissueCost: 0.2,         // integrity lost per unit of compromise cleared
    inflammationRate:  10,
  },

  fungi: {
    actualLoad:              0,
    growthModel:       'logistic',
    replicationRate:   0.12,          // slow
    detectionModifier: 1.0,           // visible structures
    spreadThreshold:   null,          // does not spread between sites
    granulomaThreshold: 60,           // above this: site becomes Walled Off
    tissueDamageRate:  5,
    inflammationRate:  8,
    highStressMultiplier: 2.0,        // replication doubles when systemicStress > 70
  },

  parasite: {
    actualLoad:              0,
    growthModel:       'logistic',
    replicationRate:   0.15,
    detectionModifier: 0.9,           // somewhat hidden
    spreadThreshold:   null,
    tissueDamageRate:  4,             // slow direct damage
    inflammationRate:  5,
    immuneSuppression: true,          // at burden > 50: inflammation generation halved
    suppressionThreshold: 50,
    movementPenalty:   true,          // transit to/from site +1T per 25 burden
  },

  toxin_producer: {
    actualLoad:              0,
    growthModel:       'logistic',
    replicationRate:   0.08,          // very slow growth
    detectionModifier: 0.9,           // detected via indirect toxin evidence
    spreadThreshold:   null,
    tissueDamageRate:  2,
    inflammationRate:  4,
    toxinOutputRate:   0.6,           // toxinOutput = infectionLoad × toxinOutputRate
  },

  prion: {
    actualLoad:              0,
    growthModel:       'linear',
    replicationRate:   8,             // flat +8 corruption per turn
    detectionModifier: 0.5,           // very hard to detect — protein misfolding
    spreadThreshold:   null,
    hiddenUntil:       50,            // invisible to player below this
    tissueDamageRate:  0,
    tissueDamageAboveThreshold: 2,    // 2 integrity/turn when corruption > 50
    inflammationRate:  0,             // no inflammation signal
  },

  // ── Stubs ──────────────────────────────────────────────────────────────────

  intracellular_bacteria: {
    actualLoad:              0,
    growthModel:       'logistic',
    replicationRate:   0.10,
    detectionModifier: 0.8,           // hides inside host cells
    spreadThreshold:   null,
    tissueDamageRate:  6,
    inflammationRate:  6,
  },

  cancer: {
    actualLoad:              0,
    growthModel:       'linear',
    replicationRate:   4,             // flat +4 per turn
    detectionModifier: 0.6,           // mimics normal cells
    spreadThreshold:   null,
    tissueDamageRate:  3,
    inflammationRate:  3,
  },

  // Benign: starts at 100, decays naturally. No tissue damage. Slight inflammation.
  // Cleared by any attack cell. Creates false-positive signals for the player.
  benign: {
    actualLoad:              0,
    growthModel:       'linear',
    replicationRate:   -4,            // decays 4/turn naturally (gone in ~25T without cells)
    detectionModifier: 0.7,           // looks like normal cell activity
    spreadThreshold:   null,
    tissueDamageRate:  0,
    inflammationRate:  3,             // just enough to look suspicious
  },

  autoimmune: {
    actualLoad:              0,
    growthModel:       'logistic',
    replicationRate:   0.20,
    detectionModifier: 0.7,           // appears self-like; hard to distinguish from normal immune response
    spreadThreshold:   null,
    tissueDamageRate:  10,           // high self-damage
    inflammationRate:  20,
    // cannot be cleared — regulatory T-cell ability (future)
  },
};

// ── Queries ───────────────────────────────────────────────────────────────────

/** Returns the primary load value for display/logic. */
export function getPrimaryLoad(instance, isVisible = true) {
  if (!instance) return 0;
  if (!isVisible) return instance.lastKnownLoad ?? 0;
  return instance.actualLoad ?? 0;
}

/** Returns true if a pathogen instance has been fully cleared. */
export function isInstanceCleared(instance) {
  return getPrimaryLoad(instance) <= 0;
}

/** True if any pathogen is active at this node state. */
export function nodeHasActivePathogen(nodeState) {
  if (!nodeState?.pathogens) return false;
  return nodeState.pathogens.some(inst => !isInstanceCleared(inst));
}

/** True if all nodes are clear. */
export function allNodesClear(nodeStates) {
  return Object.values(nodeStates).every(ns => !nodeHasActivePathogen(ns));
}

/** Returns the dominant (highest-load) pathogen instance at a node, or null. */
export function getDominantPathogen(nodeState) {
  if (!nodeState?.pathogens?.length) return null;
  let best = null;
  let bestLoad = 0;
  for (const inst of nodeState.pathogens) {
    const load = getPrimaryLoad(inst);
    if (load > bestLoad) { best = inst; bestLoad = load; }
  }
  return best ? { type: best.type, load: bestLoad } : null;
}

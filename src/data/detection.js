// Detection probability matrix.
// Pure data — no flavour text, no signal construction.
//
// When a patrol cell (neutrophil/macrophage) visits a node, or a scout (dendritic) arrives,
// we roll against this matrix to determine what — if anything — they perceive.
//
// Outcomes:
//   MISS                — cell finds nothing, no signal generated
//   ANOMALY             — something is off, but the cell can't characterise it
//   THREAT_UNCLASSIFIED — a threat is present but type unknown
//   CORRECT_ID          — threat correctly identified (reportedType === actualType)
//   WRONG_ID            — threat misidentified (reportedType !== actualType)
//   CLEAR               — clean node confirmed (generates patrol_clear)
//   FALSE_ALARM         — cell thinks something is wrong on a clean node
//
// Each profile { miss, anomaly, threatUnclassified, correctId, wrongId } must sum to 1.
// Clean profiles { miss, clear, falseAlarm } must also sum to 1.

import { getDetectionAccuracyBonus } from './runModifiers.js';

export const DETECTION_OUTCOMES = {
  MISS: 'miss',
  ANOMALY: 'anomaly',
  THREAT_UNCLASSIFIED: 'threat_unclassified',
  CORRECT_ID: 'correct_id',
  WRONG_ID: 'wrong_id',
  CLEAR: 'clear',
  FALSE_ALARM: 'false_alarm',
};

// ── Threat detection profiles ─────────────────────────────────────────────────
// Rows: cell type.  Columns: actual threat type.
// All rows sum to 1.0.
//
// Design notes:
//   bacterial  — neutrophils are optimised for bacteria; dendritic reliable
//   viral      — hides inside cells; patrol mostly blind; dendritic reasonable
//   cancer     — resembles self; neutrophil essentially useless; even dendritic poor
//   autoimmune — looks like normal immune activity; high false classification rate
//   mimic      — intentionally deceptive; high wrong_id even for dendritic

export const THREAT_DETECTION_PROFILES = {

  neutrophil: {
    //               miss   anomaly  unclassified  correctId  wrongId
    bacterial:   { miss: 0.25, anomaly: 0.30, threatUnclassified: 0.20, correctId: 0.20, wrongId: 0.05 },
    viral:       { miss: 0.60, anomaly: 0.25, threatUnclassified: 0.10, correctId: 0.03, wrongId: 0.02 },
    cancer:      { miss: 0.97, anomaly: 0.03, threatUnclassified: 0.00, correctId: 0.00, wrongId: 0.00 },
    autoimmune:  { miss: 0.30, anomaly: 0.40, threatUnclassified: 0.20, correctId: 0.05, wrongId: 0.05 },
    mimic:       { miss: 0.75, anomaly: 0.15, threatUnclassified: 0.07, correctId: 0.01, wrongId: 0.02 },
  },

  macrophage: {
    bacterial:   { miss: 0.15, anomaly: 0.25, threatUnclassified: 0.25, correctId: 0.30, wrongId: 0.05 },
    viral:       { miss: 0.40, anomaly: 0.30, threatUnclassified: 0.20, correctId: 0.07, wrongId: 0.03 },
    cancer:      { miss: 0.85, anomaly: 0.10, threatUnclassified: 0.04, correctId: 0.01, wrongId: 0.00 },
    autoimmune:  { miss: 0.25, anomaly: 0.35, threatUnclassified: 0.25, correctId: 0.10, wrongId: 0.05 },
    mimic:       { miss: 0.65, anomaly: 0.20, threatUnclassified: 0.10, correctId: 0.02, wrongId: 0.03 },
  },

  dendritic: {
    bacterial:   { miss: 0.05, anomaly: 0.05, threatUnclassified: 0.10, correctId: 0.75, wrongId: 0.05 },
    viral:       { miss: 0.10, anomaly: 0.15, threatUnclassified: 0.20, correctId: 0.50, wrongId: 0.05 },
    cancer:      { miss: 0.55, anomaly: 0.20, threatUnclassified: 0.15, correctId: 0.07, wrongId: 0.03 },
    autoimmune:  { miss: 0.15, anomaly: 0.20, threatUnclassified: 0.30, correctId: 0.15, wrongId: 0.20 },
    mimic:       { miss: 0.35, anomaly: 0.20, threatUnclassified: 0.20, correctId: 0.10, wrongId: 0.15 },
  },
};

// ── Clean-node profiles ───────────────────────────────────────────────────────
// Used when no threat is present at the node.
// falseAlarm: cell reports something wrong on a clean node.

export const CLEAN_DETECTION_PROFILES = {
  neutrophil: { miss: 0.60, clear: 0.35, falseAlarm: 0.05 },
  macrophage: { miss: 0.50, clear: 0.45, falseAlarm: 0.05 },
  dendritic:  { miss: 0.20, clear: 0.75, falseAlarm: 0.05 },
};

// ── Wrong-ID table ────────────────────────────────────────────────────────────
// When a cell misidentifies, what type does it report instead?
// First entry = most likely misidentification.

export const WRONG_ID_MAP = {
  bacterial:  ['viral', 'autoimmune'],
  viral:      ['bacterial', 'mimic'],
  cancer:     ['autoimmune', 'bacterial'],
  autoimmune: ['bacterial', 'viral'],
  mimic:      ['bacterial', 'viral'],
};

// ── Modifiers ─────────────────────────────────────────────────────────────────

// Higher inflammation reduces miss probability (more molecular activity = easier to notice)
// At inflammation=100, miss probability reduced by up to this fraction.
export const INFLAMMATION_MISS_REDUCTION = 0.40;

// Weak pathogens are harder to detect. At strength=0 this adds 30% to miss probability.
export const WEAK_PATHOGEN_MISS_INCREASE = 0.30;

// ── Detection roll ────────────────────────────────────────────────────────────

/**
 * Roll detection for a cell visiting a node.
 *
 * @param {string} cellType        - 'neutrophil' | 'macrophage' | 'dendritic'
 * @param {string|null} threatType - actual threat type, or null if node is clean
 * @param {number} threatStrength  - 0–100 (ignored if no threat)
 * @param {number} inflammation    - 0–100
 * @returns {{ outcome: string, reportedType: string|null }}
 */
export function rollDetection(cellType, threatType, threatStrength, inflammation, modifiers = null) {
  if (!threatType || threatStrength <= 0) {
    return rollCleanDetection(cellType, inflammation);
  }

  const baseProfile = THREAT_DETECTION_PROFILES[cellType]?.[threatType];
  if (!baseProfile) return { outcome: DETECTION_OUTCOMES.MISS, reportedType: null };

  let profile = applyInflammationModifier(baseProfile, inflammation);
  profile = applyStrengthModifier(profile, threatStrength);

  // Apply detection accuracy bonus from upgrades/scars
  const accuracyBonus = getDetectionAccuracyBonus(cellType, threatType, modifiers);
  if (accuracyBonus > 0 && profile.miss > 0) {
    const transferred = Math.min(profile.miss, accuracyBonus);
    profile = {
      ...profile,
      miss: profile.miss - transferred,
      correctId: profile.correctId + transferred,
    };
  }

  const outcome = pickOutcome([
    [DETECTION_OUTCOMES.MISS,               profile.miss],
    [DETECTION_OUTCOMES.ANOMALY,            profile.anomaly],
    [DETECTION_OUTCOMES.THREAT_UNCLASSIFIED, profile.threatUnclassified],
    [DETECTION_OUTCOMES.CORRECT_ID,         profile.correctId],
    [DETECTION_OUTCOMES.WRONG_ID,           profile.wrongId],
  ]);

  const reportedType =
    outcome === DETECTION_OUTCOMES.CORRECT_ID ? threatType :
    outcome === DETECTION_OUTCOMES.WRONG_ID   ? getWrongId(threatType) :
    null;

  return { outcome, reportedType };
}

function rollCleanDetection(cellType, inflammation = 0) {
  const base = CLEAN_DETECTION_PROFILES[cellType];
  if (!base) return { outcome: DETECTION_OUTCOMES.MISS, reportedType: null };

  // Inflammation on clean nodes increases false alarm risk slightly
  const falseAlarmBonus = (inflammation / 100) * 0.08;
  const profile = {
    miss: Math.max(0, base.miss - falseAlarmBonus),
    clear: base.clear,
    falseAlarm: Math.min(0.30, base.falseAlarm + falseAlarmBonus),
  };

  const outcome = pickOutcome([
    [DETECTION_OUTCOMES.MISS,        profile.miss],
    [DETECTION_OUTCOMES.CLEAR,       profile.clear],
    [DETECTION_OUTCOMES.FALSE_ALARM, profile.falseAlarm],
  ]);

  return { outcome, reportedType: null };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function applyInflammationModifier(profile, inflammation) {
  if (inflammation <= 0) return profile;
  // Reduce miss by up to INFLAMMATION_MISS_REDUCTION; redistribute to anomaly/unclassified
  const reductionFactor = (inflammation / 100) * INFLAMMATION_MISS_REDUCTION;
  const missReduction = profile.miss * reductionFactor;
  const newMiss = profile.miss - missReduction;
  const scale = profile.miss > 0 ? (1 - newMiss) / (1 - profile.miss + 0.0001) : 1;
  return {
    miss: newMiss,
    anomaly:            profile.anomaly * scale,
    threatUnclassified: profile.threatUnclassified * scale,
    correctId:          profile.correctId * scale,
    wrongId:            profile.wrongId * scale,
  };
}

function applyStrengthModifier(profile, strength) {
  // strength: 0–100. Weak pathogen → harder to detect → more miss.
  const strengthFactor = Math.max(0, Math.min(1, strength / 100));
  const missIncrease = (1 - strengthFactor) * WEAK_PATHOGEN_MISS_INCREASE;
  const newMiss = Math.min(0.99, profile.miss + missIncrease);
  const nonMissScale = profile.miss < 1
    ? (1 - newMiss) / (1 - profile.miss)
    : 0;
  return {
    miss:               newMiss,
    anomaly:            profile.anomaly * nonMissScale,
    threatUnclassified: profile.threatUnclassified * nonMissScale,
    correctId:          profile.correctId * nonMissScale,
    wrongId:            profile.wrongId * nonMissScale,
  };
}

function pickOutcome(entries) {
  const roll = Math.random();
  let cumulative = 0;
  for (const [outcome, prob] of entries) {
    cumulative += prob;
    if (roll < cumulative) return outcome;
  }
  return entries[0][0]; // fallback: first outcome (usually MISS)
}

function getWrongId(actualType) {
  const options = WRONG_ID_MAP[actualType] ?? ['bacterial'];
  // Pick first option most of the time (it's the most plausible misidentification)
  return Math.random() < 0.7 ? options[0] : options[Math.min(1, options.length - 1)];
}

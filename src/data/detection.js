// Detection system — per-pathogen level-upgrade detection.
// Pure data + pure functions. No React, no UI.
//
// Each pathogen instance has a detected_level:
//   'none'          — not yet detected
//   'unknown'       — something anomalous, type not known
//   'threat'        — confirmed threat, type not yet identified
//   'misclassified' — classified but with wrong perceived_type
//   'classified'    — correctly identified; perceived_type matches true type
//
// Detection runs once per turn. Each recon cell has N rolls per node visited
// (detectionRolls on CELL_CONFIG). Rolls target the highest-level pathogens
// first (upgrade before discover). Each roll has a probability of upgrading a
// pathogen's detected_level by one step (detectionUpgradeProbs on CELL_CONFIG).

import { CELL_CONFIG } from './cellConfig.js';
import { getPrimaryLoad, PATHOGEN_REGISTRY } from './pathogens.js';
import { getDetectionAccuracyBonus } from './runModifiers.js';

// ── Wrong-ID table ────────────────────────────────────────────────────────────
// When classification is wrong, what does the cell report instead?
// First entry = most likely misidentification (70% probability).

export const WRONG_ID_MAP = {
  extracellular_bacteria: ['virus',                 'autoimmune'],
  intracellular_bacteria: ['virus',                 'extracellular_bacteria'],
  virus:                  ['extracellular_bacteria', 'autoimmune'],
  fungi:                  ['extracellular_bacteria', 'benign'],
  parasite:               ['extracellular_bacteria', 'fungi'],
  toxin_producer:         ['extracellular_bacteria', 'virus'],
  prion:                  ['autoimmune',             'benign'],
  cancer:                 ['autoimmune',             'benign'],
  autoimmune:             ['extracellular_bacteria', 'benign'],
  benign:                 ['autoimmune',             'extracellular_bacteria'],
};

// ── Level priority for roll targeting ─────────────────────────────────────────
// Higher = targeted first. 'classified' is skipped (already fully known).

const LEVEL_PRIORITY = {
  misclassified: 4,
  threat:        3,
  unknown:       2,
  none:          1,
  classified:    0,
};

// ── performDetection ──────────────────────────────────────────────────────────

/**
 * Run detection rolls for one cell visiting a node.
 * Returns a new pathogens array with potentially upgraded detected_levels.
 * Does not mutate input.
 *
 * detectionRolls and detectionUpgradeProbs are read from CELL_CONFIG[cellType].
 *
 * @param {string} cellType          - 'macrophage' | 'neutrophil' | 'dendritic'
 * @param {Array}  nodePathogens     - current pathogens array at the node
 * @param {number} nodeInflammation  - 0–100; boosts detection chance slightly
 * @param {Object} modifiers         - run modifiers (optional)
 * @returns {Array} updated pathogens array
 */
export function performDetection(cellType, nodePathogens, nodeInflammation = 0, modifiers = null) {
  const cellCfg = CELL_CONFIG[cellType];
  const rolls = cellCfg?.detectionRolls ?? 0;
  if (rolls === 0 || !nodePathogens?.length) return nodePathogens;

  // Build sorted candidate list (highest priority first; skip 'classified')
  const candidates = nodePathogens
    .map((inst, idx) => ({ inst, idx }))
    .filter(({ inst }) => inst.detected_level !== 'classified')
    .sort((a, b) => {
      const pa = LEVEL_PRIORITY[a.inst.detected_level] ?? 0;
      const pb = LEVEL_PRIORITY[b.inst.detected_level] ?? 0;
      if (pa !== pb) return pb - pa;
      return getPrimaryLoad(b.inst) - getPrimaryLoad(a.inst); // higher load = easier to detect
    });

  if (candidates.length === 0) return nodePathogens;

  const updated = [...nodePathogens];

  for (let roll = 0; roll < rolls; roll++) {
    const candidateSlot = candidates[roll % candidates.length];
    const currentInst = updated[candidateSlot.idx];

    if (currentInst.detected_level === 'classified') continue;

    const probs = cellCfg.detectionUpgradeProbs?.[currentInst.detected_level];
    if (!probs) continue;

    let chance = probs.upgradeChance;

    // Per-pathogen detection modifier (harder/easier types to detect)
    const detMod = PATHOGEN_REGISTRY[currentInst.type]?.detectionModifier ?? 1.0;
    chance *= detMod;

    // Inflammation bonus: inflamed nodes have more molecular activity — easier to notice
    chance += (nodeInflammation / 100) * 0.10;

    // Run modifier accuracy bonus (upgrades, scars)
    chance += getDetectionAccuracyBonus(cellType, currentInst.type, modifiers);

    chance = Math.max(0, Math.min(0.98, chance));

    if (Math.random() >= chance) continue;

    // Upgrade this pathogen's detection level
    const upgraded = upgradeDetectionLevel(currentInst, probs.misclassifyChance ?? 0);
    updated[candidateSlot.idx] = upgraded;
    // Keep candidate in sync so repeat-cycle rolls see the updated level
    candidateSlot.inst = upgraded;
  }

  return updated;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function upgradeDetectionLevel(instance, misclassifyChance) {
  switch (instance.detected_level) {
    case 'none':
      return { ...instance, detected_level: 'unknown' };

    case 'unknown':
      return { ...instance, detected_level: 'threat' };

    case 'threat': {
      if (Math.random() < misclassifyChance) {
        return { ...instance, detected_level: 'misclassified', perceived_type: getWrongId(instance.type) };
      }
      return { ...instance, detected_level: 'classified', perceived_type: instance.type };
    }

    case 'misclassified':
      return { ...instance, detected_level: 'classified', perceived_type: instance.type };

    default:
      return instance;
  }
}

function getWrongId(pathogenType) {
  const options = WRONG_ID_MAP[pathogenType] ?? ['extracellular_bacteria'];
  return Math.random() < 0.7 ? options[0] : options[Math.min(1, options.length - 1)];
}

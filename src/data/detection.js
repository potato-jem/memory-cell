// Detection system — deterministic two-step detection.
// Pure data + pure functions. No React, no UI.
//
// Each pathogen instance has a detected_level:
//   'none'       — not yet detected
//   'unknown'    — presence known, type not yet identified
//   'classified' — correctly identified; perceived_type matches true type
//
// Detection is deterministic (no probability rolls).
// isDetector cells: 'none' → 'unknown'  (confirm presence)
// isClassifier cells: 'unknown' → 'classified'  (identify type)
//
// performDetection returns { pathogens, isClear }
// isClear = true when a detector was present and found no 'none'-level pathogens
//           (node was already known or empty — "clear roll")

import { CELL_CONFIG } from './cellConfig.js';

// ── performDetection ──────────────────────────────────────────────────────────

/**
 * Run detection for one cell visiting a node.
 * Returns { pathogens, isClear }. Does not mutate input.
 *
 * @param {string} cellType      - cell type key from CELL_CONFIG
 * @param {Array}  nodePathogens - current pathogens array at the node
 * @returns {{ pathogens: Array, isClear: boolean }}
 */
export function performDetection(cellType, nodePathogens) {
  const cfg = CELL_CONFIG[cellType];
  const isDetector   = cfg?.isDetector   ?? false;
  const isClassifier = cfg?.isClassifier ?? false;

  if (!isDetector && !isClassifier) return { pathogens: nodePathogens, isClear: false };

  // No pathogens + detector present = clear roll
  if (!nodePathogens?.length) return { pathogens: nodePathogens, isClear: isDetector };

  let foundNone = false;

  const updated = nodePathogens.map(inst => {
    if (inst.detected_level === 'none' && isDetector) {
      foundNone = true;
      return { ...inst, detected_level: 'unknown' };
    }
    if (inst.detected_level === 'unknown' && isClassifier) {
      return { ...inst, detected_level: 'classified', perceived_type: inst.type };
    }
    return inst;
  });

  // isClear = detector present but no 'none'-level pathogens were found
  const isClear = isDetector && !foundNone;

  return { pathogens: updated, isClear };
}

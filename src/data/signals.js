// signals.js — minimal constants retained for memory.js compatibility.
// Signal objects have been removed; the game now shows perceived state directly.

export const CONFIDENCE_LEVELS = { LOW: 'low', MEDIUM: 'medium', HIGH: 'high' };

export const THREAT_TYPES = {
  BACTERIAL: 'bacterial',
  VIRAL: 'viral',
  CANCER: 'cancer',
  AUTOIMMUNE: 'autoimmune',
  MIMIC: 'mimic',
};

// Bump confidence up one band (used by memory cell bonus)
export function bumpConfidence(confidence) {
  if (confidence === CONFIDENCE_LEVELS.LOW) return CONFIDENCE_LEVELS.MEDIUM;
  if (confidence === CONFIDENCE_LEVELS.MEDIUM) return CONFIDENCE_LEVELS.HIGH;
  return CONFIDENCE_LEVELS.HIGH;
}

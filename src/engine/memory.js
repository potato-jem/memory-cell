// Memory cell mechanic — pure functions.
// After a resolved threat, memory cells persist and improve signal readability.
// Layer 2: within-session memory. Cross-session persistence deferred to Layer 5.

import { THREAT_TYPES } from '../data/signals.js';

/**
 * Initial memory bank — no prior exposure to any threat type.
 */
export function initMemoryBank() {
  return Object.fromEntries(
    Object.values(THREAT_TYPES).map(type => [
      type,
      { recognized: false, encounterCount: 0, bonus: 0 },
    ])
  );
}

/**
 * Record a resolved encounter with a threat type.
 * Returns updated memory bank.
 */
export function recordEncounter(memoryBank, threatType, resolvedCleanly) {
  if (!threatType || !THREAT_TYPES[threatType.toUpperCase()] && !Object.values(THREAT_TYPES).includes(threatType)) {
    return memoryBank;
  }

  const current = memoryBank[threatType] ?? { recognized: false, encounterCount: 0, bonus: 0 };
  const encounterCount = current.encounterCount + 1;

  // Recognition requires at least one encounter (even messy ones)
  // Clean resolution adds a stronger memory
  const bonusIncrement = resolvedCleanly ? 0.25 : 0.15;
  const newBonus = Math.min(1.0, current.bonus + bonusIncrement);

  return {
    ...memoryBank,
    [threatType]: {
      recognized: true,
      encounterCount,
      bonus: newBonus,
      lastEncounteredResult: resolvedCleanly ? 'clean' : 'messy',
    },
  };
}

/**
 * Get a human-readable description of the memory bank for UI display.
 */
export function getMemoryBankSummary(memoryBank) {
  return Object.entries(memoryBank)
    .filter(([, mem]) => mem.recognized)
    .map(([type, mem]) => ({
      type,
      displayName: THREAT_TYPE_DISPLAY_NAMES[type] ?? type,
      encounterCount: mem.encounterCount,
      strength: memoryStrength(mem.bonus),
      bonus: mem.bonus,
    }));
}

function memoryStrength(bonus) {
  if (bonus >= 0.75) return 'Strong';
  if (bonus >= 0.4) return 'Moderate';
  return 'Weak';
}

export const THREAT_TYPE_DISPLAY_NAMES = {
  [THREAT_TYPES.BACTERIAL]: 'Bacterial Infection',
  [THREAT_TYPES.VIRAL]: 'Viral Infection',
  [THREAT_TYPES.CANCER]: 'Malignant Growth',
  [THREAT_TYPES.AUTOIMMUNE]: 'Autoimmune Response',
  [THREAT_TYPES.MIMIC]: 'Molecular Mimic',
};

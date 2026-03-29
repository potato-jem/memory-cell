// Systemic values engine — computes SystemicStress and SystemicIntegrity.
// Pure functions. Replaces coherence.js.
//
// SystemicStress  — a pressure value (0-100). NOT a health bar. It is the input
//                   to consequences. High stress for sustained periods hits integrity.
// SystemicIntegrity — the body's actual health. Hitting 0 ends the run.

import { NODE_IDS } from '../data/nodes.js';
import { nodeHasActivePathogen } from '../data/pathogens.js';
import {
  STRESS_INFLAMED_SITE_THRESHOLD,
  STRESS_PER_INFLAMED_SITE_FIRST,
  STRESS_PER_INFLAMED_SITE_EXTRA,
  STRESS_FEVER_PER_TURN,
  STRESS_LOW_INTEGRITY_SITE,
  STRESS_MULTI_INFECTION_BONUS,
  STRESS_TOXIN_MULTIPLIER,
  STRESS_DECAY_RATE,
  INTEGRITY_HIT_STRESS_80,
  INTEGRITY_HIT_STRESS_90,
  INTEGRITY_HIT_STRESS_100,
} from '../data/gameConfig.js';
import { getEffectiveStressDecay, getEffectiveFeverStress } from '../data/runModifiers.js';

/**
 * Compute the new systemic stress value for this turn.
 *
 * @param {Object} nodeStates    — ground truth node states
 * @param {Object} perSiteOutputs — { [nodeId]: { toxinOutput } } from pathogen advancement
 * @param {Object} fever         — { active: bool }
 * @param {number} currentStress — previous value (for decay calculation)
 * @returns {{ stress: number, sources: Object[] }}
 */
export function computeSystemicStress(nodeStates, perSiteOutputs, fever, currentStress, modifiers = null) {
  const sources = [];
  let delta = 0;

  // ── Inflamed sites ─────────────────────────────────────────────────────────
  let inflamedCount = 0;
  for (const nodeId of NODE_IDS) {
    const ns = nodeStates[nodeId];
    if (!ns) continue;
    if (ns.inflammation >= STRESS_INFLAMED_SITE_THRESHOLD) {
      inflamedCount++;
      const contribution = inflamedCount === 1
        ? STRESS_PER_INFLAMED_SITE_FIRST
        : STRESS_PER_INFLAMED_SITE_EXTRA;
      delta += contribution;
      sources.push({ type: 'inflamed_site', nodeId, amount: contribution });
    }
  }

  // ── Fever ──────────────────────────────────────────────────────────────────
  if (fever?.active) {
    const feverStress = getEffectiveFeverStress(STRESS_FEVER_PER_TURN, modifiers);
    delta += feverStress;
    sources.push({ type: 'fever', amount: feverStress });
  }

  // ── Toxin output ───────────────────────────────────────────────────────────
  let totalToxin = 0;
  for (const nodeId of NODE_IDS) {
    totalToxin += perSiteOutputs[nodeId]?.toxinOutput ?? 0;
  }
  if (totalToxin > 0) {
    const toxinContrib = Math.round(totalToxin * STRESS_TOXIN_MULTIPLIER);
    delta += toxinContrib;
    sources.push({ type: 'toxin_output', amount: toxinContrib });
  }

  // ── Low-integrity sites ────────────────────────────────────────────────────
  for (const nodeId of NODE_IDS) {
    const ns = nodeStates[nodeId];
    if (ns?.tissueIntegrity < 30) {
      delta += STRESS_LOW_INTEGRITY_SITE;
      sources.push({ type: 'low_integrity', nodeId, amount: STRESS_LOW_INTEGRITY_SITE });
    }
  }

  // ── Multiple simultaneous infections ──────────────────────────────────────
  const infectedCount = NODE_IDS.filter(id => nodeHasActivePathogen(nodeStates[id])).length;
  if (infectedCount >= 3) {
    delta += STRESS_MULTI_INFECTION_BONUS;
    sources.push({ type: 'multi_infection', count: infectedCount, amount: STRESS_MULTI_INFECTION_BONUS });
  }

  // ── Natural decay when no active infections ────────────────────────────────
  if (infectedCount === 0) {
    const decayRate = getEffectiveStressDecay(STRESS_DECAY_RATE, modifiers);
    delta -= decayRate;
    sources.push({ type: 'decay', amount: -decayRate });
  }

  const stress = Math.max(0, Math.min(100, currentStress + delta));
  return { stress, sources };
}

/**
 * Apply systemic integrity damage from sustained high stress.
 * Called once per turn after stress is computed.
 *
 * @param {number} systemicIntegrity
 * @param {number} stress
 * @returns {number} newSystemicIntegrity
 */
export function applySystemicIntegrityHits(systemicIntegrity, stress) {
  let hit = 0;
  if (stress >= 100) hit = INTEGRITY_HIT_STRESS_100;
  else if (stress >= 90) hit = INTEGRITY_HIT_STRESS_90;
  else if (stress >= 80) hit = INTEGRITY_HIT_STRESS_80;
  return Math.max(0, systemicIntegrity - hit);
}

/**
 * Determine scars earned this turn based on tissue integrity thresholds.
 * Returns an array of new Scar objects (may be empty).
 */
export function computeNewScars(nodeStates, existingScars, systemicIntegrity, previousIntegrity) {
  const newScars = [];
  const existingScarIds = new Set(existingScars.map(s => s.id));

  // Site-specific scars at integrity thresholds
  const SCAR_THRESHOLDS = [50, 25, 0];
  for (const nodeId of NODE_IDS) {
    const ns = nodeStates[nodeId];
    if (!ns) continue;
    for (const threshold of SCAR_THRESHOLDS) {
      const scarId = `site_${nodeId}_${threshold}`;
      if (existingScarIds.has(scarId)) continue;
      if (ns.tissueIntegrity <= threshold) {
        newScars.push({
          id: scarId,
          type: 'site_integrity',
          nodeId,
          threshold,
          description: `${nodeId} integrity fell to ${threshold}%`,
        });
      }
    }
  }

  // Systemic integrity scar at 50%
  if (!existingScarIds.has('systemic_50') && systemicIntegrity <= 50 && previousIntegrity > 50) {
    newScars.push({
      id: 'systemic_50',
      type: 'systemic_integrity',
      description: 'Systemic integrity dropped below 50%',
    });
  }

  return newScars;
}

/** True if the run should end in a loss. */
export function isSystemCollapsed(systemicIntegrity) {
  return systemicIntegrity <= 0;
}

/** Identify dominant failure mode for post-mortem. */
export function identifyFailureMode(stressHistory) {
  if (!stressHistory || stressHistory.length === 0) return 'unknown';
  const maxStress = Math.max(...stressHistory.map(h => h.stress));
  if (maxStress >= 90) return 'systemic_overload';
  if (maxStress >= 70) return 'sustained_pressure';
  return 'progressive_degradation';
}

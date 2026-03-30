// Probabilistic pathogen spawner.
// Replaces seeded situation events with a two-layer probability system:
//   Layer A — global spawn chance this turn (influenced by turn, active infections)
//   Layer B — given a spawn, select (pathogen type × node) from weighted table
//
// Scheduled spikes make "something probably happens early" without guaranteeing it.

import { NODE_IDS } from '../data/nodes.js';
import { nodeHasActivePathogen, getPrimaryLoad } from '../data/pathogens.js';
import {
  SPAWN_BASE_CHANCE,
  SPAWN_FLOOR_CHANCE,
  SPAWN_DECAY_PER_TURN,
  SPAWN_IDLE_BOOST,
  SPAWN_OVERWHELM_PENALTY,
} from '../data/gameConfig.js';
import { BASE_WEIGHTS, TYPE_BASE_WEIGHT, UNLOCK_TURN, SPAWN_SCHEDULE } from '../data/spawnConfig.js';
import { getNodeSpawnMultiplier, getSpawnTypeWeightMultiplier } from '../data/runModifiers.js';

// Spawn weights, unlock turns, and schedule are all in src/data/spawnConfig.js.
// Edit that file to tune spawn rates and distributions without touching engine logic.

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Determine what (if anything) spawns this turn.
 *
 * @param {Object} nodeStates  — current ground truth node states
 * @param {number} turn
 * @param {number} systemicStress
 * @param {Function} rng       — () => 0..1, seeded or Math.random
 * @returns {Array} pendingSpawns — [{ type, nodeId, initialLoad }]
 */
export function rollSpawns(nodeStates, turn, systemicStress, rng = Math.random, modifiers = null) {
  // ── Layer A: should something spawn this turn? ───────────────────────────
  const activeCount = countActiveInfections(nodeStates);
  let spawnChance = Math.max(SPAWN_FLOOR_CHANCE, SPAWN_BASE_CHANCE - turn * SPAWN_DECAY_PER_TURN);

  if (activeCount === 0) spawnChance += SPAWN_IDLE_BOOST;
  if (activeCount >= 3) spawnChance -= SPAWN_OVERWHELM_PENALTY;

  // Scheduled global boosts
  const scheduled = SPAWN_SCHEDULE.find(s => s.turn === turn);
  if (scheduled?.globalBoost) spawnChance += scheduled.globalBoost;

  spawnChance = Math.max(0.05, Math.min(0.95, spawnChance));

  if (rng() > spawnChance) return [];

  // ── Layer B: select (type × node) ───────────────────────────────────────
  const typeWeights = buildTypeWeights(turn, systemicStress, scheduled, modifiers);
  const pathogenType = weightedPick(typeWeights, rng);
  if (!pathogenType) return [];

  const nodeWeights = buildNodeWeights(pathogenType, nodeStates, systemicStress, modifiers);
  const nodeId = weightedPick(nodeWeights, rng);
  if (!nodeId) return [];

  const INITIAL_LOAD = { benign: 100 };
  return [{ type: pathogenType, nodeId, initialLoad: INITIAL_LOAD[pathogenType] ?? 8 }];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function countActiveInfections(nodeStates) {
  return Object.values(nodeStates).filter(ns => nodeHasActivePathogen(ns)).length;
}

function buildTypeWeights(turn, systemicStress, scheduled, modifiers) {
  const weights = {};
  for (const [type, baseWeight] of Object.entries(TYPE_BASE_WEIGHT)) {
    if ((UNLOCK_TURN[type] ?? 0) > turn) continue;
    let w = baseWeight;
    if (scheduled?.typeBoost === type) w *= scheduled.typeMultiplier;
    if (type === 'fungi' && systemicStress > 70) w *= 2.0;
    w *= getSpawnTypeWeightMultiplier(type, modifiers);
    weights[type] = w;
  }
  return weights;
}

function buildNodeWeights(pathogenType, nodeStates, systemicStress, modifiers) {
  const baseTable = BASE_WEIGHTS[pathogenType] ?? {};
  const weights = {};
  for (const nodeId of NODE_IDS) {
    let w = baseTable[nodeId] ?? 0;
    if (w <= 0) continue;

    const ns = nodeStates[nodeId];
    if (!ns) continue;

    // Don't spawn same type at already-infected node
    if (ns.pathogens?.some(i => i.type === pathogenType && getPrimaryLoad(i) > 0)) continue;

    if ((pathogenType === 'extracellular_bacteria' || pathogenType === 'fungi') && ns.inflammation > 30) {
      w *= 1.5;
    }
    if (ns.tissueIntegrity < 20) w *= 0.5;

    w *= getNodeSpawnMultiplier(nodeId, modifiers);

    weights[nodeId] = w;
  }
  return weights;
}

function weightedPick(weights, rng) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  if (entries.length === 0) return null;
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [key, w] of entries) {
    r -= w;
    if (r <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

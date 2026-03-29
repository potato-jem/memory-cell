// Probabilistic pathogen spawner.
// Replaces seeded situation events with a two-layer probability system:
//   Layer A — global spawn chance this turn (influenced by turn, active infections)
//   Layer B — given a spawn, select (pathogen type × node) from weighted table
//
// Scheduled spikes make "something probably happens early" without guaranteeing it.

import { NODE_IDS } from '../data/nodes.js';
import { PATHOGEN_TYPES } from '../data/pathogens.js';
import { nodeHasActivePathogen, getDominantPathogen } from '../data/pathogens.js';
import {
  SPAWN_BASE_CHANCE,
  SPAWN_FLOOR_CHANCE,
  SPAWN_DECAY_PER_TURN,
  SPAWN_IDLE_BOOST,
  SPAWN_OVERWHELM_PENALTY,
} from '../data/gameConfig.js';

// ── Spawn weight table: [pathogenType][nodeId] = base weight ──────────────────
// Higher = more likely to spawn there. Weights are relative within each roll.

const BASE_WEIGHTS = {
  extracellular_bacteria: { GUT: 30, LIVER: 20, THROAT: 15, CHEST: 15, BLOOD: 10, PERIPHERY: 8, MUSCLE: 12 },
  virus:                  { THROAT: 35, CHEST: 25, BLOOD: 20, GUT: 10, LIVER: 5, PERIPHERY: 5, MUSCLE: 5 },
  fungi:                  { CHEST: 30, LIVER: 25, BLOOD: 20, GUT: 15, THROAT: 5, PERIPHERY: 5, MUSCLE: 8 },
  toxin_producer:         { GUT: 40, LIVER: 30, BLOOD: 20, CHEST: 5, THROAT: 3, PERIPHERY: 2, MUSCLE: 5 },
  parasite:               { BLOOD: 30, GUT: 25, LIVER: 20, PERIPHERY: 15, CHEST: 7, THROAT: 3, MUSCLE: 20 },
  benign:                 { THROAT: 30, GUT: 25, CHEST: 20, LIVER: 15, BLOOD: 5, PERIPHERY: 5, MUSCLE: 10 },
  // Late-game types unlocked after a number of turns
  intracellular_bacteria: { CHEST: 25, LIVER: 25, BLOOD: 20, GUT: 20, THROAT: 5, PERIPHERY: 5, MUSCLE: 10 },
  cancer:                 { CHEST: 25, LIVER: 25, BLOOD: 20, GUT: 15, THROAT: 5, PERIPHERY: 10, MUSCLE: 15 },
  prion:                  { BLOOD: 40, CHEST: 20, LIVER: 20, GUT: 10, PERIPHERY: 5, THROAT: 5, MUSCLE: 10 },
};

// Turn threshold before each type can spawn
const UNLOCK_TURN = {
  extracellular_bacteria: 0,
  virus:                  0,
  fungi:                  0,
  toxin_producer:         3,
  benign:                 0,
  parasite:               5,
  intracellular_bacteria: 12,
  cancer:                 20,
  prion:                  30,
};

// Relative frequency across pathogen types (before conditional modifiers)
// Ensures not everything is viruses all the time
const TYPE_BASE_WEIGHT = {
  extracellular_bacteria: 30,
  virus:                  25,
  fungi:                  20,
  toxin_producer:         12,
  benign:                 18,   // fairly common false positives
  parasite:               8,
  intracellular_bacteria: 5,
  cancer:                 5,
  prion:                  3,
};

// Scheduled probability spikes — boost spawn chance / favour certain types on specific turns
const SPAWN_SCHEDULE = [
  { turn: 3,  typeBoost: 'extracellular_bacteria', typeMultiplier: 2.0, globalBoost: 0.2 },
  { turn: 7,  typeBoost: null,                     typeMultiplier: 1,   globalBoost: 0.25 },
  { turn: 15, typeBoost: 'virus',                  typeMultiplier: 2.5, globalBoost: 0.2 },
  { turn: 25, typeBoost: null,                     typeMultiplier: 1,   globalBoost: 0.3 },
];

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
export function rollSpawns(nodeStates, turn, systemicStress, rng = Math.random) {
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
  const typeWeights = buildTypeWeights(turn, systemicStress, scheduled);
  const pathogenType = weightedPick(typeWeights, rng);
  if (!pathogenType) return [];

  const nodeWeights = buildNodeWeights(pathogenType, nodeStates, systemicStress);
  const nodeId = weightedPick(nodeWeights, rng);
  if (!nodeId) return [];

  const INITIAL_LOAD = { benign: 100 };
  return [{ type: pathogenType, nodeId, initialLoad: INITIAL_LOAD[pathogenType] ?? 8 }];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function countActiveInfections(nodeStates) {
  return Object.values(nodeStates).filter(ns => nodeHasActivePathogen(ns)).length;
}

function buildTypeWeights(turn, systemicStress, scheduled) {
  const weights = {};
  for (const [type, baseWeight] of Object.entries(TYPE_BASE_WEIGHT)) {
    if ((UNLOCK_TURN[type] ?? 0) > turn) continue;
    let w = baseWeight;
    // Scheduled type boost
    if (scheduled?.typeBoost === type) w *= scheduled.typeMultiplier;
    // Fungi thrives in high stress
    if (type === 'fungi' && systemicStress > 70) w *= 2.0;
    weights[type] = w;
  }
  return weights;
}

function buildNodeWeights(pathogenType, nodeStates, systemicStress) {
  const baseTable = BASE_WEIGHTS[pathogenType] ?? {};
  const weights = {};
  for (const nodeId of NODE_IDS) {
    let w = baseTable[nodeId] ?? 0;
    if (w <= 0) continue;

    const ns = nodeStates[nodeId];
    if (!ns) continue;

    // Don't spawn same type at already-infected node
    const existingInstance = ns.pathogens?.[pathogenType];
    if (existingInstance) {
      const tv = existingInstance.type;
      const load = existingInstance[Object.keys(existingInstance).find(k => k !== 'type')] ?? 0;
      if (load > 0) continue;
    }

    // Inflamed tissue is more vulnerable to bacteria / fungi
    if ((pathogenType === 'extracellular_bacteria' || pathogenType === 'fungi') && ns.inflammation > 30) {
      w *= 1.5;
    }

    // Avoid spawning at totally degraded sites (player already struggling there)
    if (ns.tissueIntegrity < 20) w *= 0.5;

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

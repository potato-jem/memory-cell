// Game state shape and initialisation.
// Turn-based endless run. Detection state lives on pathogen instances in groundTruth.

import { initGroundTruth } from '../engine/groundTruth.js';
import { makeReadyCell, computeTokensInUse } from '../engine/cells.js';
import { INITIAL_TOKEN_CAPACITY, TICKS_PER_TURN } from '../data/gameConfig.js';
import { DEFAULT_RUN_CONFIG } from '../data/runConfig.js';
import { CELL_CONFIG } from '../data/cellConfig.js';
import { makeRunModifiers } from '../data/runModifiers.js';

export { TICKS_PER_TURN };

export const GAME_PHASES = {
  PLAYING: 'playing',
  LOST:    'lost',
  WON:     'won',
};

export const LOSS_REASONS = {
  SYSTEMIC_COLLAPSE: 'systemic_collapse',
};

/**
 * Initialise fresh game state for an endless run.
 * @param {Object} runConfig  — optional override (default: DEFAULT_RUN_CONFIG)
 */
export function initGameState(runConfig = DEFAULT_RUN_CONFIG) {
  // Build starting roster: use runConfig.startingUnits if provided (e.g. from start screen),
  // otherwise fall back to CELL_CONFIG[type].startingCount defaults.
  const startingUnits = runConfig.startingUnits ??
    Object.entries(CELL_CONFIG)
      .filter(([, cfg]) => cfg.startingCount > 0)
      .map(([type, cfg]) => ({ type, count: cfg.startingCount }));

  const deployedCells = {};
  for (const { type, count } of startingUnits) {
    for (let i = 0; i < count; i++) {
      const cell = makeReadyCell(type);
      deployedCells[cell.id] = cell;
    }
  }

  return {
    runConfig,

    // Ground truth — the hidden simulation
    // Detection state (detected_level, perceived_type) lives on pathogen instances here.
    groundTruth: initGroundTruth(),

    // Cell deployment
    deployedCells,

    // Time
    tick: 0,
    turn: 0,

    // Token capacity (cell manufacturing slots)
    tokenCapacity: INITIAL_TOKEN_CAPACITY,
    tokensInUse: computeTokensInUse(deployedCells),
    attentionTokens: INITIAL_TOKEN_CAPACITY,

    // Systemic values — the new health model
    systemicStress: 0,       // 0-100, pressure input (NOT the health bar)
    systemicIntegrity: 100,  // 0-100, actual loss condition
    systemicStressHistory: [{ turn: 0, stress: 0, integrity: 100 }],

    // Fever — binary player-controlled state
    fever: { active: false },

    // Scars — permanent negative modifiers from serious damage
    scars: [],

    // Runtime modifiers — accumulate upgrades, scars, decisions
    // Dispatch APPLY_MODIFIER with a patch to modify cell/node/pathogen/detection/systemic/spawn behavior
    runModifiers: makeRunModifiers(),

    // Win tracking — counts unique pathogen spawns (not spreads)
    totalPathogensSpawned: 0,

    // Upgrade trigger tracking — upgrades fire every 3rd pathogen cleared
    totalPathogensCleared: 0,

    // Modifier choices awaiting player resolution.
    // Each entry: { id, category, options: [...] }
    // First entry must be resolved (CHOOSE_MODIFIER) before END_TURN is meaningful.
    pendingModifierChoices: [],

    // Record of all modifiers chosen during this run (for post-mortem / UI display)
    modifierHistory: [],

    // Phase
    phase: GAME_PHASES.PLAYING,
    lossReason: null,
    postMortem: null,
    selectedNodeId: null,
  };
}

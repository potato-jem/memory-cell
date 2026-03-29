// Game state shape and initialisation.
// Turn-based endless run. No situationStates array — single groundTruth + perceivedState.

import { initGroundTruth } from '../engine/groundTruth.js';
import { initPerceivedState } from './perceivedState.js';
import { initMemoryBank } from '../engine/memory.js';
import { makeReadyCell, computeTokensInUse } from '../engine/cells.js';
import { NODE_IDS } from '../data/nodes.js';
import { INITIAL_TOKEN_CAPACITY, TICKS_PER_TURN } from '../data/gameConfig.js';
import { DEFAULT_RUN_CONFIG } from '../data/runConfig.js';

export { TICKS_PER_TURN };

export const GAME_PHASES = {
  PLAYING: 'playing',
  LOST:    'lost',
};

export const LOSS_REASONS = {
  SYSTEMIC_COLLAPSE: 'systemic_collapse',
};

/**
 * Initialise fresh game state for an endless run.
 * @param {Object} runConfig  — optional override (default: DEFAULT_RUN_CONFIG)
 * @param {Object} existingMemoryBank — carry forward from previous run
 */
export function initGameState(runConfig = DEFAULT_RUN_CONFIG, existingMemoryBank = null) {
  // Build starting roster from runConfig.startingUnits
  const deployedCells = {};
  for (const { type, count } of (runConfig.startingUnits ?? [])) {
    for (let i = 0; i < count; i++) {
      const cell = makeReadyCell(type);
      deployedCells[cell.id] = cell;
    }
  }

  return {
    runConfig,

    // Ground truth — the hidden simulation
    groundTruth: initGroundTruth(),

    // Perceived state — what the player's immune system believes
    perceivedState: initPerceivedState(NODE_IDS),

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

    // Signals
    activeSignals: [],
    signalHistory: [],
    silenceNotices: [],

    // Memory bank — carries across runs
    memoryBank: existingMemoryBank ?? initMemoryBank(),

    // Phase
    phase: GAME_PHASES.PLAYING,
    lossReason: null,
    postMortem: null,
    selectedNodeId: null,
  };
}

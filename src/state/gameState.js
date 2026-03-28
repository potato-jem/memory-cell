// Game state shape and initialisation.
// Real-time: tick-based, token pool (no per-turn regen), paused flag.

import { initGroundTruth } from '../engine/groundTruth.js';
import { initPerceivedState } from './perceivedState.js';
import { initMemoryBank } from '../engine/memory.js';
import { NODE_IDS } from '../data/nodes.js';
import { INITIAL_TOKEN_CAPACITY, TICKS_PER_TURN } from '../data/gameConfig.js';

export { TICKS_PER_TURN };

export const GAME_PHASES = {
  PLAYING: 'playing',
  WON: 'won',
  LOST: 'lost',
  SELECT_SITUATION: 'select_situation',
};

export const LOSS_REASONS = {
  COHERENCE_COLLAPSE: 'coherence_collapse',
  TURN_LIMIT: 'turn_limit',
};

/**
 * Initialise fresh game state.
 * @param {Object|Object[]} situationDefs - single def or array for concurrent mode
 * @param {Object} existingMemoryBank - carry forward from previous situation
 */
export function initGameState(situationDefs, existingMemoryBank = null) {
  const situations = Array.isArray(situationDefs) ? situationDefs : [situationDefs];

  const situationStates = situations.map(def => ({
    id: def.id,
    situationDef: def,
    groundTruth: initGroundTruth(def),
    perceivedState: initPerceivedState(NODE_IDS),
    isResolved: false,
    resolvedOnTurn: null,
    resolvedCleanly: false,
  }));

  return {
    situationStates,
    activeSituationId: situations[0].id,

    // Shared cell deployment
    deployedCells: {},

    // Time tracking
    tick: 0,
    turn: 0,

    // Token capacity grows slowly via regen. Each roster cell holds its cost permanently.
    tokenCapacity: INITIAL_TOKEN_CAPACITY,
    attentionTokens: INITIAL_TOKEN_CAPACITY,  // = tokenCapacity - tokensInUse (UI compat)
    tokensInUse: 0,

    // Health
    healthScore: 100,
    coherenceScore: 100,
    coherenceHistory: [{ turn: 0, score: 100 }],

    // Signals
    activeSignals: [],
    signalHistory: [],
    silenceNotices: [],

    // Memory bank
    memoryBank: existingMemoryBank ?? initMemoryBank(),

    // Phase
    phase: GAME_PHASES.PLAYING,
    paused: false,
    lossReason: null,
    postMortem: null,
    selectedNodeId: null,
  };
}

export function getSituationState(gameState, situationId) {
  return gameState.situationStates.find(s => s.id === situationId) ?? gameState.situationStates[0];
}

export function getPrimaryGroundTruth(gameState) {
  return gameState.situationStates[0].groundTruth;
}

export function getPrimaryPerceivedState(gameState) {
  return gameState.situationStates[0].perceivedState;
}

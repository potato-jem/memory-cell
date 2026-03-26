// Game state shape and initialisation.
// Layer 2: multiple situations support, memory bank.

import { initGroundTruth } from '../engine/groundTruth.js';
import { initPerceivedState } from './perceivedState.js';
import { initMemoryBank } from '../engine/memory.js';
import { NODE_IDS } from '../data/nodes.js';

export const TOKENS_PER_TURN = 5;

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
  // Normalise to array
  const situations = Array.isArray(situationDefs) ? situationDefs : [situationDefs];

  // Build per-situation ground truth and perceived state
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
    activeSituationId: situations[0].id,  // which situation is shown in main view

    // Shared cell deployment across all situations
    deployedCells: {},

    // Turn and resource tracking
    turn: 1,
    attentionTokens: TOKENS_PER_TURN,
    tokensSpentThisTurn: 0,

    // Coherence (combined across all active situations)
    coherenceScore: 100,
    coherenceHistory: [{ turn: 0, score: 100 }],

    // Signals (combined from all situations, tagged by situationId)
    activeSignals: [],
    signalHistory: [],
    silenceNotices: [],
    routingDecisionsThisTurn: [],

    // Memory bank
    memoryBank: existingMemoryBank ?? initMemoryBank(),

    // Phase
    phase: GAME_PHASES.PLAYING,
    lossReason: null,
    postMortem: null,

    // Convenience accessors
    get primarySituation() {
      return this.situationStates[0];
    },
    get situationDef() {
      return this.situationStates[0].situationDef;
    },
  };
}

// Helper: get situation state by ID
export function getSituationState(gameState, situationId) {
  return gameState.situationStates.find(s => s.id === situationId) ?? gameState.situationStates[0];
}

// Helper: get ground truth for primary situation
export function getPrimaryGroundTruth(gameState) {
  return gameState.situationStates[0].groundTruth;
}

// Helper: get perceived state for primary situation
export function getPrimaryPerceivedState(gameState) {
  return gameState.situationStates[0].perceivedState;
}

// Game state shape and initialisation.
// Ground truth and perceived state are parallel — never conflated.

import { initGroundTruth } from '../engine/groundTruth.js';
import { initPerceivedState } from './perceivedState.js';
import { NODE_IDS } from '../data/nodes.js';

export const TOKENS_PER_TURN = 5;

export const GAME_PHASES = {
  PLAYING: 'playing',
  WON: 'won',
  LOST: 'lost',
};

export const LOSS_REASONS = {
  COHERENCE_COLLAPSE: 'coherence_collapse',
  TURN_LIMIT: 'turn_limit',
};

/**
 * Initialise fresh game state from a situation definition.
 */
export function initGameState(situationDef) {
  return {
    // The two parallel structures — never merge these
    groundTruth: initGroundTruth(situationDef),
    perceivedState: initPerceivedState(NODE_IDS),

    // Cell management
    deployedCells: {},

    // Turn and resource tracking
    turn: 1,
    attentionTokens: TOKENS_PER_TURN,
    tokensSpentThisTurn: 0,

    // Coherence
    coherenceScore: 100,
    coherenceHistory: [{ turn: 0, score: 100 }],

    // Signals
    activeSignals: [],      // awaiting routing decision
    signalHistory: [],      // all signals ever received + their routing decisions
    silenceNotices: [],     // "no signal from X" notices for this turn

    // This turn's routing decisions (for pressure calculation)
    routingDecisionsThisTurn: [],

    // Situation reference
    situationDef,

    // Phase
    phase: GAME_PHASES.PLAYING,
    lossReason: null,
    postMortem: null,
  };
}

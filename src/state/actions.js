// All state mutations as pure functions (action handlers).
// Each action validates, deducts tokens, returns updated game state.
// endTurn() drives the engine layer.

import { ROUTING_COSTS } from '../data/signals.js';
import { advanceGroundTruth } from '../engine/groundTruth.js';
import { generateSignals, generateSilenceNotices } from '../engine/signalGenerator.js';
import { computeCoherence, isCoherenceCollapsed, computeRoutingPressure, identifyFailureMode } from '../engine/coherence.js';
import {
  deployDendriticCell,
  deployNeutrophilPatrol,
  deployResponder,
  recallUnit,
  advanceCells,
  hasDendriticConfirmation,
  DEPLOY_COSTS,
} from '../engine/cells.js';
import {
  applySignalToPerceivedState,
  applyRoutingDecision,
  applyDendriticReturn,
  applyResponderDeployed,
  applyNeutrophilDeployed,
} from './perceivedState.js';
import { TOKENS_PER_TURN, GAME_PHASES, LOSS_REASONS } from './gameState.js';
import { isPathodgenCleared } from '../engine/pathogen.js';

export const ACTION_TYPES = {
  ROUTE_SIGNAL: 'ROUTE_SIGNAL',
  DEPLOY_DENDRITIC: 'DEPLOY_DENDRITIC',
  DEPLOY_NEUTROPHIL: 'DEPLOY_NEUTROPHIL',
  DEPLOY_RESPONDER: 'DEPLOY_RESPONDER',
  RECALL_UNIT: 'RECALL_UNIT',
  END_TURN: 'END_TURN',
  RESTART: 'RESTART',
  SELECT_NODE: 'SELECT_NODE',
};

/**
 * The main reducer — handles all game actions.
 */
export function gameReducer(state, action) {
  if (state.phase !== GAME_PHASES.PLAYING && action.type !== ACTION_TYPES.RESTART) {
    return state;
  }

  switch (action.type) {
    case ACTION_TYPES.ROUTE_SIGNAL:
      return handleRouteSignal(state, action.signalId, action.decision);

    case ACTION_TYPES.DEPLOY_DENDRITIC:
      return handleDeployDendritic(state, action.nodeId);

    case ACTION_TYPES.DEPLOY_NEUTROPHIL:
      return handleDeployNeutrophil(state, action.nodeId);

    case ACTION_TYPES.DEPLOY_RESPONDER:
      return handleDeployResponder(state, action.nodeId);

    case ACTION_TYPES.RECALL_UNIT:
      return handleRecallUnit(state, action.cellId);

    case ACTION_TYPES.END_TURN:
      return handleEndTurn(state);

    case ACTION_TYPES.RESTART:
      return action.initialState;

    case ACTION_TYPES.SELECT_NODE:
      return { ...state, selectedNodeId: action.nodeId };

    default:
      return state;
  }
}

// ── Individual action handlers ──────────────────────────────────────────────

function handleRouteSignal(state, signalId, decision) {
  const signal = state.activeSignals.find(s => s.id === signalId);
  if (!signal) return state;

  const cost = ROUTING_COSTS[decision] ?? 1;
  if (state.attentionTokens < cost) return state; // insufficient tokens

  // Mark signal as routed
  const updatedSignal = { ...signal, routed: true, routingDecision: decision };

  // Update active signals (remove this one from queue)
  const activeSignals = state.activeSignals.filter(s => s.id !== signalId);

  // Add to history
  const signalHistory = [...state.signalHistory, updatedSignal];

  // Update perceived state based on routing decision
  const perceivedState = applyRoutingDecision(state.perceivedState, signal, decision);

  return {
    ...state,
    activeSignals,
    signalHistory,
    perceivedState,
    attentionTokens: state.attentionTokens - cost,
    tokensSpentThisTurn: state.tokensSpentThisTurn + cost,
    routingDecisionsThisTurn: [
      ...state.routingDecisionsThisTurn,
      { signalId, decision, nodeId: signal.nodeId },
    ],
  };
}

function handleDeployDendritic(state, nodeId) {
  const result = deployDendriticCell(
    nodeId,
    state.deployedCells,
    state.attentionTokens,
    state.turn
  );

  if (!result.success) return state;

  return {
    ...state,
    deployedCells: result.newDeployedCells,
    attentionTokens: state.attentionTokens - result.cost,
    tokensSpentThisTurn: state.tokensSpentThisTurn + result.cost,
  };
}

function handleDeployNeutrophil(state, nodeId) {
  const result = deployNeutrophilPatrol(
    nodeId,
    state.deployedCells,
    state.attentionTokens,
    state.turn
  );

  if (!result.success) return state;

  const perceivedState = applyNeutrophilDeployed(state.perceivedState, nodeId);

  return {
    ...state,
    deployedCells: result.newDeployedCells,
    perceivedState,
    attentionTokens: state.attentionTokens - result.cost,
    tokensSpentThisTurn: state.tokensSpentThisTurn + result.cost,
  };
}

function handleDeployResponder(state, nodeId) {
  const dendriticConfirm = hasDendriticConfirmation(nodeId, state.deployedCells);
  const result = deployResponder(
    nodeId,
    state.deployedCells,
    state.attentionTokens,
    state.turn,
    dendriticConfirm
  );

  if (!result.success) return state;

  const perceivedState = applyResponderDeployed(state.perceivedState, nodeId);

  return {
    ...state,
    deployedCells: result.newDeployedCells,
    perceivedState,
    attentionTokens: state.attentionTokens - result.cost,
    tokensSpentThisTurn: state.tokensSpentThisTurn + result.cost,
  };
}

function handleRecallUnit(state, cellId) {
  const result = recallUnit(cellId, state.deployedCells);
  if (!result.success) return state;

  return {
    ...state,
    deployedCells: result.newDeployedCells,
    // Recall is free — no token cost
  };
}

function handleEndTurn(state) {
  const nextTurn = state.turn + 1;

  // Compute routing pressure from this turn's decisions
  const routingPressure = computeRoutingPressure(state.routingDecisionsThisTurn);

  // Advance ground truth
  const { newGroundTruth, events } = advanceGroundTruth(
    state.groundTruth,
    state.situationDef,
    state.deployedCells,
    nextTurn,
    routingPressure
  );

  // Advance cells (handle dendritic transit)
  const advancedCells = advanceCells(state.deployedCells, nextTurn);

  // Apply dendritic returns to perceived state
  let perceivedState = state.perceivedState;
  for (const [cellId, cell] of Object.entries(advancedCells)) {
    const wasInTransit = state.deployedCells[cellId]?.inTransit;
    const nowArrived = !cell.inTransit && cell.type === 'dendritic';
    if (wasInTransit && nowArrived) {
      const pathogenHere = newGroundTruth.pathogenState[cell.nodeId];
      const foundThreat = pathogenHere && pathogenHere.strength > 0;
      perceivedState = applyDendriticReturn(perceivedState, cell.nodeId, foundThreat);
    }
  }

  // Apply new signals
  const seededEventsThisTurn = (state.situationDef.seededEvents ?? []).filter(
    e => e.turn === nextTurn
  );

  const newSignals = generateSignals(
    newGroundTruth,
    advancedCells,
    state.situationDef,
    nextTurn,
    seededEventsThisTurn
  );

  // Apply incoming signals to perceived state
  for (const signal of newSignals) {
    perceivedState = applySignalToPerceivedState(perceivedState, signal);
  }

  // Silence notices
  const silenceNotices = generateSilenceNotices(newGroundTruth, advancedCells, nextTurn);

  // Carry over unrouted signals (aged +1 delay) + add new signals
  const agedUnrouted = state.activeSignals.map(s => ({ ...s, delay: s.delay + 1 }));
  const activeSignals = [...agedUnrouted, ...newSignals];

  // Recompute coherence
  const { score: coherenceScore, breakdown } = computeCoherence(newGroundTruth, perceivedState);
  const coherenceHistory = [...state.coherenceHistory, { turn: nextTurn, score: coherenceScore }];

  // Check win/lose conditions
  const pathogenCleared = isPathodgenCleared(newGroundTruth.pathogenState);
  const coherenceCollapsed = isCoherenceCollapsed(coherenceScore);
  const turnLimitReached = nextTurn >= state.situationDef.turnLimit;

  let phase = state.phase;
  let lossReason = null;
  let postMortem = null;

  if (pathogenCleared) {
    phase = GAME_PHASES.WON;
    postMortem = buildPostMortem(state, newGroundTruth, coherenceHistory, breakdown, 'win');
  } else if (coherenceCollapsed) {
    phase = GAME_PHASES.LOST;
    lossReason = LOSS_REASONS.COHERENCE_COLLAPSE;
    postMortem = buildPostMortem(state, newGroundTruth, coherenceHistory, breakdown, 'coherence_collapse');
  } else if (turnLimitReached) {
    phase = GAME_PHASES.LOST;
    lossReason = LOSS_REASONS.TURN_LIMIT;
    postMortem = buildPostMortem(state, newGroundTruth, coherenceHistory, breakdown, 'turn_limit');
  }

  return {
    ...state,
    groundTruth: newGroundTruth,
    perceivedState,
    deployedCells: advancedCells,
    turn: nextTurn,
    attentionTokens: TOKENS_PER_TURN,
    tokensSpentThisTurn: 0,
    activeSignals,
    signalHistory: [...state.signalHistory, ...newSignals],
    silenceNotices,
    coherenceScore,
    coherenceHistory,
    routingDecisionsThisTurn: [],
    phase,
    lossReason,
    postMortem,
  };
}

// ── Post-mortem ─────────────────────────────────────────────────────────────

function buildPostMortem(state, finalGroundTruth, coherenceHistory, finalBreakdown, outcome) {
  const allSignals = [...state.signalHistory];
  const failureMode = outcome === 'win' ? 'win' : identifyFailureMode(coherenceHistory, finalBreakdown);

  // Annotate signals with retrospective accuracy info
  const annotatedSignals = allSignals.map(signal => ({
    ...signal,
    retrospectiveLabel: signal._wasAccurate
      ? (signal.isFalseAlarm ? 'false_alarm' : 'accurate')
      : 'inaccurate',
  }));

  // Find key decision points from the situation definition
  const keyDecisions = findKeyDecisions(state, coherenceHistory);

  return {
    outcome,
    failureMode,
    finalGroundTruth: {
      nodeStates: finalGroundTruth.nodeStates,
      pathogenState: finalGroundTruth.pathogenState,
      spreadHistory: finalGroundTruth.spreadHistory,
      spleenStress: finalGroundTruth.spleenStress,
    },
    coherenceHistory,
    annotatedSignals,
    keyDecisions,
    finalCoherenceBreakdown: finalBreakdown,
    turnsPlayed: state.turn,
  };
}

function findKeyDecisions(state, coherenceHistory) {
  const decisionPoints = state.situationDef.decisionPoints ?? [];
  const decisions = [];

  for (const dp of decisionPoints) {
    const [startTurn, endTurn] = dp.turns;

    // Check coherence change during this window
    const windowScores = coherenceHistory.filter(
      h => h.turn >= startTurn && h.turn <= endTurn
    );

    if (windowScores.length < 2) continue;

    const delta = windowScores[windowScores.length - 1].score - windowScores[0].score;
    const wasSignificant = Math.abs(delta) > 5;

    decisions.push({
      label: dp.label,
      turns: dp.turns,
      description: dp.description,
      coherenceDelta: Math.round(delta),
      wasSignificant,
    });
  }

  return decisions;
}

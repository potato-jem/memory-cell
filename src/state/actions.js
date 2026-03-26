// All state mutations as pure functions.
// Layer 2: multi-situation support, new cell types, memory bank.

import { ROUTING_COSTS } from '../data/signals.js';
import { advanceGroundTruth } from '../engine/groundTruth.js';
import { generateSignals, generateSilenceNotices } from '../engine/signalGenerator.js';
import {
  computeCoherence,
  isCoherenceCollapsed,
  computeRoutingPressure,
  identifyFailureMode,
} from '../engine/coherence.js';
import {
  deployDendriticCell,
  deployNeutrophilPatrol,
  deployResponder,
  deployKillerT,
  deployBCell,
  deployNKCell,
  deployMacrophage,
  recallUnit,
  advanceCells,
  hasDendriticConfirmation,
} from '../engine/cells.js';
import {
  applySignalToPerceivedState,
  applyRoutingDecision,
  applyDendriticReturn,
  applyResponderDeployed,
  applyNeutrophilDeployed,
} from './perceivedState.js';
import {
  TOKENS_PER_TURN,
  GAME_PHASES,
  LOSS_REASONS,
  initGameState,
} from './gameState.js';
import { isPathodgenCleared } from '../engine/pathogen.js';
import { recordEncounter } from '../engine/memory.js';

export const ACTION_TYPES = {
  ROUTE_SIGNAL: 'ROUTE_SIGNAL',
  DEPLOY_DENDRITIC: 'DEPLOY_DENDRITIC',
  DEPLOY_NEUTROPHIL: 'DEPLOY_NEUTROPHIL',
  DEPLOY_RESPONDER: 'DEPLOY_RESPONDER',
  DEPLOY_KILLER_T: 'DEPLOY_KILLER_T',
  DEPLOY_B_CELL: 'DEPLOY_B_CELL',
  DEPLOY_NK_CELL: 'DEPLOY_NK_CELL',
  DEPLOY_MACROPHAGE: 'DEPLOY_MACROPHAGE',
  RECALL_UNIT: 'RECALL_UNIT',
  END_TURN: 'END_TURN',
  RESTART: 'RESTART',
  SELECT_NODE: 'SELECT_NODE',
  SELECT_SITUATION: 'SELECT_SITUATION',
};

export function gameReducer(state, action) {
  if (state.phase !== GAME_PHASES.PLAYING && action.type !== ACTION_TYPES.RESTART) {
    return state;
  }

  switch (action.type) {
    case ACTION_TYPES.ROUTE_SIGNAL:
      return handleRouteSignal(state, action.signalId, action.decision);
    case ACTION_TYPES.DEPLOY_DENDRITIC:
      return handleDeploy(state, action.nodeId, deployDendriticCell);
    case ACTION_TYPES.DEPLOY_NEUTROPHIL:
      return handleDeployNeutrophil(state, action.nodeId);
    case ACTION_TYPES.DEPLOY_RESPONDER:
      return handleDeployResponder(state, action.nodeId);
    case ACTION_TYPES.DEPLOY_KILLER_T:
      return handleDeployKillerT(state, action.nodeId);
    case ACTION_TYPES.DEPLOY_B_CELL:
      return handleDeployBCell(state, action.nodeId);
    case ACTION_TYPES.DEPLOY_NK_CELL:
      return handleDeploy(state, action.nodeId, deployNKCell);
    case ACTION_TYPES.DEPLOY_MACROPHAGE:
      return handleDeploy(state, action.nodeId, deployMacrophage);
    case ACTION_TYPES.RECALL_UNIT:
      return handleRecallUnit(state, action.cellId);
    case ACTION_TYPES.END_TURN:
      return handleEndTurn(state);
    case ACTION_TYPES.RESTART:
      return action.initialState;
    case ACTION_TYPES.SELECT_NODE:
      return { ...state, selectedNodeId: action.nodeId };
    case ACTION_TYPES.SELECT_SITUATION:
      return { ...state, activeSituationId: action.situationId };
    default:
      return state;
  }
}

// ── Action handlers ───────────────────────────────────────────────────────────

function handleRouteSignal(state, signalId, decision) {
  const signal = state.activeSignals.find(s => s.id === signalId);
  if (!signal) return state;

  const cost = ROUTING_COSTS[decision] ?? 1;
  if (state.attentionTokens < cost) return state;

  const updatedSignal = { ...signal, routed: true, routingDecision: decision };
  const activeSignals = state.activeSignals.filter(s => s.id !== signalId);
  const signalHistory = [...state.signalHistory, updatedSignal];

  // Update perceived state for the relevant situation
  const situationId = signal.situationId ?? state.situationStates[0].id;
  const updatedSituationStates = updatePerceivedStateForSituation(
    state.situationStates,
    situationId,
    ps => applyRoutingDecision(ps, signal, decision)
  );

  return {
    ...state,
    activeSignals,
    signalHistory,
    situationStates: updatedSituationStates,
    attentionTokens: state.attentionTokens - cost,
    tokensSpentThisTurn: state.tokensSpentThisTurn + cost,
    routingDecisionsThisTurn: [
      ...state.routingDecisionsThisTurn,
      { signalId, decision, nodeId: signal.nodeId },
    ],
  };
}

function handleDeploy(state, nodeId, deployFn) {
  const result = deployFn(nodeId, state.deployedCells, state.attentionTokens, state.turn);
  if (!result.success) return state;

  return {
    ...state,
    deployedCells: result.newDeployedCells,
    attentionTokens: state.attentionTokens - result.cost,
    tokensSpentThisTurn: state.tokensSpentThisTurn + result.cost,
  };
}

function handleDeployNeutrophil(state, nodeId) {
  const result = deployNeutrophilPatrol(nodeId, state.deployedCells, state.attentionTokens, state.turn);
  if (!result.success) return state;

  // Update perceived state for primary situation (neutrophil is situation-agnostic)
  const updatedSituationStates = updatePerceivedStateForSituation(
    state.situationStates,
    state.situationStates[0].id,
    ps => applyNeutrophilDeployed(ps, nodeId)
  );

  return {
    ...state,
    deployedCells: result.newDeployedCells,
    situationStates: updatedSituationStates,
    attentionTokens: state.attentionTokens - result.cost,
    tokensSpentThisTurn: state.tokensSpentThisTurn + result.cost,
  };
}

function handleDeployResponder(state, nodeId) {
  const dendriticConfirm = hasDendriticConfirmation(nodeId, state.deployedCells);
  const result = deployResponder(nodeId, state.deployedCells, state.attentionTokens, state.turn, dendriticConfirm);
  if (!result.success) return state;

  const updatedSituationStates = updatePerceivedStateForSituation(
    state.situationStates,
    state.situationStates[0].id,
    ps => applyResponderDeployed(ps, nodeId)
  );

  return {
    ...state,
    deployedCells: result.newDeployedCells,
    situationStates: updatedSituationStates,
    attentionTokens: state.attentionTokens - result.cost,
    tokensSpentThisTurn: state.tokensSpentThisTurn + result.cost,
  };
}

function handleDeployKillerT(state, nodeId) {
  const dendriticConfirm = hasDendriticConfirmation(nodeId, state.deployedCells);
  const result = deployKillerT(nodeId, state.deployedCells, state.attentionTokens, state.turn, dendriticConfirm);
  if (!result.success) return state;

  const updatedSituationStates = updatePerceivedStateForSituation(
    state.situationStates,
    state.situationStates[0].id,
    ps => applyResponderDeployed(ps, nodeId)
  );

  return {
    ...state,
    deployedCells: result.newDeployedCells,
    situationStates: updatedSituationStates,
    attentionTokens: state.attentionTokens - result.cost,
    tokensSpentThisTurn: state.tokensSpentThisTurn + result.cost,
  };
}

function handleDeployBCell(state, nodeId) {
  const dendriticConfirm = hasDendriticConfirmation(nodeId, state.deployedCells);
  const result = deployBCell(nodeId, state.deployedCells, state.attentionTokens, state.turn, dendriticConfirm);
  if (!result.success) return state;

  const updatedSituationStates = updatePerceivedStateForSituation(
    state.situationStates,
    state.situationStates[0].id,
    ps => applyResponderDeployed(ps, nodeId)
  );

  return {
    ...state,
    deployedCells: result.newDeployedCells,
    situationStates: updatedSituationStates,
    attentionTokens: state.attentionTokens - result.cost,
    tokensSpentThisTurn: state.tokensSpentThisTurn + result.cost,
  };
}

function handleRecallUnit(state, cellId) {
  const result = recallUnit(cellId, state.deployedCells);
  if (!result.success) return state;
  return { ...state, deployedCells: result.newDeployedCells };
}

function handleEndTurn(state) {
  const nextTurn = state.turn + 1;
  const routingPressure = computeRoutingPressure(state.routingDecisionsThisTurn);

  // Advance cells
  const advancedCells = advanceCells(state.deployedCells, nextTurn);

  // Advance each situation
  let updatedSituationStates = state.situationStates.map(sit => {
    if (sit.isResolved) return sit;

    const { newGroundTruth, events } = advanceGroundTruth(
      sit.groundTruth,
      sit.situationDef,
      advancedCells,
      nextTurn,
      routingPressure
    );

    // Handle dendritic returns
    let perceivedState = sit.perceivedState;
    for (const [cellId, cell] of Object.entries(advancedCells)) {
      const wasInTransit = state.deployedCells[cellId]?.inTransit;
      const nowArrived = !cell.inTransit && cell.type === 'dendritic';
      if (wasInTransit && nowArrived) {
        const pathogenHere = newGroundTruth.pathogenState[cell.nodeId];
        const foundThreat = pathogenHere && pathogenHere.strength > 0;
        perceivedState = applyDendriticReturn(perceivedState, cell.nodeId, foundThreat);
      }
    }

    // Generate signals
    const seededEventsThisTurn = (sit.situationDef.seededEvents ?? []).filter(
      e => e.turn === nextTurn
    );
    const newSignals = generateSignals(
      newGroundTruth,
      advancedCells,
      sit.situationDef,
      nextTurn,
      seededEventsThisTurn,
      state.memoryBank,
      sit.id
    );

    // Apply signals to perceived state
    for (const signal of newSignals) {
      perceivedState = applySignalToPerceivedState(perceivedState, signal);
    }

    const pathogenCleared = isPathodgenCleared(newGroundTruth.pathogenState);

    return {
      ...sit,
      groundTruth: newGroundTruth,
      perceivedState,
      newSignalsThisTurn: newSignals,
      isResolved: pathogenCleared,
      resolvedOnTurn: pathogenCleared && !sit.isResolved ? nextTurn : sit.resolvedOnTurn,
      resolvedCleanly: pathogenCleared,
    };
  });

  // Collect all new signals from all situations
  const allNewSignals = updatedSituationStates.flatMap(s => s.newSignalsThisTurn ?? []);

  // Silence notices from primary situation
  const primarySit = updatedSituationStates[0];
  const silenceNotices = generateSilenceNotices(primarySit.groundTruth, advancedCells, nextTurn);

  // Combine perceived states for coherence calculation
  // Use primary situation for coherence (multi-situation coherence is additive)
  let totalCoherenceGap = 0;
  let combinedBreakdown = [];
  for (const sit of updatedSituationStates) {
    if (sit.isResolved) continue;
    const { score, breakdown } = computeCoherence(sit.groundTruth, sit.perceivedState);
    totalCoherenceGap += (100 - score);
    combinedBreakdown = [...combinedBreakdown, ...breakdown];
  }
  const coherenceScore = Math.max(0, Math.round(100 - totalCoherenceGap));

  const coherenceHistory = [...state.coherenceHistory, { turn: nextTurn, score: coherenceScore }];

  // Carry over unrouted signals
  const agedUnrouted = state.activeSignals
    .filter(s => !s.routed)
    .map(s => ({ ...s, delay: s.delay + 1 }));
  const activeSignals = [...agedUnrouted, ...allNewSignals];

  // Check win/lose
  const allResolved = updatedSituationStates.every(s => s.isResolved);
  const coherenceCollapsed = isCoherenceCollapsed(coherenceScore);
  const turnLimitReached = nextTurn >= Math.min(...updatedSituationStates.map(s => s.situationDef.turnLimit));

  // Update memory bank for resolved situations
  let memoryBank = state.memoryBank;
  for (const sit of updatedSituationStates) {
    if (sit.isResolved && !state.situationStates.find(s => s.id === sit.id)?.isResolved) {
      const threatType = sit.situationDef.pathogen.type;
      memoryBank = recordEncounter(memoryBank, threatType, sit.resolvedCleanly);
    }
  }

  let phase = state.phase;
  let lossReason = null;
  let postMortem = null;

  if (allResolved) {
    phase = GAME_PHASES.WON;
    postMortem = buildPostMortem(state, updatedSituationStates, coherenceHistory, combinedBreakdown, 'win');
  } else if (coherenceCollapsed) {
    phase = GAME_PHASES.LOST;
    lossReason = LOSS_REASONS.COHERENCE_COLLAPSE;
    postMortem = buildPostMortem(state, updatedSituationStates, coherenceHistory, combinedBreakdown, 'coherence_collapse');
  } else if (turnLimitReached) {
    phase = GAME_PHASES.LOST;
    lossReason = LOSS_REASONS.TURN_LIMIT;
    postMortem = buildPostMortem(state, updatedSituationStates, coherenceHistory, combinedBreakdown, 'turn_limit');
  }

  // Clean up newSignalsThisTurn from situation states
  updatedSituationStates = updatedSituationStates.map(s => {
    const { newSignalsThisTurn, ...rest } = s;
    return rest;
  });

  return {
    ...state,
    situationStates: updatedSituationStates,
    deployedCells: advancedCells,
    turn: nextTurn,
    attentionTokens: TOKENS_PER_TURN,
    tokensSpentThisTurn: 0,
    activeSignals,
    signalHistory: [...state.signalHistory, ...allNewSignals],
    silenceNotices,
    coherenceScore,
    coherenceHistory,
    routingDecisionsThisTurn: [],
    memoryBank,
    phase,
    lossReason,
    postMortem,
  };
}

// ── Helper: update perceived state for one situation ──────────────────────────

function updatePerceivedStateForSituation(situationStates, situationId, updaterFn) {
  return situationStates.map(sit => {
    if (sit.id !== situationId) return sit;
    return { ...sit, perceivedState: updaterFn(sit.perceivedState) };
  });
}

// ── Post-mortem ───────────────────────────────────────────────────────────────

function buildPostMortem(state, situationStates, coherenceHistory, finalBreakdown, outcome) {
  const allSignals = [...state.signalHistory];
  const primarySit = situationStates[0];
  const failureMode = outcome === 'win' ? 'win' : identifyFailureMode(coherenceHistory, finalBreakdown);

  const annotatedSignals = allSignals.map(signal => ({
    ...signal,
    retrospectiveLabel: signal.isFalseAlarm ? 'false_alarm' : signal._wasAccurate ? 'accurate' : 'inaccurate',
  }));

  const keyDecisions = findKeyDecisions(state, coherenceHistory, primarySit.situationDef);

  // Build final ground truth from all situations
  const situationSummaries = situationStates.map(sit => ({
    id: sit.id,
    name: sit.situationDef.name,
    pathogenType: sit.situationDef.pathogen.type,
    isResolved: sit.isResolved,
    resolvedOnTurn: sit.resolvedOnTurn,
    finalGroundTruth: {
      nodeStates: sit.groundTruth.nodeStates,
      pathogenState: sit.groundTruth.pathogenState,
      spreadHistory: sit.groundTruth.spreadHistory,
      spleenStress: sit.groundTruth.spleenStress,
    },
  }));

  return {
    outcome,
    failureMode,
    // Keep primary situation ground truth for backward compat
    finalGroundTruth: situationSummaries[0].finalGroundTruth,
    situationSummaries,
    coherenceHistory,
    annotatedSignals,
    keyDecisions,
    finalCoherenceBreakdown: finalBreakdown,
    turnsPlayed: state.turn,
    memoryBank: state.memoryBank,
  };
}

function findKeyDecisions(state, coherenceHistory, situationDef) {
  const decisionPoints = situationDef.decisionPoints ?? [];
  return decisionPoints.map(dp => {
    const [startTurn, endTurn] = dp.turns;
    const windowScores = coherenceHistory.filter(h => h.turn >= startTurn && h.turn <= endTurn);
    if (windowScores.length < 2) return { ...dp, coherenceDelta: 0, wasSignificant: false };

    const delta = windowScores[windowScores.length - 1].score - windowScores[0].score;
    return {
      label: dp.label,
      turns: dp.turns,
      description: dp.description,
      coherenceDelta: Math.round(delta),
      wasSignificant: Math.abs(delta) > 5,
    };
  });
}

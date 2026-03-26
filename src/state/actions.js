// All state mutations as pure functions.
// Routing redesign: no more FWD/AMP/SUP/QRN costs — tokens are for cell deployment only.
// Signal decisions: DISMISS (free) or HOLD (free). Cell deployment is the primary action.

import { advanceGroundTruth } from '../engine/groundTruth.js';
import { generateSignals, generateSilenceNotices } from '../engine/signalGenerator.js';
import {
  computeCoherence,
  isCoherenceCollapsed,
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
  dismissEntity,
} from './perceivedState.js';
import {
  TOKENS_PER_TURN,
  GAME_PHASES,
  LOSS_REASONS,
} from './gameState.js';
import { isPathodgenCleared } from '../engine/pathogen.js';
import { recordEncounter } from '../engine/memory.js';

export const ACTION_TYPES = {
  DISMISS_SIGNAL: 'DISMISS_SIGNAL',
  HOLD_SIGNAL: 'HOLD_SIGNAL',
  DISMISS_ENTITY: 'DISMISS_ENTITY',
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
    case ACTION_TYPES.DISMISS_SIGNAL:
      return handleSignalDecision(state, action.signalId, 'dismiss');
    case ACTION_TYPES.HOLD_SIGNAL:
      return handleSignalDecision(state, action.signalId, 'hold');
    case ACTION_TYPES.DISMISS_ENTITY:
      return handleDismissEntity(state, action.nodeId, action.entityId);
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

// ── Signal decisions (free — no token cost) ───────────────────────────────────

function handleSignalDecision(state, signalId, decision) {
  const signal = state.activeSignals.find(s => s.id === signalId);
  if (!signal) return state;

  const updatedSignal = { ...signal, routed: true, routingDecision: decision };
  const activeSignals = state.activeSignals.filter(s => s.id !== signalId);
  const signalHistory = [...state.signalHistory, updatedSignal];

  const situationId = signal.situationId ?? state.situationStates[0].id;
  const updatedSituationStates = updatePerceivedStateForSituation(
    state.situationStates,
    situationId,
    ps => applyRoutingDecision(ps, signal, decision)
  );

  return { ...state, activeSignals, signalHistory, situationStates: updatedSituationStates };
}

function handleDismissEntity(state, nodeId, entityId) {
  const primaryId = state.situationStates[0].id;
  const updatedSituationStates = updatePerceivedStateForSituation(
    state.situationStates,
    primaryId,
    ps => dismissEntity(ps, nodeId, entityId)
  );
  return { ...state, situationStates: updatedSituationStates };
}

// ── Cell deployment ───────────────────────────────────────────────────────────

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

  const updatedSituationStates = updatePerceivedStateForSituation(
    state.situationStates, state.situationStates[0].id,
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
  const dc = hasDendriticConfirmation(nodeId, state.deployedCells);
  const result = deployResponder(nodeId, state.deployedCells, state.attentionTokens, state.turn, dc);
  if (!result.success) return state;

  const updatedSituationStates = updatePerceivedStateForSituation(
    state.situationStates, state.situationStates[0].id,
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
  const dc = hasDendriticConfirmation(nodeId, state.deployedCells);
  const result = deployKillerT(nodeId, state.deployedCells, state.attentionTokens, state.turn, dc);
  if (!result.success) return state;

  const updatedSituationStates = updatePerceivedStateForSituation(
    state.situationStates, state.situationStates[0].id,
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
  const dc = hasDendriticConfirmation(nodeId, state.deployedCells);
  const result = deployBCell(nodeId, state.deployedCells, state.attentionTokens, state.turn, dc);
  if (!result.success) return state;

  const updatedSituationStates = updatePerceivedStateForSituation(
    state.situationStates, state.situationStates[0].id,
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

// ── End turn ──────────────────────────────────────────────────────────────────

function handleEndTurn(state) {
  const nextTurn = state.turn + 1;

  // Spleen stress now driven by deployed cell count rather than routing pressure
  const activeCellCount = Object.keys(state.deployedCells).length;
  const routingPressure = Math.min(1, activeCellCount * 0.05);

  const advancedCells = advanceCells(state.deployedCells, nextTurn);

  let updatedSituationStates = state.situationStates.map(sit => {
    if (sit.isResolved) return sit;

    const { newGroundTruth, events } = advanceGroundTruth(
      sit.groundTruth,
      sit.situationDef,
      advancedCells,
      nextTurn,
      routingPressure
    );

    let perceivedState = sit.perceivedState;

    // Handle dendritic returns
    for (const [cellId, cell] of Object.entries(advancedCells)) {
      const wasInTransit = state.deployedCells[cellId]?.inTransit;
      const nowArrived = !cell.inTransit && cell.type === 'dendritic';
      if (wasInTransit && nowArrived) {
        const pathogenHere = newGroundTruth.pathogenState[cell.nodeId];
        const foundThreat = pathogenHere && pathogenHere.strength > 0;
        const threatType = foundThreat ? sit.situationDef.pathogen.type : null;
        perceivedState = applyDendriticReturn(perceivedState, cell.nodeId, foundThreat, threatType);
      }
    }

    // Generate signals
    const seededEventsThisTurn = (sit.situationDef.seededEvents ?? []).filter(
      e => e.turn === nextTurn
    );
    const newSignals = generateSignals(
      newGroundTruth, advancedCells, sit.situationDef,
      nextTurn, seededEventsThisTurn, state.memoryBank, sit.id
    );

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

  const allNewSignals = updatedSituationStates.flatMap(s => s.newSignalsThisTurn ?? []);
  const primarySit = updatedSituationStates[0];
  const silenceNotices = generateSilenceNotices(primarySit.groundTruth, advancedCells, nextTurn);

  // Health score (was coherence)
  let totalGap = 0;
  let combinedBreakdown = [];
  for (const sit of updatedSituationStates) {
    if (sit.isResolved) continue;
    const { score, breakdown } = computeCoherence(sit.groundTruth, sit.perceivedState);
    totalGap += (100 - score);
    combinedBreakdown = [...combinedBreakdown, ...breakdown];
  }
  const healthScore = Math.max(0, Math.round(100 - totalGap));
  const coherenceHistory = [...state.coherenceHistory, { turn: nextTurn, score: healthScore }];

  // Carry over unrouted signals
  const agedUnrouted = state.activeSignals
    .filter(s => !s.routed)
    .map(s => ({ ...s, delay: s.delay + 1 }));
  const activeSignals = [...agedUnrouted, ...allNewSignals];

  // Win/lose
  const allResolved = updatedSituationStates.every(s => s.isResolved);
  const healthCollapsed = isCoherenceCollapsed(healthScore);
  const turnLimitReached = nextTurn >= Math.min(...updatedSituationStates.map(s => s.situationDef.turnLimit));

  // Memory bank
  let memoryBank = state.memoryBank;
  for (const sit of updatedSituationStates) {
    if (sit.isResolved && !state.situationStates.find(s => s.id === sit.id)?.isResolved) {
      memoryBank = recordEncounter(memoryBank, sit.situationDef.pathogen.type, sit.resolvedCleanly);
    }
  }

  let phase = state.phase;
  let lossReason = null;
  let postMortem = null;

  if (allResolved) {
    phase = GAME_PHASES.WON;
    postMortem = buildPostMortem(state, updatedSituationStates, coherenceHistory, combinedBreakdown, 'win');
  } else if (healthCollapsed) {
    phase = GAME_PHASES.LOST;
    lossReason = LOSS_REASONS.COHERENCE_COLLAPSE;
    postMortem = buildPostMortem(state, updatedSituationStates, coherenceHistory, combinedBreakdown, 'coherence_collapse');
  } else if (turnLimitReached) {
    phase = GAME_PHASES.LOST;
    lossReason = LOSS_REASONS.TURN_LIMIT;
    postMortem = buildPostMortem(state, updatedSituationStates, coherenceHistory, combinedBreakdown, 'turn_limit');
  }

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
    coherenceScore: healthScore, // keep field name for compat
    healthScore,
    coherenceHistory,
    routingDecisionsThisTurn: [],
    memoryBank,
    phase,
    lossReason,
    postMortem,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function updatePerceivedStateForSituation(situationStates, situationId, updaterFn) {
  return situationStates.map(sit => {
    if (sit.id !== situationId) return sit;
    return { ...sit, perceivedState: updaterFn(sit.perceivedState) };
  });
}

function buildPostMortem(state, situationStates, coherenceHistory, finalBreakdown, outcome) {
  const allSignals = [...state.signalHistory];
  const primarySit = situationStates[0];
  const failureMode = outcome === 'win' ? 'win' : identifyFailureMode(coherenceHistory, finalBreakdown);

  const annotatedSignals = allSignals.map(signal => ({
    ...signal,
    retrospectiveLabel: signal.isFalseAlarm ? 'false_alarm' : signal._wasAccurate ? 'accurate' : 'inaccurate',
  }));

  const keyDecisions = (primarySit.situationDef.decisionPoints ?? []).map(dp => {
    const [s, e] = dp.turns;
    const window = coherenceHistory.filter(h => h.turn >= s && h.turn <= e);
    if (window.length < 2) return { ...dp, coherenceDelta: 0, wasSignificant: false };
    const delta = window[window.length - 1].score - window[0].score;
    return { label: dp.label, turns: dp.turns, description: dp.description, coherenceDelta: Math.round(delta), wasSignificant: Math.abs(delta) > 5 };
  });

  return {
    outcome,
    failureMode,
    finalGroundTruth: {
      nodeStates: situationStates[0].groundTruth.nodeStates,
      pathogenState: situationStates[0].groundTruth.pathogenState,
      spreadHistory: situationStates[0].groundTruth.spreadHistory,
      spleenStress: situationStates[0].groundTruth.spleenStress,
    },
    situationSummaries: situationStates.map(sit => ({
      id: sit.id,
      name: sit.situationDef.name,
      pathogenType: sit.situationDef.pathogen.type,
      isResolved: sit.isResolved,
      resolvedOnTurn: sit.resolvedOnTurn,
    })),
    coherenceHistory,
    annotatedSignals,
    keyDecisions,
    finalCoherenceBreakdown: finalBreakdown,
    turnsPlayed: state.turn,
    memoryBank: state.memoryBank,
  };
}

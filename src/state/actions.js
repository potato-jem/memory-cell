// All state mutations as pure functions.
// Turn-based: END_TURN advances TICKS_PER_TURN ticks and always runs the turn boundary.

import { advanceGroundTruth } from '../engine/groundTruth.js';
import { generateSignals, makeDendriticReturnSignal, generateSilenceNotices } from '../engine/signalGenerator.js';
import { computeCoherence, isCoherenceCollapsed, identifyFailureMode } from '../engine/coherence.js';
import {
  trainCell,
  deployFromRoster,
  decommissionCell,
  recallUnit,
  advanceCells,
  startReturnForClearedNodes,
  hasDendriticConfirmation,
  getPatrolCoverage,
  computeTokensInUse,
  getTokensAvailable,
} from '../engine/cells.js';
import {
  applySignalToPerceivedState,
  applyRoutingDecision,
  applyDendriticReturn,
  applyResponderDeployed,
  applyNeutrophilDeployed,
  dismissEntity,
} from './perceivedState.js';
import { TICKS_PER_TURN, GAME_PHASES, LOSS_REASONS } from './gameState.js';
import { TOKEN_CAPACITY_MAX, TOKEN_CAPACITY_REGEN_INTERVAL } from '../data/gameConfig.js';
import { isPathodgenCleared } from '../engine/pathogen.js';
import { recordEncounter } from '../engine/memory.js';

export const ACTION_TYPES = {
  END_TURN:         'END_TURN',
  DISMISS_SIGNAL:   'DISMISS_SIGNAL',
  HOLD_SIGNAL:      'HOLD_SIGNAL',
  DISMISS_ENTITY:   'DISMISS_ENTITY',
  TRAIN_CELL:       'TRAIN_CELL',         // start manufacturing a cell type
  DEPLOY_FROM_ROSTER: 'DEPLOY_FROM_ROSTER', // send a ready cell to a node
  DECOMMISSION_CELL:  'DECOMMISSION_CELL',  // remove a training/ready cell, free tokens
  RECALL_UNIT:      'RECALL_UNIT',
  RESTART:          'RESTART',
  SELECT_NODE:      'SELECT_NODE',
  SELECT_SITUATION: 'SELECT_SITUATION',
};

export function gameReducer(state, action) {
  if (state.phase !== GAME_PHASES.PLAYING &&
      action.type !== ACTION_TYPES.RESTART &&
      action.type !== ACTION_TYPES.PAUSE &&
      action.type !== ACTION_TYPES.RESUME) {
    return state;
  }

  switch (action.type) {
    case ACTION_TYPES.END_TURN:           return handleEndTurn(state);
    case ACTION_TYPES.DISMISS_SIGNAL:     return handleSignalDecision(state, action.signalId, 'dismiss');
    case ACTION_TYPES.HOLD_SIGNAL:        return handleSignalDecision(state, action.signalId, 'hold');
    case ACTION_TYPES.DISMISS_ENTITY:     return handleDismissEntity(state, action.nodeId, action.entityId);
    case ACTION_TYPES.TRAIN_CELL:         return handleTrainCell(state, action.cellType);
    case ACTION_TYPES.DEPLOY_FROM_ROSTER: return handleDeployFromRoster(state, action.cellId, action.nodeId);
    case ACTION_TYPES.DECOMMISSION_CELL:  return handleDecommissionCell(state, action.cellId);
    case ACTION_TYPES.RECALL_UNIT:        return handleRecallUnit(state, action.cellId);
    case ACTION_TYPES.RESTART:            return action.initialState;
    case ACTION_TYPES.SELECT_NODE:        return { ...state, selectedNodeId: action.nodeId };
    case ACTION_TYPES.SELECT_SITUATION:   return { ...state, activeSituationId: action.situationId };
    default: return state;
  }
}

// ── End Turn ───────────────────────────────────────────────────────────────────
// Advances exactly one turn (TICKS_PER_TURN ticks). Always runs the full turn
// boundary: ground truth, signal generation, coherence, win/lose checks.

function handleEndTurn(state) {
  const prevTick = state.tick;
  const newTick = state.tick + TICKS_PER_TURN;
  const newTurn = state.turn + 1;

  // 1. Token capacity regen (check if we crossed a regen boundary)
  let tokenCapacity = state.tokenCapacity;
  if (Math.floor(newTick / TOKEN_CAPACITY_REGEN_INTERVAL) > Math.floor(prevTick / TOKEN_CAPACITY_REGEN_INTERVAL)
      && tokenCapacity < TOKEN_CAPACITY_MAX) {
    tokenCapacity = Math.min(TOKEN_CAPACITY_MAX, tokenCapacity + 1);
  }

  // 2. Advance cells (training, transit, patrol, returns)
  let { updatedCells, events } = advanceCells(state.deployedCells, newTick);

  // 3. Handle scout arrivals
  let updatedSituationStates = state.situationStates;
  const scoutReturnSignals = [];

  for (const event of events) {
    if (event.type !== 'scout_arrived') continue;
    const cell = state.deployedCells[event.cellId];
    if (!cell) continue;

    for (let i = 0; i < updatedSituationStates.length; i++) {
      const sit = updatedSituationStates[i];
      if (sit.isResolved) continue;

      const returnSignal = makeDendriticReturnSignal(
        cell, sit.groundTruth, sit.situationDef, newTick, newTurn, sit.id
      );
      if (!returnSignal) continue;
      scoutReturnSignals.push(returnSignal);

      const perceivedThreat = returnSignal.type === 'threat_confirmed';
      const reportedType = returnSignal.reportedThreatType ?? null;
      const newPS = applyDendriticReturn(sit.perceivedState, event.nodeId, perceivedThreat, reportedType);
      updatedSituationStates = updatedSituationStates.map((s, idx) =>
        idx === i ? { ...s, perceivedState: newPS } : s
      );
    }
  }

  // 4. Turn boundary: ground truth, signals, coherence
  let activeSignals = state.activeSignals.filter(s =>
    s.expiresAtTick == null || newTick < s.expiresAtTick
  );
  let signalHistory = state.signalHistory;
  let memoryBank = state.memoryBank;
  let healthScore = state.healthScore ?? 100;
  let coherenceHistory = state.coherenceHistory;
  let silenceNotices = state.silenceNotices;

  const activeCellCount = Object.values(updatedCells).filter(c =>
    c.phase === 'outbound' || c.phase === 'arrived' || c.phase === 'returning'
  ).length;
  const routingPressure = Math.min(1, activeCellCount * 0.05);
  const allNewSignals = [];

  updatedSituationStates = updatedSituationStates.map(sit => {
    if (sit.isResolved) return sit;

    const seededEventsThisTurn = (sit.situationDef.seededEvents ?? []).filter(e => e.turn === newTurn);
    const { newGroundTruth } = advanceGroundTruth(
      sit.groundTruth, sit.situationDef, updatedCells, newTurn, routingPressure, seededEventsThisTurn
    );

    updatedCells = startReturnForClearedNodes(updatedCells, newGroundTruth.pathogenState, newTick);

    const newSignals = generateSignals(
      newGroundTruth, updatedCells, sit.situationDef,
      newTurn, state.memoryBank, sit.id, newTick
    );

    let perceivedState = sit.perceivedState;
    for (const signal of newSignals) {
      perceivedState = applySignalToPerceivedState(perceivedState, signal);
    }
    allNewSignals.push(...newSignals);

    const pathogenCleared = isPathodgenCleared(newGroundTruth.pathogenState);
    if (pathogenCleared && !sit.isResolved) {
      memoryBank = recordEncounter(memoryBank, sit.situationDef.pathogen.type, true);
    }

    return {
      ...sit,
      groundTruth: newGroundTruth,
      perceivedState,
      isResolved: pathogenCleared,
      resolvedOnTurn: pathogenCleared && !sit.isResolved ? newTurn : sit.resolvedOnTurn,
      resolvedCleanly: pathogenCleared,
    };
  });

  activeSignals = [...activeSignals, ...allNewSignals];
  signalHistory = [...signalHistory, ...allNewSignals];
  silenceNotices = generateSilenceNotices(updatedSituationStates[0].groundTruth, updatedCells, newTurn);

  let totalGap = 0;
  for (const sit of updatedSituationStates) {
    if (sit.isResolved) continue;
    const { score } = computeCoherence(sit.groundTruth, sit.perceivedState);
    totalGap += (100 - score);
  }
  healthScore = Math.max(0, Math.round(100 - totalGap));
  coherenceHistory = [...coherenceHistory, { turn: newTurn, score: healthScore }];

  // Scout return signals
  if (scoutReturnSignals.length > 0) {
    activeSignals = [...activeSignals, ...scoutReturnSignals];
    signalHistory = [...signalHistory, ...scoutReturnSignals];
    for (const sig of scoutReturnSignals) {
      updatedSituationStates = updatedSituationStates.map(sit => {
        if (sit.id !== sig.situationId) return sit;
        return { ...sit, perceivedState: applySignalToPerceivedState(sit.perceivedState, sig) };
      });
    }
  }

  // 5. Token pool
  const tokensInUse = computeTokensInUse(updatedCells);
  const attentionTokens = tokenCapacity - tokensInUse;

  // 6. Win/lose
  const allResolved = updatedSituationStates.every(s => s.isResolved);
  const healthCollapsed = isCoherenceCollapsed(healthScore);
  const turnLimitReached = newTurn >= Math.min(...updatedSituationStates.map(s => s.situationDef.turnLimit));

  let phase = state.phase;
  let lossReason = null;
  let postMortem = null;

  if (allResolved) {
    phase = GAME_PHASES.WON;
    postMortem = buildPostMortem(state, updatedSituationStates, coherenceHistory, [], 'win');
  } else if (healthCollapsed) {
    phase = GAME_PHASES.LOST;
    lossReason = LOSS_REASONS.COHERENCE_COLLAPSE;
    postMortem = buildPostMortem(state, updatedSituationStates, coherenceHistory, [], 'coherence_collapse');
  } else if (turnLimitReached) {
    phase = GAME_PHASES.LOST;
    lossReason = LOSS_REASONS.TURN_LIMIT;
    postMortem = buildPostMortem(state, updatedSituationStates, coherenceHistory, [], 'turn_limit');
  }

  return {
    ...state,
    tick: newTick,
    turn: newTurn,
    tokenCapacity,
    situationStates: updatedSituationStates,
    deployedCells: updatedCells,
    attentionTokens,
    tokensInUse,
    activeSignals,
    signalHistory,
    silenceNotices,
    healthScore,
    coherenceScore: healthScore,
    coherenceHistory,
    memoryBank,
    phase,
    lossReason,
    postMortem,
  };
}

// ── Signal decisions ───────────────────────────────────────────────────────────

function handleSignalDecision(state, signalId, decision) {
  const signal = state.activeSignals.find(s => s.id === signalId);
  if (!signal) return state;

  const activeSignals = state.activeSignals.filter(s => s.id !== signalId);
  const signalHistory = [...state.signalHistory, { ...signal, routed: true, routingDecision: decision }];

  const situationId = signal.situationId ?? state.situationStates[0].id;
  const updatedSituationStates = updatePerceivedStateForSituation(
    state.situationStates, situationId,
    ps => applyRoutingDecision(ps, signal, decision)
  );

  return { ...state, activeSignals, signalHistory, situationStates: updatedSituationStates };
}

function handleDismissEntity(state, nodeId, entityId) {
  const primaryId = state.situationStates[0].id;
  const updatedSituationStates = updatePerceivedStateForSituation(
    state.situationStates, primaryId,
    ps => dismissEntity(ps, nodeId, entityId)
  );
  return { ...state, situationStates: updatedSituationStates };
}

// ── Cell manufacturing ────────────────────────────────────────────────────────

function handleTrainCell(state, cellType) {
  const result = trainCell(cellType, state.deployedCells, state.tokenCapacity, state.tick);
  if (!result.success) return state;

  const tokensInUse = computeTokensInUse(result.newDeployedCells);
  return {
    ...state,
    deployedCells: result.newDeployedCells,
    tokensInUse,
    attentionTokens: state.tokenCapacity - tokensInUse,
  };
}

function handleDeployFromRoster(state, cellId, nodeId) {
  const primarySit = state.situationStates[0];
  const result = deployFromRoster(
    cellId, nodeId, state.deployedCells, state.tick, primarySit.perceivedState
  );
  if (!result.success) return state;

  // Update perceived state for neutrophil / attack cells
  const cell = state.deployedCells[cellId];
  let updatedSituationStates = state.situationStates;
  if (cell) {
    const type = cell.type;
    if (type === 'neutrophil') {
      updatedSituationStates = updatePerceivedStateForSituation(
        state.situationStates, primarySit.id,
        ps => applyNeutrophilDeployed(ps, nodeId)
      );
    } else if (['responder', 'killer_t', 'b_cell', 'nk_cell'].includes(type)) {
      updatedSituationStates = updatePerceivedStateForSituation(
        state.situationStates, primarySit.id,
        ps => applyResponderDeployed(ps, nodeId)
      );
    }
  }

  const tokensInUse = computeTokensInUse(result.newDeployedCells);
  return {
    ...state,
    deployedCells: result.newDeployedCells,
    situationStates: updatedSituationStates,
    tokensInUse,
    attentionTokens: state.tokenCapacity - tokensInUse,
  };
}

function handleDecommissionCell(state, cellId) {
  const result = decommissionCell(cellId, state.deployedCells);
  if (!result.success) return state;

  const tokensInUse = computeTokensInUse(result.newDeployedCells);
  return {
    ...state,
    deployedCells: result.newDeployedCells,
    tokensInUse,
    attentionTokens: state.tokenCapacity - tokensInUse,
  };
}

function handleRecallUnit(state, cellId) {
  const result = recallUnit(cellId, state.deployedCells, state.tick);
  if (!result.success) return state;
  const tokensInUse = computeTokensInUse(result.newDeployedCells);
  return {
    ...state,
    deployedCells: result.newDeployedCells,
    tokensInUse,
    attentionTokens: state.tokenCapacity - tokensInUse,
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
  const primarySit = situationStates[0];
  const failureMode = outcome === 'win' ? 'win' : identifyFailureMode(coherenceHistory, finalBreakdown);

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
      nodeStates: primarySit.groundTruth.nodeStates,
      pathogenState: primarySit.groundTruth.pathogenState,
      spreadHistory: primarySit.groundTruth.spreadHistory,
      spleenStress: primarySit.groundTruth.spleenStress,
    },
    situationSummaries: situationStates.map(sit => ({
      id: sit.id,
      name: sit.situationDef.name,
      pathogenType: sit.situationDef.pathogen.type,
      isResolved: sit.isResolved,
      resolvedOnTurn: sit.resolvedOnTurn,
    })),
    coherenceHistory,
    keyDecisions,
    finalCoherenceBreakdown: finalBreakdown,
    turnsPlayed: state.turn,
    ticksPlayed: state.tick,
    memoryBank: state.memoryBank,
  };
}

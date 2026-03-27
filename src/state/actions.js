// All state mutations as pure functions.
// Real-time: TICK replaces END_TURN. Token pool managed by cell lifecycle.

import { advanceGroundTruth } from '../engine/groundTruth.js';
import { generateSignals, makeDendriticReturnSignal, generateSilenceNotices } from '../engine/signalGenerator.js';
import { computeCoherence, isCoherenceCollapsed, identifyFailureMode } from '../engine/coherence.js';
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
import { TOTAL_TOKENS, TICKS_PER_TURN, GAME_PHASES, LOSS_REASONS } from './gameState.js';
import { isPathodgenCleared } from '../engine/pathogen.js';
import { recordEncounter } from '../engine/memory.js';

export const ACTION_TYPES = {
  TICK: 'TICK',
  PAUSE: 'PAUSE',
  RESUME: 'RESUME',
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
  RESTART: 'RESTART',
  SELECT_NODE: 'SELECT_NODE',
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
    case ACTION_TYPES.TICK:           return handleTick(state);
    case ACTION_TYPES.PAUSE:          return { ...state, paused: true };
    case ACTION_TYPES.RESUME:         return { ...state, paused: false };
    case ACTION_TYPES.DISMISS_SIGNAL: return handleSignalDecision(state, action.signalId, 'dismiss');
    case ACTION_TYPES.HOLD_SIGNAL:    return handleSignalDecision(state, action.signalId, 'hold');
    case ACTION_TYPES.DISMISS_ENTITY: return handleDismissEntity(state, action.nodeId, action.entityId);
    case ACTION_TYPES.DEPLOY_DENDRITIC:  return handleDeploy(state, action.nodeId, (n, dc, ta, t) => deployDendriticCell(n, dc, ta, t));
    case ACTION_TYPES.DEPLOY_NEUTROPHIL: return handleDeployNeutrophil(state, action.nodeId);
    case ACTION_TYPES.DEPLOY_RESPONDER:  return handleDeployResponder(state, action.nodeId);
    case ACTION_TYPES.DEPLOY_KILLER_T:   return handleDeployKillerT(state, action.nodeId);
    case ACTION_TYPES.DEPLOY_B_CELL:     return handleDeployBCell(state, action.nodeId);
    case ACTION_TYPES.DEPLOY_NK_CELL:    return handleDeploy(state, action.nodeId, (n, dc, ta, t) => deployNKCell(n, dc, ta, t));
    case ACTION_TYPES.DEPLOY_MACROPHAGE: return handleDeployMacrophage(state, action.nodeId);
    case ACTION_TYPES.RECALL_UNIT:    return handleRecallUnit(state, action.cellId);
    case ACTION_TYPES.RESTART:        return action.initialState;
    case ACTION_TYPES.SELECT_NODE:    return { ...state, selectedNodeId: action.nodeId };
    case ACTION_TYPES.SELECT_SITUATION: return { ...state, activeSituationId: action.situationId };
    default: return state;
  }
}

// ── Tick ──────────────────────────────────────────────────────────────────────

function handleTick(state) {
  if (state.paused) return state;

  const newTick = state.tick + 1;
  const prevTurn = state.turn;
  const newTurn = Math.floor(newTick / TICKS_PER_TURN);
  const turnAdvanced = newTurn > prevTurn;

  // 1. Advance cells (tick-level: transit, patrol movement, arrivals, returns)
  let { updatedCells, events } = advanceCells(state.deployedCells, newTick);

  // 2. Handle scout arrivals — emit dendritic return signals + update perceived state
  let updatedSituationStates = state.situationStates;
  const scoutReturnSignals = [];

  for (const event of events) {
    if (event.type !== 'scout_arrived') continue;
    const cell = state.deployedCells[event.cellId]; // use original cell before update
    if (!cell) continue;

    for (let i = 0; i < updatedSituationStates.length; i++) {
      const sit = updatedSituationStates[i];
      if (sit.isResolved) continue;

      // makeDendriticReturnSignal does the detection roll internally
      const returnSignal = makeDendriticReturnSignal(
        cell, sit.groundTruth, sit.situationDef, newTick, newTurn, sit.id
      );
      if (!returnSignal) continue;
      scoutReturnSignals.push(returnSignal);

      // What the scout *perceived* (may be wrong — WRONG_ID outcome)
      const perceivedThreat = returnSignal.type === 'threat_confirmed';
      const reportedType = returnSignal.reportedThreatType ?? null;

      const newPS = applyDendriticReturn(sit.perceivedState, event.nodeId, perceivedThreat, reportedType);
      updatedSituationStates = updatedSituationStates.map((s, idx) =>
        idx === i ? { ...s, perceivedState: newPS } : s
      );
    }
  }

  // 3. Turn-boundary simulation (every TICKS_PER_TURN seconds)
  let activeSignals = state.activeSignals.filter(s =>
    s.expiresAtTick == null || newTick < s.expiresAtTick
  );
  let signalHistory = state.signalHistory;
  let memoryBank = state.memoryBank;
  let healthScore = state.healthScore ?? 100;
  let coherenceHistory = state.coherenceHistory;
  let silenceNotices = state.silenceNotices;

  if (turnAdvanced) {
    const activeCellCount = Object.keys(updatedCells).length;
    const routingPressure = Math.min(1, activeCellCount * 0.05);
    const patrolCoverage = getPatrolCoverage(updatedCells);
    const allNewSignals = [];

    updatedSituationStates = updatedSituationStates.map(sit => {
      if (sit.isResolved) return sit;

      const seededEventsThisTurn = (sit.situationDef.seededEvents ?? []).filter(e => e.turn === newTurn);
      const { newGroundTruth } = advanceGroundTruth(
        sit.groundTruth, sit.situationDef, updatedCells, newTurn, routingPressure, seededEventsThisTurn
      );

      // Auto-return attack cells from cleared nodes
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

    // Health / coherence
    let totalGap = 0;
    const combinedBreakdown = [];
    for (const sit of updatedSituationStates) {
      if (sit.isResolved) continue;
      const { score, breakdown } = computeCoherence(sit.groundTruth, sit.perceivedState);
      totalGap += (100 - score);
      combinedBreakdown.push(...breakdown);
    }
    healthScore = Math.max(0, Math.round(100 - totalGap));
    coherenceHistory = [...coherenceHistory, { turn: newTurn, score: healthScore }];
  }

  // Add scout return signals to active signals (happen at tick level, not turn level)
  if (scoutReturnSignals.length > 0) {
    activeSignals = [...activeSignals, ...scoutReturnSignals];
    signalHistory = [...signalHistory, ...scoutReturnSignals];
    // Apply scout signals to perceived state
    for (const sig of scoutReturnSignals) {
      updatedSituationStates = updatedSituationStates.map(sit => {
        if (sit.id !== sig.situationId) return sit;
        return { ...sit, perceivedState: applySignalToPerceivedState(sit.perceivedState, sig) };
      });
    }
  }

  // 4. Token pool
  const tokensInUse = computeTokensInUse(updatedCells);
  const tokensAvailable = TOTAL_TOKENS - tokensInUse;

  // 5. Win/lose
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
    situationStates: updatedSituationStates,
    deployedCells: updatedCells,
    attentionTokens: tokensAvailable,
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

// ── Signal decisions (free — no token cost) ───────────────────────────────────

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

// ── Cell deployment ───────────────────────────────────────────────────────────

function handleDeploy(state, nodeId, deployFn) {
  const tokensAvailable = getTokensAvailable(state.deployedCells);
  const result = deployFn(nodeId, state.deployedCells, tokensAvailable, state.tick);
  if (!result.success) return state;

  const tokensInUse = computeTokensInUse(result.newDeployedCells);
  return {
    ...state,
    deployedCells: result.newDeployedCells,
    attentionTokens: TOTAL_TOKENS - tokensInUse,
    tokensInUse,
  };
}

function handleDeployNeutrophil(state, nodeId) {
  const tokensAvailable = getTokensAvailable(state.deployedCells);
  const result = deployNeutrophilPatrol(nodeId, state.deployedCells, tokensAvailable, state.tick);
  if (!result.success) return state;

  const updatedSituationStates = updatePerceivedStateForSituation(
    state.situationStates, state.situationStates[0].id,
    ps => applyNeutrophilDeployed(ps, nodeId)
  );
  const tokensInUse = computeTokensInUse(result.newDeployedCells);
  return {
    ...state,
    deployedCells: result.newDeployedCells,
    situationStates: updatedSituationStates,
    attentionTokens: TOTAL_TOKENS - tokensInUse,
    tokensInUse,
  };
}

function handleDeployMacrophage(state, nodeId) {
  const tokensAvailable = getTokensAvailable(state.deployedCells);
  const result = deployMacrophage(nodeId, state.deployedCells, tokensAvailable, state.tick);
  if (!result.success) return state;

  const tokensInUse = computeTokensInUse(result.newDeployedCells);
  return {
    ...state,
    deployedCells: result.newDeployedCells,
    attentionTokens: TOTAL_TOKENS - tokensInUse,
    tokensInUse,
  };
}

function handleDeployResponder(state, nodeId) {
  const ps = state.situationStates[0].perceivedState;
  const dc = hasDendriticConfirmation(nodeId, ps);
  const tokensAvailable = getTokensAvailable(state.deployedCells);
  const result = deployResponder(nodeId, state.deployedCells, tokensAvailable, state.tick, dc);
  if (!result.success) return state;

  const updatedSituationStates = updatePerceivedStateForSituation(
    state.situationStates, state.situationStates[0].id,
    p => applyResponderDeployed(p, nodeId)
  );
  const tokensInUse = computeTokensInUse(result.newDeployedCells);
  return {
    ...state,
    deployedCells: result.newDeployedCells,
    situationStates: updatedSituationStates,
    attentionTokens: TOTAL_TOKENS - tokensInUse,
    tokensInUse,
  };
}

function handleDeployKillerT(state, nodeId) {
  const ps = state.situationStates[0].perceivedState;
  const dc = hasDendriticConfirmation(nodeId, ps);
  const tokensAvailable = getTokensAvailable(state.deployedCells);
  const result = deployKillerT(nodeId, state.deployedCells, tokensAvailable, state.tick, dc);
  if (!result.success) return state;

  const updatedSituationStates = updatePerceivedStateForSituation(
    state.situationStates, state.situationStates[0].id,
    p => applyResponderDeployed(p, nodeId)
  );
  const tokensInUse = computeTokensInUse(result.newDeployedCells);
  return {
    ...state,
    deployedCells: result.newDeployedCells,
    situationStates: updatedSituationStates,
    attentionTokens: TOTAL_TOKENS - tokensInUse,
    tokensInUse,
  };
}

function handleDeployBCell(state, nodeId) {
  const ps = state.situationStates[0].perceivedState;
  const dc = hasDendriticConfirmation(nodeId, ps);
  const tokensAvailable = getTokensAvailable(state.deployedCells);
  const result = deployBCell(nodeId, state.deployedCells, tokensAvailable, state.tick, dc);
  if (!result.success) return state;

  const updatedSituationStates = updatePerceivedStateForSituation(
    state.situationStates, state.situationStates[0].id,
    p => applyResponderDeployed(p, nodeId)
  );
  const tokensInUse = computeTokensInUse(result.newDeployedCells);
  return {
    ...state,
    deployedCells: result.newDeployedCells,
    situationStates: updatedSituationStates,
    attentionTokens: TOTAL_TOKENS - tokensInUse,
    tokensInUse,
  };
}

function handleRecallUnit(state, cellId) {
  const result = recallUnit(cellId, state.deployedCells, state.tick);
  if (!result.success) return state;
  const tokensInUse = computeTokensInUse(result.newDeployedCells);
  return {
    ...state,
    deployedCells: result.newDeployedCells,
    attentionTokens: TOTAL_TOKENS - tokensInUse,
    tokensInUse,
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

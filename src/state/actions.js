// All state mutations as pure functions.
// Turn-based endless run. Health model: SystemicStress + SystemicIntegrity + Fever.
// Replaces coherence/situation system.

import { advanceGroundTruth } from '../engine/groundTruth.js';
import { generateSignals, generateSignalsForVisits, makeDendriticReturnSignal, generateSilenceNotices } from '../engine/signalGenerator.js';
import { computeSystemicStress, applySystemicIntegrityHits, computeNewScars, isSystemCollapsed, identifyFailureMode } from '../engine/systemicValues.js';
import { rollSpawns } from '../engine/spawner.js';
import {
  trainCell,
  deployFromRoster,
  decommissionCell,
  recallUnit,
  advanceCells,
  startReturnForClearedNodes,
  hasDendriticConfirmation,
  computeTokensInUse,
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
import { recordEncounter } from '../engine/memory.js';

export const ACTION_TYPES = {
  END_TURN:           'END_TURN',
  TOGGLE_FEVER:       'TOGGLE_FEVER',
  DISMISS_SIGNAL:     'DISMISS_SIGNAL',
  HOLD_SIGNAL:        'HOLD_SIGNAL',
  DISMISS_ENTITY:     'DISMISS_ENTITY',
  TRAIN_CELL:         'TRAIN_CELL',
  DEPLOY_FROM_ROSTER: 'DEPLOY_FROM_ROSTER',
  DECOMMISSION_CELL:  'DECOMMISSION_CELL',
  RECALL_UNIT:        'RECALL_UNIT',
  RESTART:            'RESTART',
  SELECT_NODE:        'SELECT_NODE',
};

export function gameReducer(state, action) {
  if (state.phase !== GAME_PHASES.PLAYING &&
      action.type !== ACTION_TYPES.RESTART) {
    return state;
  }

  switch (action.type) {
    case ACTION_TYPES.END_TURN:           return handleEndTurn(state);
    case ACTION_TYPES.TOGGLE_FEVER:       return handleToggleFever(state);
    case ACTION_TYPES.DISMISS_SIGNAL:     return handleSignalDecision(state, action.signalId, 'dismiss');
    case ACTION_TYPES.HOLD_SIGNAL:        return handleSignalDecision(state, action.signalId, 'hold');
    case ACTION_TYPES.DISMISS_ENTITY:     return handleDismissEntity(state, action.nodeId, action.entityId);
    case ACTION_TYPES.TRAIN_CELL:         return handleTrainCell(state, action.cellType);
    case ACTION_TYPES.DEPLOY_FROM_ROSTER: return handleDeployFromRoster(state, action.cellId, action.nodeId);
    case ACTION_TYPES.DECOMMISSION_CELL:  return handleDecommissionCell(state, action.cellId);
    case ACTION_TYPES.RECALL_UNIT:        return handleRecallUnit(state, action.cellId);
    case ACTION_TYPES.RESTART:            return action.initialState;
    case ACTION_TYPES.SELECT_NODE:        return { ...state, selectedNodeId: action.nodeId };
    default: return state;
  }
}

// ── End Turn ───────────────────────────────────────────────────────────────────

function handleEndTurn(state) {
  const prevTick = state.tick;
  const newTick = state.tick + TICKS_PER_TURN;
  const newTurn = state.turn + 1;

  // 1. Token capacity regen
  let tokenCapacity = state.tokenCapacity;
  if (Math.floor(newTick / TOKEN_CAPACITY_REGEN_INTERVAL) > Math.floor(prevTick / TOKEN_CAPACITY_REGEN_INTERVAL)
      && tokenCapacity < TOKEN_CAPACITY_MAX) {
    tokenCapacity = Math.min(TOKEN_CAPACITY_MAX, tokenCapacity + 1);
  }

  // 2. Advance cells (training, transit, patrol, returns)
  let { updatedCells, events: cellEvents, nodesVisited } = advanceCells(state.deployedCells, newTick);

  // 3. Handle scout arrivals (generate return signals before ground truth advances)
  const scoutReturnSignals = [];
  for (const event of cellEvents) {
    if (event.type !== 'scout_arrived') continue;
    const cell = state.deployedCells[event.cellId];
    if (!cell) continue;
    const sig = makeDendriticReturnSignal(cell, state.groundTruth, state.runConfig, newTick, newTurn, 'primary');
    if (!sig) continue;
    scoutReturnSignals.push(sig);
    // Update perceived state for scout return
    const perceivedThreat = sig.type === 'threat_confirmed';
    const reportedType = sig.reportedThreatType ?? null;
    // (applied to perceivedState below)
  }

  // 4. Probabilistic spawning
  const pendingSpawns = rollSpawns(state.groundTruth.nodeStates, newTurn, state.systemicStress);

  // 5. Advance ground truth (pathogens, inflammation, tissue integrity)
  const { newGroundTruth, events: gtEvents, perSiteOutputs } = advanceGroundTruth(
    state.groundTruth,
    updatedCells,
    newTurn,
    state.systemicStress,
    pendingSpawns
  );

  // 6. Auto-return attack cells from cleared nodes
  updatedCells = startReturnForClearedNodes(updatedCells, newGroundTruth.nodeStates, newTick);

  // 7. Generate patrol/macrophage signals + en-route detection
  const newSignals = generateSignals(
    newGroundTruth, updatedCells, state.runConfig, newTurn, state.memoryBank, 'primary', newTick
  );
  const visitSignals = generateSignalsForVisits(nodesVisited, newGroundTruth, newTurn, newTick, 'primary');

  // 8. Update perceived state
  let perceivedState = state.perceivedState;
  for (const sig of [...newSignals, ...visitSignals, ...scoutReturnSignals]) {
    perceivedState = applySignalToPerceivedState(perceivedState, sig);
  }
  // Apply dendritic return specifics
  for (const sig of scoutReturnSignals) {
    const perceivedThreat = sig.type === 'threat_confirmed';
    perceivedState = applyDendriticReturn(perceivedState, sig.nodeId, perceivedThreat, sig.reportedThreatType ?? null, newTurn);
  }

  // 9. Signals
  let activeSignals = state.activeSignals.filter(s =>
    s.expiresAtTick == null || newTick < s.expiresAtTick
  );
  const allNewSignals = [...newSignals, ...visitSignals, ...scoutReturnSignals];
  activeSignals = [...activeSignals, ...allNewSignals];
  const signalHistory = [...state.signalHistory, ...allNewSignals];
  const silenceNotices = generateSilenceNotices(newGroundTruth, updatedCells, newTurn);

  // 10. Systemic values
  const { stress: newStress } = computeSystemicStress(
    newGroundTruth.nodeStates, perSiteOutputs, state.fever, state.systemicStress
  );
  const prevIntegrity = state.systemicIntegrity;
  const newIntegrity = applySystemicIntegrityHits(state.systemicIntegrity, newStress);
  const newScars = computeNewScars(newGroundTruth.nodeStates, state.scars, newIntegrity, prevIntegrity);
  const scars = [...state.scars, ...newScars];

  const systemicStressHistory = [
    ...state.systemicStressHistory,
    { turn: newTurn, stress: newStress, integrity: newIntegrity },
  ];

  // 11. Memory bank — record cleared pathogens
  let memoryBank = state.memoryBank;
  for (const event of gtEvents) {
    if (event.type === 'pathogen_cleared') {
      memoryBank = recordEncounter(memoryBank, event.pathogenType, true);
    }
  }

  // 12. Token pool
  const tokensInUse = computeTokensInUse(updatedCells);
  const attentionTokens = tokenCapacity - tokensInUse;

  // 13. Loss check
  let phase = state.phase;
  let lossReason = null;
  let postMortem = null;

  if (isSystemCollapsed(newIntegrity)) {
    phase = GAME_PHASES.LOST;
    lossReason = LOSS_REASONS.SYSTEMIC_COLLAPSE;
    postMortem = buildPostMortem(state, newGroundTruth, systemicStressHistory, scars, 'systemic_collapse');
  }

  return {
    ...state,
    tick: newTick,
    turn: newTurn,
    tokenCapacity,
    groundTruth: newGroundTruth,
    perceivedState,
    deployedCells: updatedCells,
    attentionTokens,
    tokensInUse,
    activeSignals,
    signalHistory,
    silenceNotices,
    systemicStress: newStress,
    systemicIntegrity: newIntegrity,
    systemicStressHistory,
    scars,
    memoryBank,
    phase,
    lossReason,
    postMortem,
  };
}

// ── Fever ──────────────────────────────────────────────────────────────────────

function handleToggleFever(state) {
  return { ...state, fever: { active: !state.fever.active } };
}

// ── Signal decisions ───────────────────────────────────────────────────────────

function handleSignalDecision(state, signalId, decision) {
  const signal = state.activeSignals.find(s => s.id === signalId);
  if (!signal) return state;

  const activeSignals = state.activeSignals.filter(s => s.id !== signalId);
  const signalHistory = [...state.signalHistory, { ...signal, routed: true, routingDecision: decision }];
  const perceivedState = applyRoutingDecision(state.perceivedState, signal, decision);

  return { ...state, activeSignals, signalHistory, perceivedState };
}

function handleDismissEntity(state, nodeId, entityId) {
  const perceivedState = dismissEntity(state.perceivedState, nodeId, entityId);
  return { ...state, perceivedState };
}

// ── Cell manufacturing ─────────────────────────────────────────────────────────

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
  const result = deployFromRoster(cellId, nodeId, state.deployedCells, state.tick, state.perceivedState);
  if (!result.success) return state;

  const cell = state.deployedCells[cellId];
  let perceivedState = state.perceivedState;
  if (cell) {
    if (cell.type === 'neutrophil') {
      perceivedState = applyNeutrophilDeployed(perceivedState, nodeId);
    } else if (['responder', 'killer_t', 'b_cell', 'nk_cell'].includes(cell.type)) {
      perceivedState = applyResponderDeployed(perceivedState, nodeId);
    }
  }

  const tokensInUse = computeTokensInUse(result.newDeployedCells);
  return {
    ...state,
    deployedCells: result.newDeployedCells,
    perceivedState,
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

// ── Post-mortem ────────────────────────────────────────────────────────────────

function buildPostMortem(state, groundTruth, stressHistory, scars, outcome) {
  return {
    outcome,
    failureMode: identifyFailureMode(stressHistory),
    finalNodeStates: groundTruth.nodeStates,
    spreadHistory: groundTruth.spreadHistory,
    systemicStressHistory: stressHistory,
    scars,
    turnsPlayed: state.turn,
    memoryBank: state.memoryBank,
  };
}

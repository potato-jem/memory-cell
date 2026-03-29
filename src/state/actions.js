// All state mutations as pure functions.
// Turn-based endless run. Health model: SystemicStress + SystemicIntegrity + Fever.

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
  computeTokensInUse,
} from '../engine/cells.js';
import {
  applySignalToPerceivedState,
  applyDendriticReturn,
  applyResponderDeployed,
  applyNeutrophilDeployed,
} from './perceivedState.js';
import { TICKS_PER_TURN, GAME_PHASES, LOSS_REASONS } from './gameState.js';
import { TOKEN_CAPACITY_MAX, TOKEN_CAPACITY_REGEN_INTERVAL } from '../data/gameConfig.js';
import { recordEncounter } from '../engine/memory.js';
import { applyModifierPatch } from '../data/runModifiers.js';

export const ACTION_TYPES = {
  END_TURN:           'END_TURN',
  TOGGLE_FEVER:       'TOGGLE_FEVER',
  TRAIN_CELL:         'TRAIN_CELL',
  DEPLOY_FROM_ROSTER: 'DEPLOY_FROM_ROSTER',
  DECOMMISSION_CELL:  'DECOMMISSION_CELL',
  RECALL_UNIT:        'RECALL_UNIT',
  RESTART:            'RESTART',
  SELECT_NODE:        'SELECT_NODE',
  // Upgrades, scars, and decisions dispatch this with a `patch` object.
  // See runModifiers.js for the modifier schema.
  APPLY_MODIFIER:     'APPLY_MODIFIER',
};

export function gameReducer(state, action) {
  if (state.phase !== GAME_PHASES.PLAYING &&
      action.type !== ACTION_TYPES.RESTART) {
    return state;
  }

  switch (action.type) {
    case ACTION_TYPES.END_TURN:           return handleEndTurn(state);
    case ACTION_TYPES.TOGGLE_FEVER:       return handleToggleFever(state);
    case ACTION_TYPES.TRAIN_CELL:         return handleTrainCell(state, action.cellType);
    case ACTION_TYPES.DEPLOY_FROM_ROSTER: return handleDeployFromRoster(state, action.cellId, action.nodeId);
    case ACTION_TYPES.DECOMMISSION_CELL:  return handleDecommissionCell(state, action.cellId);
    case ACTION_TYPES.RECALL_UNIT:        return handleRecallUnit(state, action.cellId);
    case ACTION_TYPES.RESTART:            return action.initialState;
    case ACTION_TYPES.SELECT_NODE:        return { ...state, selectedNodeId: action.nodeId };
    case ACTION_TYPES.APPLY_MODIFIER:     return handleApplyModifier(state, action.patch);
    default: return state;
  }
}

// ── End Turn ───────────────────────────────────────────────────────────────────

function handleEndTurn(state) {
  const prevTick = state.tick;
  const newTick = state.tick + TICKS_PER_TURN;
  const newTurn = state.turn + 1;
  const mods = state.runModifiers;

  // 1. Token capacity regen
  let tokenCapacity = state.tokenCapacity;
  if (Math.floor(newTick / TOKEN_CAPACITY_REGEN_INTERVAL) > Math.floor(prevTick / TOKEN_CAPACITY_REGEN_INTERVAL)
      && tokenCapacity < TOKEN_CAPACITY_MAX) {
    tokenCapacity = Math.min(TOKEN_CAPACITY_MAX, tokenCapacity + 1);
  }

  // 2. Advance cells (training, transit, patrol, returns)
  let { updatedCells, events: cellEvents, nodesVisited } = advanceCells(state.deployedCells, newTick, mods);

  // 3. Handle scout arrivals (generate return signals before ground truth advances)
  const scoutReturnSignals = [];
  for (const event of cellEvents) {
    if (event.type !== 'scout_arrived') continue;
    const cell = state.deployedCells[event.cellId];
    if (!cell) continue;
    const sig = makeDendriticReturnSignal(cell, state.groundTruth, state.runConfig, newTick, newTurn, 'primary', mods);
    if (!sig) continue;
    scoutReturnSignals.push(sig);
  }

  // 4. Probabilistic spawning
  const pendingSpawns = rollSpawns(state.groundTruth.nodeStates, newTurn, state.systemicStress, Math.random, mods);

  // 5. Advance ground truth (pathogens, inflammation, tissue integrity)
  const { newGroundTruth, events: gtEvents, perSiteOutputs } = advanceGroundTruth(
    state.groundTruth,
    updatedCells,
    newTurn,
    state.systemicStress,
    pendingSpawns,
    mods
  );

  // 6. Auto-return attack cells from cleared nodes
  updatedCells = startReturnForClearedNodes(updatedCells, newGroundTruth.nodeStates, newTick, mods);

  // 7. Generate patrol/macrophage signals + en-route detection
  const newSignals = generateSignals(
    newGroundTruth, updatedCells, state.runConfig, newTurn, state.memoryBank, 'primary', newTick, mods
  );
  const visitSignals = generateSignalsForVisits(nodesVisited, newGroundTruth, newTurn, newTick, 'primary', mods);

  // 8. Update perceived state
  let perceivedState = state.perceivedState;
  for (const sig of [...newSignals, ...visitSignals, ...scoutReturnSignals]) {
    perceivedState = applySignalToPerceivedState(perceivedState, sig);
  }
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
    newGroundTruth.nodeStates, perSiteOutputs, state.fever, state.systemicStress, mods
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
  const tokensInUse = computeTokensInUse(updatedCells, mods);
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

// ── Cell manufacturing ─────────────────────────────────────────────────────────

function handleTrainCell(state, cellType) {
  const result = trainCell(cellType, state.deployedCells, state.tokenCapacity, state.tick, state.runModifiers);
  if (!result.success) return state;
  const tokensInUse = computeTokensInUse(result.newDeployedCells, state.runModifiers);
  return {
    ...state,
    deployedCells: result.newDeployedCells,
    tokensInUse,
    attentionTokens: state.tokenCapacity - tokensInUse,
  };
}

function handleDeployFromRoster(state, cellId, nodeId) {
  const result = deployFromRoster(cellId, nodeId, state.deployedCells, state.tick, state.perceivedState, state.runModifiers);
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

  const tokensInUse = computeTokensInUse(result.newDeployedCells, state.runModifiers);
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
  const tokensInUse = computeTokensInUse(result.newDeployedCells, state.runModifiers);
  return {
    ...state,
    deployedCells: result.newDeployedCells,
    tokensInUse,
    attentionTokens: state.tokenCapacity - tokensInUse,
  };
}

function handleRecallUnit(state, cellId) {
  const result = recallUnit(cellId, state.deployedCells, state.tick, state.runModifiers);
  if (!result.success) return state;
  const tokensInUse = computeTokensInUse(result.newDeployedCells, state.runModifiers);
  return {
    ...state,
    deployedCells: result.newDeployedCells,
    tokensInUse,
    attentionTokens: state.tokenCapacity - tokensInUse,
  };
}

// ── Modifier application ───────────────────────────────────────────────────────
// Dispatched by upgrades, scars, and narrative decisions.
// action.patch is a partial runModifiers object (deep-merged into current modifiers).
//
// Example patches:
//   Upgrade — boost responder clearance 50%:  { cells: { responder: { clearanceRateMultiplier: 1.5 } } }
//   Scar    — slow scout training:            { cells: { dendritic: { trainingTicksDelta: 10 } } }
//   Decision — open a new route:              { nodes: { LIVER: { addedConnections: ['CHEST'] } } }
//   Upgrade — improve dendritic vs virus:     { detection: { dendritic: { viral: { accuracyBonus: 0.15 } } } }
//
// For stacking numeric upgrades, read the current value first:
//   const current = state.runModifiers.cells?.responder?.clearanceRateMultiplier ?? 1.0;
//   dispatch({ type: ACTION_TYPES.APPLY_MODIFIER, patch: { cells: { responder: { clearanceRateMultiplier: current * 1.3 } } } });

function handleApplyModifier(state, patch) {
  const runModifiers = applyModifierPatch(state.runModifiers, patch);
  return { ...state, runModifiers };
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

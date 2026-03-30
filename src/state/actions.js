// All state mutations as pure functions.
// Turn-based endless run. Health model: SystemicStress + SystemicIntegrity + Fever.

import { advanceGroundTruth } from '../engine/groundTruth.js';
import { rollDetection, DETECTION_OUTCOMES } from '../data/detection.js';
import { getDominantPathogen, PATHOGEN_SIGNAL_TYPE } from '../data/pathogens.js';
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
  applyDetectionOutcome,
  applyCollateralDamageObservation,
  applyDendriticReturn,
  applyResponderDeployed,
  applyNeutrophilDeployed,
} from './perceivedState.js';
import { NODES, computeVisibility } from '../data/nodes.js';
import { TICKS_PER_TURN, GAME_PHASES, LOSS_REASONS } from './gameState.js';
import { TOKEN_CAPACITY_MAX, TOKEN_CAPACITY_REGEN_INTERVAL } from '../data/gameConfig.js';
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

  // 3. Scout arrivals: roll detection against current ground truth before it advances
  const scoutDetections = [];
  for (const event of cellEvents) {
    if (event.type !== 'scout_arrived') continue;
    const cell = updatedCells[event.cellId];
    if (!cell) continue;
    const nodeState = state.groundTruth.nodeStates?.[cell.nodeId] ?? {};
    const { actualThreatType, threatStrength } = dominantForDetection(nodeState);
    const inflammation = nodeState.inflammation ?? 0;
    const { outcome, reportedType } = rollDetection('dendritic', actualThreatType, threatStrength, inflammation, mods);
    scoutDetections.push({ nodeId: cell.nodeId, outcome, reportedType });
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

  // 6b. Snapshot currently-visible nodes for fog-of-war last-known display
  const visibleThisTurn = computeVisibility(updatedCells);
  let lastKnownNodeStates = state.lastKnownNodeStates ?? {};
  for (const nodeId of visibleThisTurn) {
    const gtNode = newGroundTruth.nodeStates[nodeId];
    if (!gtNode) continue;
    lastKnownNodeStates = {
      ...lastKnownNodeStates,
      [nodeId]: {
        inflammation:           gtNode.inflammation ?? 0,
        tissueIntegrity:        gtNode.tissueIntegrity ?? 100,
        tissueIntegrityCeiling: gtNode.tissueIntegrityCeiling ?? 100,
        isWalledOff:            gtNode.isWalledOff ?? false,
        immuneSuppressed:       gtNode.immuneSuppressed ?? false,
        transitPenalty:         gtNode.transitPenalty ?? 0,
      },
    };
  }

  // 7. Detection rolls → perceived state updates
  let perceivedState = state.perceivedState;
  const RECON_TYPES = new Set(['neutrophil', 'macrophage', 'dendritic']);

  // 7a. Arrived patrol/macrophage cells
  const coveredNodes = new Set();
  for (const cell of Object.values(updatedCells)) {
    if (cell.phase !== 'arrived') continue;
    if (!['neutrophil', 'macrophage'].includes(cell.type)) continue;
    const nodeId = cell.nodeId;
    if (coveredNodes.has(nodeId)) continue;

    const nodeState = newGroundTruth.nodeStates?.[nodeId] ?? {};
    const { actualThreatType, threatStrength } = dominantForDetection(nodeState);
    const inflammation = nodeState.inflammation ?? 0;

    const { outcome, reportedType } = rollDetection(cell.type, actualThreatType, threatStrength, inflammation, mods);
    if (outcome !== DETECTION_OUTCOMES.MISS) {
      perceivedState = applyDetectionOutcome(perceivedState, nodeId, outcome, reportedType, newTurn);
      coveredNodes.add(nodeId);
    } else if (inflammation >= 40) {
      // No threat detected but high inflammation is itself informative
      perceivedState = applyCollateralDamageObservation(perceivedState, nodeId, newTurn);
      coveredNodes.add(nodeId);
    }
  }

  // 7b. En-route detection at intermediate nodes
  const visitedNodes = new Set();
  for (const { cellType, nodeId } of nodesVisited) {
    if (!RECON_TYPES.has(cellType)) continue;
    if (visitedNodes.has(nodeId)) continue;
    if (!NODES[nodeId]) continue;

    const nodeState = newGroundTruth.nodeStates?.[nodeId] ?? {};
    const { actualThreatType, threatStrength } = dominantForDetection(nodeState);
    const inflammation = nodeState.inflammation ?? 0;

    const { outcome, reportedType } = rollDetection(cellType, actualThreatType, threatStrength, inflammation, mods);
    if (outcome !== DETECTION_OUTCOMES.MISS) {
      perceivedState = applyDetectionOutcome(perceivedState, nodeId, outcome, reportedType, newTurn);
      visitedNodes.add(nodeId);
    }
  }

  // 7c. Scout arrival detections
  for (const { nodeId, outcome, reportedType } of scoutDetections) {
    const foundThreat = outcome !== DETECTION_OUTCOMES.MISS && outcome !== DETECTION_OUTCOMES.CLEAR;
    perceivedState = applyDendriticReturn(perceivedState, nodeId, foundThreat, reportedType ?? null, newTurn);
  }

  // 8. Systemic values
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

  // 10. Token pool
  const tokensInUse = computeTokensInUse(updatedCells, mods);
  const attentionTokens = tokenCapacity - tokensInUse;

  // 11. Loss check
  let phase = state.phase;
  let lossReason = null;
  let postMortem = null;

  if (isSystemCollapsed(newIntegrity)) {
    phase = GAME_PHASES.LOST;
    lossReason = LOSS_REASONS.SYSTEMIC_COLLAPSE;
    postMortem = buildPostMortem(state, newGroundTruth, systemicStressHistory, scars, 'systemic_collapse');
  }
  console.log(newGroundTruth)
  console.log(perceivedState)
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
    systemicStress: newStress,
    systemicIntegrity: newIntegrity,
    systemicStressHistory,
    scars,
    lastKnownNodeStates,
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
  };
}

// ── Helper: dominant threat for detection rolls ────────────────────────────────

function dominantForDetection(nodeState) {
  const dominant = getDominantPathogen(nodeState);
  if (!dominant) return { actualThreatType: null, threatStrength: 0 };
  const signalType = PATHOGEN_SIGNAL_TYPE[dominant.type] ?? dominant.type;
  return { actualThreatType: signalType, threatStrength: dominant.load };
}

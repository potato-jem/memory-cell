// All state mutations as pure functions.
// Turn-based endless run. Health model: SystemicStress + SystemicIntegrity + Fever.

import { advanceGroundTruth } from '../engine/groundTruth.js';
import { performDetection } from '../data/detection.js';
import { computeSystemicStress, applySystemicIntegrityHits, computeNewScars, isSystemCollapsed, identifyFailureMode } from '../engine/systemicValues.js';
import { rollSpawns } from '../engine/spawner.js';
import {
  trainCell,
  deployFromRoster,
  decommissionCell,
  recallUnit,
  advanceCells,
  startReturnForClearedNodes,
  assignPatrolDestinations,
  computeTokensInUse,
} from '../engine/cells.js';
import { CELL_CONFIG, RECON_CELL_TYPES, getEffectiveClearanceRate } from '../data/cellConfig.js';
import { NODES, computeVisibility } from '../data/nodes.js';
import { TICKS_PER_TURN, GAME_PHASES, LOSS_REASONS } from './gameState.js';
import { TOKEN_CAPACITY_MAX, TOKEN_CAPACITY_REGEN_INTERVAL, WIN_PATHOGEN_TARGET } from '../data/gameConfig.js';
import { nodeHasActivePathogen, PATHOGEN_REGISTRY } from '../data/pathogens.js';
import { applyModifierPatch } from '../data/runModifiers.js';
import {
  selectUpgradeOptions,
  selectScarOptions,
  makeUpgradeContext,
  makeScarContext,
  computeOptionPatch,
  MODIFIER_CHOICE_COUNT,
} from '../data/modifierSelector.js';

export const ACTION_TYPES = {
  END_TURN:           'END_TURN',
  TOGGLE_FEVER:       'TOGGLE_FEVER',
  TRAIN_CELL:         'TRAIN_CELL',
  DEPLOY_FROM_ROSTER: 'DEPLOY_FROM_ROSTER',
  DECOMMISSION_CELL:  'DECOMMISSION_CELL',
  RECALL_UNIT:        'RECALL_UNIT',
  RESTART:            'RESTART',
  SELECT_NODE:        'SELECT_NODE',
  // Direct modifier patch (bypasses the choice system — for testing / direct application).
  // See runModifiers.js for the modifier schema.
  APPLY_MODIFIER:     'APPLY_MODIFIER',
  // Player resolves a pending modifier choice. action.optionIndex is the chosen option index.
  CHOOSE_MODIFIER:    'CHOOSE_MODIFIER',
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
    case ACTION_TYPES.CHOOSE_MODIFIER:    return handleChooseModifier(state, action.optionIndex);
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
  let { updatedCells, nodesVisited } = advanceCells(state.deployedCells, newTick, mods);

  // 3. Detection phase: run before ground truth advances so cells see current pathogen state.
  //    Updates detected_level on pathogen instances directly.
  const groundTruthAfterDetection = runDetectionPhase(
    updatedCells, nodesVisited, state.groundTruth, mods
  );

  // 4. Probabilistic spawning — suppressed once win target is reached
  const pendingSpawns = state.totalPathogensSpawned >= WIN_PATHOGEN_TARGET
    ? []
    : rollSpawns(groundTruthAfterDetection.nodeStates, newTurn, state.systemicStress, Math.random, mods);
  const totalPathogensSpawned = state.totalPathogensSpawned + pendingSpawns.length;

  // 5. Advance ground truth (pathogens, inflammation, tissue integrity)
  const { newGroundTruth, events: groundTruthEvents, perSiteOutputs } = advanceGroundTruth(
    groundTruthAfterDetection,
    updatedCells,
    newTurn,
    state.systemicStress,
    pendingSpawns,
    mods
  );
  
  // 6. Auto-return attack cells from cleared nodes
  updatedCells = startReturnForClearedNodes(updatedCells, newGroundTruth.nodeStates, newTick, mods);

  // 6b. Stamp lastKnownInflammation, lastKnownLoad, and turnsSinceLastVisible onto nodeStates
  const visibleThisTurn = computeVisibility(updatedCells);
  const stampedNodeStates = { ...newGroundTruth.nodeStates };
  for (const nodeId of Object.keys(stampedNodeStates)) {
    const gtNode = stampedNodeStates[nodeId];
    if (!gtNode) continue;
    if (visibleThisTurn.has(nodeId)) {
      stampedNodeStates[nodeId] = {
        ...gtNode,
        turnsSinceLastVisible: 0,
        lastKnownInflammation: gtNode.inflammation ?? 0,
        pathogens: gtNode.pathogens.map(p => ({ ...p, lastKnownLoad: p.actualLoad ?? 0 })),
      };
    } else {
      stampedNodeStates[nodeId] = {
        ...gtNode,
        turnsSinceLastVisible: (gtNode.turnsSinceLastVisible ?? 0) + 1,
      };
    }
  }
  const finalGroundTruth = { ...newGroundTruth, nodeStates: stampedNodeStates };

  // 6c. Assign patrol destinations based on visibility staleness
  updatedCells = assignPatrolDestinations(updatedCells, stampedNodeStates, newTick, mods);

  // 7. Systemic values
  const { stress: newStress } = computeSystemicStress(
    newGroundTruth.nodeStates, perSiteOutputs, state.fever, state.systemicStress, mods
  );
  const prevIntegrity = state.systemicIntegrity;
  const newIntegrity = applySystemicIntegrityHits(state.systemicIntegrity, newStress);
  const newScars = computeNewScars(newGroundTruth.nodeStates, state.scars, newIntegrity, prevIntegrity);
  const scars = [...state.scars, ...newScars];

  // ── Generate modifier choices ────────────────────────────────────────────
  const newPendingChoices = generateModifierChoices(
    groundTruthEvents, newScars, updatedCells, state.runModifiers, mods
  );

  const systemicStressHistory = [
    ...state.systemicStressHistory,
    { turn: newTurn, stress: newStress, integrity: newIntegrity },
  ];

  // 10. Token pool
  const tokensInUse = computeTokensInUse(updatedCells, mods);
  const attentionTokens = tokenCapacity - tokensInUse;

  // 11. Loss / win check
  let phase = state.phase;
  let lossReason = null;
  let postMortem = null;

  if (isSystemCollapsed(newIntegrity)) {
    phase = GAME_PHASES.LOST;
    lossReason = LOSS_REASONS.SYSTEMIC_COLLAPSE;
    postMortem = buildPostMortem(state, finalGroundTruth, systemicStressHistory, scars, 'systemic_collapse');
  } else if (
    totalPathogensSpawned >= WIN_PATHOGEN_TARGET &&
    Object.values(finalGroundTruth.nodeStates).every(ns => !nodeHasActivePathogen(ns))
  ) {
    phase = GAME_PHASES.WON;
    postMortem = buildPostMortem(state, finalGroundTruth, systemicStressHistory, scars, 'pathogens_cleared');
  }

  return {
    ...state,
    tick: newTick,
    turn: newTurn,
    tokenCapacity,
    groundTruth: finalGroundTruth,
    deployedCells: updatedCells,
    attentionTokens,
    tokensInUse,
    systemicStress: newStress,
    systemicIntegrity: newIntegrity,
    systemicStressHistory,
    scars,
    totalPathogensSpawned,
    phase,
    lossReason,
    postMortem,
    pendingModifierChoices: [
      ...(state.pendingModifierChoices ?? []),
      ...newPendingChoices,
    ],
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
  const result = deployFromRoster(cellId, nodeId, state.deployedCells, state.tick, state.groundTruth.nodeStates, state.runModifiers);
  if (!result.success) return state;
  const tokensInUse = computeTokensInUse(result.newDeployedCells, state.runModifiers);
  return {
    ...state,
    deployedCells: result.newDeployedCells,
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

/**
 * Resolve the first pending modifier choice.
 * The patch is recomputed from current runModifiers so stacking is correct
 * even when multiple choices are queued in the same turn.
 */
function handleChooseModifier(state, optionIndex) {
  const pending = state.pendingModifierChoices ?? [];
  if (pending.length === 0) return state;

  const choice = pending[0];
  const option = choice.options[optionIndex ?? 0];
  if (!option) return state;

  // Recompute patch with the current runModifiers (correct stacking)
  const patch = computeOptionPatch(option, state.runModifiers);
  const runModifiers = applyModifierPatch(state.runModifiers, patch);

  // Record the choice
  const historyEntry = {
    modifierId:   option.modifierId,
    category:     option.category,
    name:         option.name,
    rarity:       option.rarity,
    value:        option.value,
    description:  option.description,
    turn:         state.turn,
  };

  let newState = {
    ...state,
    runModifiers,
    pendingModifierChoices: pending.slice(1),
    modifierHistory: [...(state.modifierHistory ?? []), historyEntry],
  };

  // Apply immediate effects (e.g., token capacity bonus from immune_surge upgrade)
  if (option.immediateEffect?.tokenCapacityBonus) {
    const bonus = option.immediateEffect.tokenCapacityBonus;
    const newCapacity = Math.min(TOKEN_CAPACITY_MAX, newState.tokenCapacity + bonus);
    const newAttention = newCapacity - newState.tokensInUse;
    newState = { ...newState, tokenCapacity: newCapacity, attentionTokens: newAttention };
  }

  return newState;
}

// ── Modifier choice generation ─────────────────────────────────────────────────

let _choiceIdCounter = 0;

/**
 * Generate modifier choice events from ground truth events and new scars.
 *
 * @param {Array}  groundTruthEvents  — events returned by advanceGroundTruth
 * @param {Array}  newScars           — scars returned by computeNewScars this turn
 * @param {Object} deployedCells      — cells (before auto-return) to identify clearing cell type
 * @param {Object} runModifiers       — runModifiers at start of turn (for context only)
 * @param {Object} _mods              — alias of runModifiers (unused here, kept for clarity)
 * @returns {Array} pending choice entries
 */
function generateModifierChoices(groundTruthEvents, newScars, deployedCells, runModifiers) {
  const choices = [];

  // ── Upgrade choices: one per pathogen cleared ─────────────────────────────
  const clearedEvents = groundTruthEvents.filter(e => e.type === 'pathogen_cleared');

  for (const event of clearedEvents) {
    const clearingCellType = findPrimaryClearingCellType(
      event.nodeId, event.pathogenType, deployedCells, runModifiers
    );
    const ctx = makeUpgradeContext(
      clearingCellType, event.pathogenType, event.nodeId, runModifiers
    );
    const options = selectUpgradeOptions(ctx, runModifiers, MODIFIER_CHOICE_COUNT);
    if (options.length > 0) {
      choices.push({
        id: `choice_${++_choiceIdCounter}`,
        category: 'upgrade',
        trigger: 'pathogen_cleared',
        nodeId: event.nodeId,
        pathogenType: event.pathogenType,
        options,
      });
    }
  }

  // ── Scar choices: one per new scar ────────────────────────────────────────
  for (const scar of newScars) {
    const ctx = makeScarContext(
      scar.nodeId ?? null, scar.type, scar.threshold ?? null, runModifiers
    );
    const options = selectScarOptions(ctx, runModifiers, MODIFIER_CHOICE_COUNT);
    if (options.length > 0) {
      choices.push({
        id: `choice_${++_choiceIdCounter}`,
        category: 'scar',
        trigger: 'scar_threshold',
        nodeId: scar.nodeId ?? null,
        scarId: scar.id,
        threshold: scar.threshold ?? null,
        options,
      });
    }
  }

  return choices;
}

/**
 * Identify the primary cell type responsible for clearing a pathogen at a node.
 * Returns the attack/recon cell type with highest effective clearance for that pathogen,
 * or null if no cells with clearance were present.
 */
function findPrimaryClearingCellType(nodeId, pathogenType, deployedCells, modifiers) {
  let bestType = null;
  let bestRate = 0;

  for (const cell of Object.values(deployedCells)) {
    if (cell.nodeId !== nodeId || cell.phase !== 'arrived') continue;
    const clearMod = CELL_CONFIG[cell.type]?.clearablePathogens?.[pathogenType] ?? 0;
    if (clearMod === 0) continue;
    const rate = getEffectiveClearanceRate(cell.type, modifiers) * clearMod;
    if (rate > bestRate) { bestType = cell.type; bestRate = rate; }
  }

  return bestType;
}

// ── Post-mortem ────────────────────────────────────────────────────────────────

function buildPostMortem(state, groundTruth, stressHistory, scars, outcome) {
  return {
    outcome,
    failureMode: outcome === 'pathogens_cleared' ? 'pathogens_cleared' : identifyFailureMode(stressHistory),
    finalNodeStates: groundTruth.nodeStates,
    spreadHistory: groundTruth.spreadHistory,
    systemicStressHistory: stressHistory,
    scars,
    turnsPlayed: state.turn,
  };
}

// ── Detection phase ────────────────────────────────────────────────────────────

/**
 * Run all detection rolls for this turn.
 * Each recon cell detects at every node it has visibility over.
 * Updates detected_level / perceived_type on pathogen instances in-place (immutably).
 * Runs BEFORE advanceGroundTruth so cells see the current pathogen state.
 */
function runDetectionPhase(deployedCells, nodesVisited, groundTruth, modifiers) {
  // Build nodeId → [cellType, ...] mapping for all detecting cells this turn
  const detectorsByNode = {};

  const addDetector = (nodeId, cellType) => {
    if (!NODES[nodeId]) return;
    (detectorsByNode[nodeId] ??= []).push(cellType);
  };

  // Arrived recon cells; macrophages also cover adjacent nodes
  for (const cell of Object.values(deployedCells)) {
    if (cell.phase !== 'arrived') continue;
    if (!RECON_CELL_TYPES.has(cell.type)) continue;
    addDetector(cell.nodeId, cell.type);
    if (CELL_CONFIG[cell.type]?.coversAdjacentNodes) {
      for (const adjId of (NODES[cell.nodeId]?.connections ?? [])) {
        addDetector(adjId, cell.type);
      }
    }
  }

  // En-route cells visiting intermediate nodes
  for (const { cellType, nodeId } of nodesVisited) {
    if (RECON_CELL_TYPES.has(cellType)) addDetector(nodeId, cellType);
  }

  if (Object.keys(detectorsByNode).length === 0) return groundTruth;

  let nodeStates = { ...groundTruth.nodeStates };

  for (const [nodeId, cellTypes] of Object.entries(detectorsByNode)) {
    const ns = nodeStates[nodeId];
    if (!ns?.pathogens?.length) continue;

    let pathogens = ns.pathogens;
    const inflammation = ns.inflammation ?? 0;

    for (const cellType of cellTypes) {
      pathogens = performDetection(cellType, pathogens, inflammation, modifiers);
    }

    nodeStates = { ...nodeStates, [nodeId]: { ...ns, pathogens } };
  }

  return { ...groundTruth, nodeStates };
}

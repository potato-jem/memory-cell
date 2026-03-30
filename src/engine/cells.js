// Cell manufacturing + deployment — pure functions.
//
// Lifecycle:  training → ready → outbound → arrived → returning → ready  (loops)
//
// Path-based movement: cells store path[], pathIndex, destNodeId.
// nodeId = path[pathIndex] = current intermediate position.
// Movement budget = 1 per turn; exit cost = signalTravelCost of node being left.
// 0-cost nodes (SPLEEN) allow free passage to the next hop in the same turn.
//
// Tokens are held by every cell in the roster regardless of phase.
// Tokens are freed only when a cell is explicitly decommissioned.
//
// All functions accept an optional `modifiers` (runModifiers) parameter.
// When null/undefined, base config values are used (fully backward compatible).

import { NODES, HQ_NODE_ID, computePathWithModifiers } from '../data/nodes.js';
import { nodeHasActivePathogen } from '../data/pathogens.js';
import { PATROL_DWELL_TICKS, SCOUT_DWELL_TICKS, TRAINING_TICKS } from '../data/gameConfig.js';
import {
  DEPLOY_COSTS,
  CLEARANCE_RATES,
  CELL_DISPLAY_NAMES,
  ATTACK_CELL_TYPES,
  getEffectiveClearanceRate,
  getEffectiveDeployCost,
  getEffectiveTrainingTicks,
  getEffectiveEffectiveness,
} from '../data/cellConfig.js';
import { getEffectiveConnections, getEffectiveExitCost } from '../data/runModifiers.js';

// Re-export flat tables for backward compatibility
export { DEPLOY_COSTS, CLEARANCE_RATES, CELL_DISPLAY_NAMES };

export const CELL_TYPES = {
  DENDRITIC:  'dendritic',
  NEUTROPHIL: 'neutrophil',
  RESPONDER:  'responder',
  KILLER_T:   'killer_t',
  B_CELL:     'b_cell',
  NK_CELL:    'nk_cell',
  MACROPHAGE: 'macrophage',
};

let _cellIdCounter = 1;
function nextCellId() { return `cell_${_cellIdCounter++}`; }

// ── Token accounting ──────────────────────────────────────────────────────────

export function computeTokensInUse(deployedCells, modifiers = null) {
  let total = 0;
  for (const cell of Object.values(deployedCells)) {
    total += getEffectiveDeployCost(cell.type, modifiers);
  }
  return total;
}

function getTokensAvailable(deployedCells, tokenCapacity, modifiers) {
  return tokenCapacity - computeTokensInUse(deployedCells, modifiers);
}

// ── Starting cells (pre-game, no training delay) ──────────────────────────────

export function makeReadyCell(type) {
  return {
    id: nextCellId(),
    type,
    nodeId: null,
    phase: 'ready',
    trainedAtTick: 0,
    trainingCompleteTick: 0,
    deployedAtTick: null,
    arrivalTick: null,
    returnTick: null,
    path: null,
    pathIndex: 0,
    destNodeId: null,
  };
}

// ── Manufacturing ─────────────────────────────────────────────────────────────

export function trainCell(type, deployedCells, tokenCapacity, tick, modifiers = null) {
  const cost = getEffectiveDeployCost(type, modifiers);
  const available = getTokensAvailable(deployedCells, tokenCapacity, modifiers);
  if (available < cost) {
    return { success: false, error: `Need ${cost} tokens (have ${available})` };
  }
  const baseTicks = TRAINING_TICKS[type] ?? 15;
  const trainingTime = getEffectiveTrainingTicks(type, baseTicks, modifiers);
  const cell = {
    id: nextCellId(),
    type,
    nodeId: null,
    phase: 'training',
    trainedAtTick: tick,
    trainingCompleteTick: tick + trainingTime,
    deployedAtTick: null,
    arrivalTick: null,
    returnTick: null,
    path: null,
    pathIndex: 0,
    destNodeId: null,
  };
  return { success: true, newDeployedCells: { ...deployedCells, [cell.id]: cell }, cost };
}

// ── Deployment ────────────────────────────────────────────────────────────────

export function deployFromRoster(cellId, nodeId, deployedCells, tick, nodeStates, modifiers = null) {
  const cell = deployedCells[cellId];
  if (!cell) return { success: false, error: 'Cell not found' };
  if (cell.phase === 'training') return { success: false, error: 'Cell is still in training' };

  const node = NODES[nodeId];
  if (!node) return { success: false, error: `Unknown node: ${nodeId}` };

  if (cell.type === CELL_TYPES.KILLER_T && !nodeHasClassifiedPathogen(nodeId, nodeStates)) {
    return { success: false, error: 'Killer T requires classified threat', requiresDendritic: true };
  }

  const fromNodeId = (cell.phase === 'arrived' || cell.phase === 'returning')
    ? cell.nodeId
    : HQ_NODE_ID;

  const path = computePathWithModifiers(fromNodeId, nodeId, modifiers);
  const extra = _deployExtra(cell.type, nodeId, nodeStates, modifiers);

  return {
    success: true,
    newDeployedCells: {
      ...deployedCells,
      [cellId]: {
        ...cell,
        nodeId: fromNodeId,
        phase: 'outbound',
        path,
        pathIndex: 0,
        destNodeId: nodeId,
        deployedAtTick: tick,
        arrivalTick: null,
        returnTick: null,
        scoutDwellUntilTick: null,
        ...extra,
      },
    },
  };
}

function _deployExtra(type, nodeId, nodeStates, modifiers) {
  const hasDC = nodeHasClassifiedPathogen(nodeId, nodeStates);
  switch (type) {
    case CELL_TYPES.NEUTROPHIL:
      return { patrolConnectionIdx: 0, patrolNextMoveTick: null };
    case CELL_TYPES.RESPONDER:
      return { effectiveness: getEffectiveEffectiveness(type, hasDC, modifiers), hasDendriticBacking: hasDC };
    case CELL_TYPES.KILLER_T:
      return { effectiveness: getEffectiveEffectiveness(type, true, modifiers), hasDendriticBacking: true };
    case CELL_TYPES.B_CELL:
      return { effectiveness: getEffectiveEffectiveness(type, hasDC, modifiers), hasDendriticBacking: hasDC };
    case CELL_TYPES.NK_CELL:
      return { effectiveness: getEffectiveEffectiveness(type, false, modifiers), hasDendriticBacking: false };
    case CELL_TYPES.MACROPHAGE:
      return { coversAdjacentNodes: true };
    default:
      return {};
  }
}

// ── Decommission ──────────────────────────────────────────────────────────────

export function decommissionCell(cellId, deployedCells) {
  const cell = deployedCells[cellId];
  if (!cell) return { success: false, error: 'Cell not found' };
  if (cell.phase === 'outbound' || cell.phase === 'arrived' || cell.phase === 'returning') {
    return { success: false, error: 'Recall cell before decommissioning' };
  }
  const { [cellId]: _removed, ...rest } = deployedCells;
  return { success: true, newDeployedCells: rest };
}

// ── Recall ────────────────────────────────────────────────────────────────────

export function recallUnit(cellId, deployedCells, tick, modifiers = null) {
  const cell = deployedCells[cellId];
  if (!cell) return { success: false, error: `Cell ${cellId} not found` };
  if (cell.phase === 'returning') return { success: false, error: 'Already returning' };
  if (cell.phase === 'training' || cell.phase === 'ready') {
    return { success: false, error: 'Cell is not deployed' };
  }

  if (cell.phase === 'outbound') {
    return {
      success: true,
      newDeployedCells: {
        ...deployedCells,
        [cellId]: {
          ...cell,
          phase: 'ready',
          nodeId: null,
          path: null,
          pathIndex: 0,
          destNodeId: null,
          deployedAtTick: null,
          arrivalTick: null,
        },
      },
    };
  }

  const returnPath = computePathWithModifiers(cell.nodeId, HQ_NODE_ID, modifiers);
  return {
    success: true,
    newDeployedCells: {
      ...deployedCells,
      [cellId]: {
        ...cell,
        phase: 'returning',
        path: returnPath,
        pathIndex: 0,
        destNodeId: HQ_NODE_ID,
        returnTick: null,
      },
    },
  };
}

// ── Tick advance ──────────────────────────────────────────────────────────────
// Returns { updatedCells, events, nodesVisited }

export function advanceCells(deployedCells, tick, modifiers = null) {
  const updated = {};
  const events = [];
  const nodesVisited = [];

  for (const [cellId, cell] of Object.entries(deployedCells)) {
    let c = { ...cell };

    // ── Training → ready ──────────────────────────────────────────────────────
    if (c.phase === 'training' && tick >= c.trainingCompleteTick) {
      c.phase = 'ready';
      c.nodeId = null;
      events.push({ type: 'cell_ready', cellId, cellType: c.type });
    }

    // ── Outbound movement (path-based) ────────────────────────────────────────
    if (c.phase === 'outbound' && c.path && c.pathIndex < c.path.length - 1) {
      let budget = 1;
      while (c.pathIndex < c.path.length - 1) {
        const baseExitCost = NODES[c.path[c.pathIndex]]?.signalTravelCost ?? 1;
        const exitCost = getEffectiveExitCost(c.path[c.pathIndex], baseExitCost, modifiers);
        if (exitCost > 0 && budget < exitCost) break;
        budget -= exitCost;
        c.pathIndex++;
        c.nodeId = c.path[c.pathIndex];
        nodesVisited.push({ cellId, cellType: c.type, nodeId: c.nodeId });
        if (budget <= 0) break;
      }

      if (c.pathIndex >= c.path.length - 1) {
        if (c.type === CELL_TYPES.DENDRITIC) {
          c.phase = 'arrived';
          c.scoutDwellUntilTick = tick + SCOUT_DWELL_TICKS;
          events.push({ type: 'scout_arrived', cellId, nodeId: c.nodeId });
        } else if (c.type === CELL_TYPES.NEUTROPHIL) {
          c.phase = 'arrived';
          c.patrolNextMoveTick = tick + PATROL_DWELL_TICKS;
          events.push({ type: 'cell_arrived', cellId, nodeId: c.nodeId, cellType: c.type });
        } else {
          c.phase = 'arrived';
          events.push({ type: 'cell_arrived', cellId, nodeId: c.nodeId, cellType: c.type });
        }
      }
    }

    // ── Scout dwell complete → start return journey ───────────────────────────
    if (c.type === CELL_TYPES.DENDRITIC && c.phase === 'arrived' &&
        c.scoutDwellUntilTick != null && tick >= c.scoutDwellUntilTick) {
      const returnPath = computePathWithModifiers(c.nodeId, HQ_NODE_ID, modifiers);
      c.phase = 'returning';
      c.path = returnPath;
      c.pathIndex = 0;
      c.destNodeId = HQ_NODE_ID;
      c.scoutDwellUntilTick = null;
    }

    // ── Patrol movement (cycles adjacent nodes) ───────────────────────────────
    if (c.type === CELL_TYPES.NEUTROPHIL && c.phase === 'arrived' &&
        c.patrolNextMoveTick != null && tick >= c.patrolNextMoveTick) {
      const baseConnections = NODES[c.nodeId]?.connections ?? [];
      const connections = getEffectiveConnections(c.nodeId, baseConnections, modifiers);
      if (connections.length > 0) {
        const nextIdx = ((c.patrolConnectionIdx ?? 0) + 1) % connections.length;
        c.nodeId = connections[nextIdx];
        c.patrolConnectionIdx = nextIdx;
        c.patrolNextMoveTick = tick + PATROL_DWELL_TICKS;
        nodesVisited.push({ cellId, cellType: c.type, nodeId: c.nodeId });
      }
    }

    // ── Returning movement (path-based) ───────────────────────────────────────
    if (c.phase === 'returning' && c.path && c.pathIndex < c.path.length - 1) {
      let budget = 1;
      while (c.pathIndex < c.path.length - 1) {
        const baseExitCost = NODES[c.path[c.pathIndex]]?.signalTravelCost ?? 1;
        const exitCost = getEffectiveExitCost(c.path[c.pathIndex], baseExitCost, modifiers);
        if (exitCost > 0 && budget < exitCost) break;
        budget -= exitCost;
        c.pathIndex++;
        c.nodeId = c.path[c.pathIndex];
        if (budget <= 0) break;
      }

      if (c.pathIndex >= c.path.length - 1) {
        events.push({ type: 'cell_returned', cellId, nodeId: c.nodeId, cellType: c.type });
        c.phase = 'ready';
        c.nodeId = null;
        c.path = null;
        c.pathIndex = 0;
        c.destNodeId = null;
        c.arrivalTick = null;
        c.deployedAtTick = null;
        c.returnTick = null;
      }
    }

    // Legacy: returning cell without path
    if (c.phase === 'returning' && !c.path && c.returnTick != null && tick >= c.returnTick) {
      events.push({ type: 'cell_returned', cellId, nodeId: c.nodeId, cellType: c.type });
      c.phase = 'ready';
      c.nodeId = null;
      c.returnTick = null;
      c.arrivalTick = null;
      c.deployedAtTick = null;
    }

    updated[cellId] = c;
  }

  return { updatedCells: updated, events, nodesVisited };
}

// Auto-return attack cells when their node's pathogen is cleared.
export function startReturnForClearedNodes(deployedCells, nodeStates, tick, modifiers = null) {
  const updated = { ...deployedCells };
  for (const [cellId, cell] of Object.entries(updated)) {
    if (!ATTACK_CELL_TYPES.has(cell.type)) continue;
    if (cell.phase !== 'arrived') continue;
    const ns = nodeStates[cell.nodeId];
    const hasPathogen = nodeHasActivePathogen(ns);
    if (!hasPathogen) {
      const returnPath = computePathWithModifiers(cell.nodeId, HQ_NODE_ID, modifiers);
      updated[cellId] = {
        ...cell,
        phase: 'returning',
        path: returnPath,
        pathIndex: 0,
        destNodeId: HQ_NODE_ID,
        returnTick: null,
      };
    }
  }
  return updated;
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * True if any pathogen at this node has been fully classified.
 * Replaces the old perceivedState.scoutConfirmed check.
 * Attack cells use this to determine backing effectiveness.
 */
export function nodeHasClassifiedPathogen(nodeId, nodeStates) {
  const ns = nodeStates?.[nodeId];
  return ns?.pathogens?.some(i => i.detected_level === 'classified') ?? false;
}

export function getClearancePower(nodeId, deployedCells, groundTruth, modifiers = null) {
  let total = 0;
  for (const cell of Object.values(deployedCells)) {
    if (cell.phase !== 'arrived' || cell.nodeId !== nodeId) continue;
    const baseRate = CLEARANCE_RATES[cell.type] ?? 0;
    if (baseRate === 0) continue;
    const effectiveRate = getEffectiveClearanceRate(cell.type, modifiers);
    const effectiveness = cell.effectiveness ?? 1.0;
    const nodeState = groundTruth?.nodeStates?.[nodeId];
    if (cell.type === CELL_TYPES.NK_CELL && nodeState?.isClean) {
      total += effectiveRate * 0.3;
    } else {
      total += effectiveRate * effectiveness;
    }
  }
  return total;
}

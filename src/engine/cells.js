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

import { NODES, HQ_NODE_ID, computePath, computePathCost } from '../data/nodes.js';
import {
  PATROL_DWELL_TICKS,
  SCOUT_DWELL_TICKS,
  TRAINING_TICKS,
} from '../data/gameConfig.js';

export const CELL_TYPES = {
  DENDRITIC:  'dendritic',
  NEUTROPHIL: 'neutrophil',   // patrol — circuits through connected nodes
  RESPONDER:  'responder',
  KILLER_T:   'killer_t',
  B_CELL:     'b_cell',
  NK_CELL:    'nk_cell',
  MACROPHAGE: 'macrophage',   // static coverage — sees own node + adjacent
};

// Token cost to manufacture each cell type (held for the cell's lifetime)
export const DEPLOY_COSTS = {
  [CELL_TYPES.DENDRITIC]:  2,
  [CELL_TYPES.NEUTROPHIL]: 1,
  [CELL_TYPES.RESPONDER]:  3,
  [CELL_TYPES.KILLER_T]:   4,
  [CELL_TYPES.B_CELL]:     2,
  [CELL_TYPES.NK_CELL]:    3,
  [CELL_TYPES.MACROPHAGE]: 1,
};

export const CLEARANCE_RATES = {
  [CELL_TYPES.RESPONDER]: 12,
  [CELL_TYPES.KILLER_T]:  20,
  [CELL_TYPES.B_CELL]:     8,
  [CELL_TYPES.NK_CELL]:   15,
  [CELL_TYPES.MACROPHAGE]: 4,
};

export const AUTOIMMUNE_RISK = {
  [CELL_TYPES.RESPONDER]: 0.3,
  [CELL_TYPES.KILLER_T]:  0.6,
  [CELL_TYPES.B_CELL]:    0.1,
  [CELL_TYPES.NK_CELL]:   0.3,
  [CELL_TYPES.MACROPHAGE]:0.0,
};

// Human-readable display names for UI
export const CELL_DISPLAY_NAMES = {
  [CELL_TYPES.DENDRITIC]:  'Scout',
  [CELL_TYPES.NEUTROPHIL]: 'Patrol',
  [CELL_TYPES.RESPONDER]:  'Responder',
  [CELL_TYPES.KILLER_T]:   'Killer T',
  [CELL_TYPES.B_CELL]:     'B-Cell',
  [CELL_TYPES.NK_CELL]:    'NK Cell',
  [CELL_TYPES.MACROPHAGE]: 'Macrophage',
};

let _cellIdCounter = 1;
function nextCellId() { return `cell_${_cellIdCounter++}`; }

// ── Token accounting ──────────────────────────────────────────────────────────
// Counts ALL cells in roster (any phase). tokenCapacity comes from game state.

export function computeTokensInUse(deployedCells) {
  let total = 0;
  for (const cell of Object.values(deployedCells)) {
    total += DEPLOY_COSTS[cell.type] ?? 0;
  }
  return total;
}

export function getTokensAvailable(deployedCells, tokenCapacity) {
  return tokenCapacity - computeTokensInUse(deployedCells);
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

export function trainCell(type, deployedCells, tokenCapacity, tick) {
  const cost = DEPLOY_COSTS[type];
  const available = getTokensAvailable(deployedCells, tokenCapacity);
  if (available < cost) {
    return { success: false, error: `Need ${cost} tokens (have ${available})` };
  }
  const trainingTime = TRAINING_TICKS[type] ?? 15;
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
// Moves any non-training cell to a new node.
// Works whether the cell is ready (from roster) or already deployed anywhere.

export function deployFromRoster(cellId, nodeId, deployedCells, tick, perceivedState) {
  const cell = deployedCells[cellId];
  if (!cell) return { success: false, error: 'Cell not found' };
  if (cell.phase === 'training') return { success: false, error: 'Cell is still in training' };

  const node = NODES[nodeId];
  if (!node) return { success: false, error: `Unknown node: ${nodeId}` };

  if (cell.type === CELL_TYPES.KILLER_T && !hasDendriticConfirmation(nodeId, perceivedState)) {
    return { success: false, error: 'Killer T requires scout confirmation', requiresDendritic: true };
  }

  // Origin: arrived/returning cells travel from their current node; others from HQ
  const fromNodeId = (cell.phase === 'arrived' || cell.phase === 'returning')
    ? cell.nodeId
    : HQ_NODE_ID;

  const path = computePath(fromNodeId, nodeId);
  const extra = _deployExtra(cell.type, nodeId, perceivedState);

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

function _deployExtra(type, nodeId, perceivedState) {
  const hasDC = hasDendriticConfirmation(nodeId, perceivedState);
  switch (type) {
    case CELL_TYPES.NEUTROPHIL:
      return { patrolConnectionIdx: 0, patrolNextMoveTick: null };
    case CELL_TYPES.RESPONDER:
      return { effectiveness: hasDC ? 1.0 : 0.6, hasDendriticBacking: hasDC };
    case CELL_TYPES.KILLER_T:
      return { effectiveness: 1.0, hasDendriticBacking: true };
    case CELL_TYPES.B_CELL:
      return { effectiveness: hasDC ? 1.0 : 0.85, hasDendriticBacking: hasDC };
    case CELL_TYPES.NK_CELL:
      return { effectiveness: 1.0, hasDendriticBacking: false };
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

export function recallUnit(cellId, deployedCells, tick) {
  const cell = deployedCells[cellId];
  if (!cell) return { success: false, error: `Cell ${cellId} not found` };
  if (cell.phase === 'returning') return { success: false, error: 'Already returning' };
  if (cell.phase === 'training' || cell.phase === 'ready') {
    return { success: false, error: 'Cell is not deployed' };
  }

  if (cell.phase === 'outbound') {
    // Cancel deploy — back to ready immediately
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

  // arrived → start return journey
  const returnPath = computePath(cell.nodeId, HQ_NODE_ID);
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
// events: [{ type, cellId, nodeId?, cellType }]
// nodesVisited: [{ cellId, cellType, nodeId }] — intermediate nodes touched this tick

export function advanceCells(deployedCells, tick) {
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
        const exitCost = NODES[c.path[c.pathIndex]]?.signalTravelCost ?? 1;
        if (exitCost > 0 && budget < exitCost) break;
        budget -= exitCost;
        c.pathIndex++;
        c.nodeId = c.path[c.pathIndex];
        nodesVisited.push({ cellId, cellType: c.type, nodeId: c.nodeId });
        if (budget <= 0) break;
      }

      // Check arrival at destination
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
      const returnPath = computePath(c.nodeId, HQ_NODE_ID);
      c.phase = 'returning';
      c.path = returnPath;
      c.pathIndex = 0;
      c.destNodeId = HQ_NODE_ID;
      c.scoutDwellUntilTick = null;
    }

    // ── Patrol movement (cycles adjacent nodes) ───────────────────────────────
    if (c.type === CELL_TYPES.NEUTROPHIL && c.phase === 'arrived' &&
        c.patrolNextMoveTick != null && tick >= c.patrolNextMoveTick) {
      const connections = NODES[c.nodeId]?.connections ?? [];
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
        const exitCost = NODES[c.path[c.pathIndex]]?.signalTravelCost ?? 1;
        if (exitCost > 0 && budget < exitCost) break;
        budget -= exitCost;
        c.pathIndex++;
        c.nodeId = c.path[c.pathIndex];
        if (budget <= 0) break;
      }

      // Check arrival at HQ
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

    // Legacy: returning cell without path (shouldn't happen with new deploys, but safe fallback)
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
export function startReturnForClearedNodes(deployedCells, nodeStates, tick) {
  const ATTACK_TYPES = new Set([
    CELL_TYPES.RESPONDER, CELL_TYPES.KILLER_T, CELL_TYPES.B_CELL, CELL_TYPES.NK_CELL,
  ]);
  const updated = { ...deployedCells };
  for (const [cellId, cell] of Object.entries(updated)) {
    if (!ATTACK_TYPES.has(cell.type)) continue;
    if (cell.phase !== 'arrived') continue;
    const ns = nodeStates[cell.nodeId];
    const hasPathogen = ns && Object.values(ns.pathogens ?? {}).some(inst => {
      const tv = inst.type ? Object.keys(inst).find(k => k !== 'type') : null;
      return tv ? (inst[tv] ?? 0) > 0 : false;
    });
    if (!hasPathogen) {
      const returnPath = computePath(cell.nodeId, HQ_NODE_ID);
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

export function hasDendriticConfirmation(nodeId, perceivedState) {
  return perceivedState?.nodes?.[nodeId]?.scoutConfirmed ?? false;
}

export function getPatrolCoverage(deployedCells) {
  const coverage = {};
  for (const cell of Object.values(deployedCells)) {
    if (cell.phase !== 'arrived') continue;
    if (cell.type === CELL_TYPES.NEUTROPHIL) {
      coverage[cell.nodeId] = true;
    }
    if (cell.type === CELL_TYPES.MACROPHAGE) {
      coverage[cell.nodeId] = true;
      for (const adj of (NODES[cell.nodeId]?.connections ?? [])) {
        if (!coverage[adj]) coverage[adj] = 'adjacent';
      }
    }
  }
  return coverage;
}

export function getClearancePower(nodeId, deployedCells, groundTruth) {
  let total = 0;
  for (const cell of Object.values(deployedCells)) {
    if (cell.phase !== 'arrived' || cell.nodeId !== nodeId) continue;
    const baseRate = CLEARANCE_RATES[cell.type] ?? 0;
    if (baseRate === 0) continue;
    const effectiveness = cell.effectiveness ?? 1.0;
    const nodeState = groundTruth?.nodeStates?.[nodeId];
    if (cell.type === CELL_TYPES.NK_CELL && nodeState?.isClean) {
      total += baseRate * 0.3;
    } else {
      total += baseRate * effectiveness;
    }
  }
  return total;
}

export function getDeploymentSummary(deployedCells) {
  return Object.values(deployedCells).map(cell => ({
    id: cell.id,
    type: cell.type,
    nodeId: cell.nodeId,
    phase: cell.phase,
    destNodeId: cell.destNodeId ?? null,
    arrivalTick: cell.arrivalTick ?? null,
    returnTick: cell.returnTick ?? null,
    effectiveness: cell.effectiveness ?? null,
    hasDendriticBacking: cell.hasDendriticBacking ?? null,
  }));
}

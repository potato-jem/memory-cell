// Cell manufacturing + deployment — pure functions.
//
// Lifecycle:  training → ready → outbound → arrived → returning → ready  (loops)
//
// Tokens are held by every cell in the roster regardless of phase.
// Tokens are freed only when a cell is explicitly decommissioned.
// tokenCapacity (from game state) grows slowly over time via regen.

import { NODES, HQ_NODE_ID, getHopDistance } from '../data/nodes.js';
import {
  ATTACK_TRANSIT_PER_HOP,
  SCOUT_TRANSIT_PER_HOP,
  PATROL_DWELL_TICKS,
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

// ── Transit time ──────────────────────────────────────────────────────────────

export function getTransitTicks(targetNodeId, cellType) {
  const hops = Math.max(1, getHopDistance(HQ_NODE_ID, targetNodeId));
  if (cellType === CELL_TYPES.DENDRITIC) return hops * SCOUT_TRANSIT_PER_HOP;
  return hops * ATTACK_TRANSIT_PER_HOP;
}

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
  };
  return { success: true, newDeployedCells: { ...deployedCells, [cell.id]: cell }, cost };
}

// ── Deployment ────────────────────────────────────────────────────────────────
// Moves a ready cell from roster into the field.

export function deployFromRoster(cellId, nodeId, deployedCells, tick, perceivedState) {
  const cell = deployedCells[cellId];
  if (!cell || cell.phase !== 'ready') {
    return { success: false, error: 'Cell is not ready to deploy' };
  }
  const node = NODES[nodeId];
  if (!node) return { success: false, error: `Unknown node: ${nodeId}` };

  if (cell.type === CELL_TYPES.KILLER_T && !hasDendriticConfirmation(nodeId, perceivedState)) {
    return { success: false, error: 'Killer T requires scout confirmation', requiresDendritic: true };
  }

  const transitTicks = getTransitTicks(nodeId, cell.type);
  const extra = _deployExtra(cell.type, nodeId, perceivedState);

  return {
    success: true,
    newDeployedCells: {
      ...deployedCells,
      [cellId]: {
        ...cell,
        nodeId,
        phase: 'outbound',
        deployedAtTick: tick,
        arrivalTick: tick + transitTicks,
        returnTick: null,
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
// Removes a cell from the roster entirely. Frees its token cost.
// Only valid for training or ready cells (can't decommission mid-field).

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
// outbound → ready (cancel transit, cell stays in roster)
// arrived  → returning → (auto-transitions to ready in advanceCells)

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
        [cellId]: { ...cell, phase: 'ready', nodeId: null, deployedAtTick: null, arrivalTick: null },
      },
    };
  }

  // arrived → start return journey
  const transitTicks = getTransitTicks(cell.nodeId, cell.type);
  return {
    success: true,
    newDeployedCells: {
      ...deployedCells,
      [cellId]: { ...cell, phase: 'returning', returnTick: tick + transitTicks },
    },
  };
}

// ── Tick advance ──────────────────────────────────────────────────────────────
// Returns { updatedCells, events }
// events: [{ type, cellId, nodeId?, cellType }]

export function advanceCells(deployedCells, tick) {
  const updated = {};
  const events = [];

  for (const [cellId, cell] of Object.entries(deployedCells)) {
    let c = { ...cell };

    // Training → ready
    if (c.phase === 'training' && tick >= c.trainingCompleteTick) {
      c.phase = 'ready';
      c.nodeId = null;
      events.push({ type: 'cell_ready', cellId, cellType: c.type });
    }

    // Outbound → arrived (or returning for scouts)
    if (c.phase === 'outbound' && tick >= c.arrivalTick) {
      if (c.type === CELL_TYPES.DENDRITIC) {
        const transitTicks = c.arrivalTick - c.deployedAtTick;
        c.phase = 'returning';
        c.returnTick = tick + transitTicks;
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

    // Patrol movement
    if (c.type === CELL_TYPES.NEUTROPHIL && c.phase === 'arrived' &&
        c.patrolNextMoveTick != null && tick >= c.patrolNextMoveTick) {
      const connections = NODES[c.nodeId]?.connections ?? [];
      if (connections.length > 0) {
        const nextIdx = ((c.patrolConnectionIdx ?? 0) + 1) % connections.length;
        c.nodeId = connections[nextIdx];
        c.patrolConnectionIdx = nextIdx;
        c.patrolNextMoveTick = tick + PATROL_DWELL_TICKS;
      }
    }

    // Returning → ready (cells return to roster, not removed)
    if (c.phase === 'returning' && c.returnTick != null && tick >= c.returnTick) {
      events.push({ type: 'cell_returned', cellId, nodeId: c.nodeId, cellType: c.type });
      c.phase = 'ready';
      c.nodeId = null;
      c.returnTick = null;
      c.arrivalTick = null;
      c.deployedAtTick = null;
    }

    updated[cellId] = c;
  }

  return { updatedCells: updated, events };
}

// Auto-return attack cells when their node's pathogen is cleared.
export function startReturnForClearedNodes(deployedCells, pathogenState, tick) {
  const ATTACK_TYPES = new Set([
    CELL_TYPES.RESPONDER, CELL_TYPES.KILLER_T, CELL_TYPES.B_CELL, CELL_TYPES.NK_CELL,
  ]);
  const updated = { ...deployedCells };
  for (const [cellId, cell] of Object.entries(updated)) {
    if (!ATTACK_TYPES.has(cell.type)) continue;
    if (cell.phase !== 'arrived') continue;
    const p = pathogenState[cell.nodeId];
    if (!p || p.strength <= 0) {
      const transitTicks = getTransitTicks(cell.nodeId, cell.type);
      updated[cellId] = { ...cell, phase: 'returning', returnTick: tick + transitTicks };
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
    arrivalTick: cell.arrivalTick ?? null,
    returnTick: cell.returnTick ?? null,
    effectiveness: cell.effectiveness ?? null,
    hasDendriticBacking: cell.hasDendriticBacking ?? null,
  }));
}

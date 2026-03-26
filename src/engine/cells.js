// Cell deployment mechanics — pure functions.
// Real-time rewrite: tick-based transit, token pool (tokens held while deployed, returned on return).

import { NODES, HQ_NODE_ID, getHopDistance } from '../data/nodes.js';
import {
  TOTAL_TOKENS,
  ATTACK_TRANSIT_PER_HOP,
  SCOUT_TRANSIT_PER_HOP,
  PATROL_DWELL_TICKS,
} from '../data/gameConfig.js';

export const CELL_TYPES = {
  DENDRITIC: 'dendritic',
  NEUTROPHIL: 'neutrophil',   // patrol — circuits through connected nodes
  RESPONDER: 'responder',
  KILLER_T: 'killer_t',
  B_CELL: 'b_cell',
  NK_CELL: 'nk_cell',
  MACROPHAGE: 'macrophage',   // static coverage — sees own node + adjacent
};

export const DEPLOY_COSTS = {
  [CELL_TYPES.DENDRITIC]:  2,
  [CELL_TYPES.NEUTROPHIL]: 1,
  [CELL_TYPES.RESPONDER]:  3,
  [CELL_TYPES.KILLER_T]:   4,  // expensive — requires scout confirmation
  [CELL_TYPES.B_CELL]:     2,
  [CELL_TYPES.NK_CELL]:    3,  // no confirmation needed — calculated risk
  [CELL_TYPES.MACROPHAGE]: 1,  // ambient sensing + coverage
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

// Cell phases:
//   outbound   — travelling from HQ to destination
//   arrived    — at destination node, working
//   returning  — travelling back to HQ (tokens still held)
// Cells are removed from deployedCells when returnTick is reached.

let _cellIdCounter = 1;
function nextCellId() { return `cell_${_cellIdCounter++}`; }

// ── Transit time ──────────────────────────────────────────────────────────────

export function getTransitTicks(targetNodeId, cellType) {
  const hops = Math.max(1, getHopDistance(HQ_NODE_ID, targetNodeId));
  if (cellType === CELL_TYPES.DENDRITIC) return hops * SCOUT_TRANSIT_PER_HOP;
  return hops * ATTACK_TRANSIT_PER_HOP;
}

// ── Token pool ────────────────────────────────────────────────────────────────

export function computeTokensInUse(deployedCells) {
  let total = 0;
  for (const cell of Object.values(deployedCells)) {
    total += DEPLOY_COSTS[cell.type] ?? 0;
  }
  return total;
}

export function getTokensAvailable(deployedCells) {
  return TOTAL_TOKENS - computeTokensInUse(deployedCells);
}

// ── Deploy functions ──────────────────────────────────────────────────────────

export function deployDendriticCell(nodeId, deployedCells, tokensAvailable, tick) {
  return deployCell(CELL_TYPES.DENDRITIC, nodeId, deployedCells, tokensAvailable, tick, {});
}

export function deployNeutrophilPatrol(nodeId, deployedCells, tokensAvailable, tick) {
  return deployCell(CELL_TYPES.NEUTROPHIL, nodeId, deployedCells, tokensAvailable, tick, {
    patrolConnectionIdx: 0,
    patrolNextMoveTick: null, // set when arrived
  });
}

export function deployResponder(nodeId, deployedCells, tokensAvailable, tick, hasDendriticConf) {
  return deployCell(CELL_TYPES.RESPONDER, nodeId, deployedCells, tokensAvailable, tick, {
    effectiveness: hasDendriticConf ? 1.0 : 0.6,
    hasDendriticBacking: hasDendriticConf,
  });
}

export function deployKillerT(nodeId, deployedCells, tokensAvailable, tick, hasDendriticConf) {
  if (!hasDendriticConf) {
    return { success: false, error: 'Killer T requires scout confirmation first.', requiresDendritic: true };
  }
  return deployCell(CELL_TYPES.KILLER_T, nodeId, deployedCells, tokensAvailable, tick, {
    effectiveness: 1.0,
    hasDendriticBacking: true,
  });
}

export function deployBCell(nodeId, deployedCells, tokensAvailable, tick, hasDendriticConf) {
  return deployCell(CELL_TYPES.B_CELL, nodeId, deployedCells, tokensAvailable, tick, {
    effectiveness: hasDendriticConf ? 1.0 : 0.85,
    hasDendriticBacking: hasDendriticConf,
  });
}

export function deployNKCell(nodeId, deployedCells, tokensAvailable, tick) {
  return deployCell(CELL_TYPES.NK_CELL, nodeId, deployedCells, tokensAvailable, tick, {
    effectiveness: 1.0,
    hasDendriticBacking: false,
  });
}

export function deployMacrophage(nodeId, deployedCells, tokensAvailable, tick) {
  return deployCell(CELL_TYPES.MACROPHAGE, nodeId, deployedCells, tokensAvailable, tick, {
    coversAdjacentNodes: true,
  });
}

function deployCell(type, nodeId, deployedCells, tokensAvailable, tick, extra = {}) {
  const cost = DEPLOY_COSTS[type];
  if (tokensAvailable < cost) {
    return { success: false, error: `Not enough tokens (need ${cost}, have ${tokensAvailable})` };
  }
  const node = NODES[nodeId];
  if (!node) return { success: false, error: `Unknown node: ${nodeId}` };

  const transitTicks = getTransitTicks(nodeId, type);
  const cell = {
    id: nextCellId(),
    type,
    nodeId,
    phase: 'outbound',
    deployedAtTick: tick,
    arrivalTick: tick + transitTicks,
    returnTick: null,
    ...extra,
  };

  return { success: true, newDeployedCells: { ...deployedCells, [cell.id]: cell }, cost };
}

// ── Recall ────────────────────────────────────────────────────────────────────

// Returns { success, newDeployedCells, immediate }
// immediate=true means tokens freed right now (cell cancelled while outbound)
// immediate=false means cell is returning — tokens freed when returnTick reached
export function recallUnit(cellId, deployedCells, tick) {
  const cell = deployedCells[cellId];
  if (!cell) return { success: false, error: `Cell ${cellId} not found` };
  if (cell.phase === 'returning') return { success: false, error: 'Already returning' };

  if (cell.phase === 'outbound') {
    // Cancel immediately — tokens freed now
    const { [cellId]: _removed, ...rest } = deployedCells;
    return { success: true, newDeployedCells: rest, immediate: true };
  }

  // Phase 'arrived' — start return journey
  const transitTicks = getTransitTicks(cell.nodeId, cell.type);
  const updated = {
    ...deployedCells,
    [cellId]: { ...cell, phase: 'returning', returnTick: tick + transitTicks },
  };
  return { success: true, newDeployedCells: updated, immediate: false };
}

// ── Tick advance ──────────────────────────────────────────────────────────────

// Returns { updatedCells, events }
// events: [{ type: 'scout_arrived'|'cell_arrived'|'cell_returned', cellId, nodeId, cellType }]
export function advanceCells(deployedCells, tick) {
  const updated = {};
  const events = [];

  for (const [cellId, cell] of Object.entries(deployedCells)) {
    let c = { ...cell };

    // Outbound → arrived/returning
    if (c.phase === 'outbound' && tick >= c.arrivalTick) {
      if (c.type === CELL_TYPES.DENDRITIC) {
        // Scout arrives → immediately start returning
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

    // Patrol movement — neutrophils circuit through connected nodes
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

    // Returning → remove
    if (c.phase === 'returning' && c.returnTick != null && tick >= c.returnTick) {
      events.push({ type: 'cell_returned', cellId, nodeId: c.nodeId, cellType: c.type });
      continue; // remove from updated
    }

    updated[cellId] = c;
  }

  return { updatedCells: updated, events };
}

// Auto-return attack cells when pathogen is cleared at their node.
// Returns updated deployedCells with those cells set to 'returning'.
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

// Check perceivedState for scout confirmation (more reliable than checking deployedCells)
export function hasDendriticConfirmation(nodeId, perceivedState) {
  return perceivedState?.nodes?.[nodeId]?.scoutConfirmed ?? false;
}

// Which nodes currently have patrol/macrophage coverage?
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

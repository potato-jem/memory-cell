// Cell manufacturing + deployment — pure functions.
//
// Lifecycle:  training → ready → outbound → arrived → returning → ready  (loops)
//
// Path-based movement: cells store path[], pathIndex, destNodeId.
// nodeId = path[pathIndex] = current intermediate position.
// Movement budget = 1 per turn; exit cost = signalTravelCost of node being left.
// 0-cost nodes (BLOOD/HQ) allow free passage to the next hop in the same turn.
//
// Tokens are held by every cell in the roster regardless of phase.
// Tokens are freed only when a cell is explicitly decommissioned.
//
// All functions accept an optional `modifiers` (runModifiers) parameter.
// When null/undefined, base config values are used (fully backward compatible).

import { NODES, NODE_IDS, HQ_NODE_ID, computePathWithModifiers, computeVisibility } from '../data/nodes.js';
import { nodeHasActivePathogen } from '../data/pathogens.js';
import { PATROL_DWELL_TICKS, SCOUT_DWELL_TICKS } from '../data/gameConfig.js';
import {
  CELL_CONFIG,
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

// Returns initial specialization scores for cells that support it, null otherwise.
function initSpecialization(type) {
  const cfg = CELL_CONFIG[type];
  if (!cfg?.specializationSlots) return null;
  return Object.fromEntries(Object.keys(cfg.clearablePathogens).map(k => [k, 1.0]));
}

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
    stationaryTurns: 0,
    specialization: initSpecialization(type),
  };
}

// ── Manufacturing ─────────────────────────────────────────────────────────────

export function trainCell(type, deployedCells, tokenCapacity, tick, modifiers = null) {
  const cost = getEffectiveDeployCost(type, modifiers);
  const available = getTokensAvailable(deployedCells, tokenCapacity, modifiers);
  if (available < cost) {
    return { success: false, error: `Need ${cost} tokens (have ${available})` };
  }
  const trainingTime = getEffectiveTrainingTicks(type, modifiers);
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
    stationaryTurns: 0,
    specialization: initSpecialization(type),
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

  if (CELL_CONFIG[cell.type]?.requiresClassified && !nodeHasClassifiedPathogen(nodeId, nodeStates)) {
    return { success: false, error: `${CELL_CONFIG[cell.type].displayName} requires a classified pathogen at target`, requiresClassified: true };
  }

  const fromNodeId = (cell.phase === 'arrived' || cell.phase === 'returning')
    ? cell.nodeId
    : HQ_NODE_ID;

  const path = computePathWithModifiers(fromNodeId, nodeId, modifiers);
  const extra = _deployExtra(cell.type);

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

// Extra fields set on the cell state at deploy time (type-specific runtime state only).
// Effectiveness is now computed dynamically per pathogen instance — not stored on cell.
function _deployExtra(type) {
  if (CELL_CONFIG[type]?.isRecon) {
    return { isPatrolling: false, patrolDestNodeId: null, patrolNextMoveTick: null };
  }
  return {};
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

  // Lifetime cells cannot return — recalling them kills them immediately.
  if (CELL_CONFIG[cell.type]?.cellLifetime != null) {
    const { [cellId]: _dead, ...rest } = deployedCells;
    return { success: true, newDeployedCells: rest, died: true };
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
          isPatrolling: false,
          patrolDestNodeId: null,
          patrolNextMoveTick: null,
          stationaryTurns: 0,
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
        isPatrolling: false,
        patrolDestNodeId: null,
        patrolNextMoveTick: null,
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

    // ── Lifetime expiry ───────────────────────────────────────────────────────
    const lifetime = CELL_CONFIG[c.type]?.cellLifetime;
    if (lifetime != null && c.deployedAtTick != null && tick >= c.deployedAtTick + lifetime) {
      events.push({ type: 'cell_died', cellId, nodeId: c.nodeId, cellType: c.type });
      continue; // omit from updated — cell is removed from roster
    }

    // ── Training → ready ──────────────────────────────────────────────────────
    if (c.phase === 'training' && tick >= c.trainingCompleteTick) {
      c.phase = 'ready';
      c.nodeId = null;
      events.push({ type: 'cell_ready', cellId, cellType: c.type });
    }

    // ── Outbound movement (path-based) ────────────────────────────────────────
    if (c.phase === 'outbound' && c.path) {
      // Move along path (only if not already at destination)
      if (c.pathIndex < c.path.length - 1) {
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
      }

      // Arrival check — evaluated separately so zero-distance paths (e.g. deploy to BLOOD)
      // also transition to 'arrived' immediately on the same tick.
      if (c.pathIndex >= c.path.length - 1) {
        c.phase = 'arrived';
        if (CELL_CONFIG[c.type]?.isScout) {
          c.scoutDwellUntilTick = tick + SCOUT_DWELL_TICKS;
          events.push({ type: 'scout_arrived', cellId, nodeId: c.nodeId });
        } else {
          if (c.isPatrolling) {
            c.patrolNextMoveTick = tick + PATROL_DWELL_TICKS;
          }
          events.push({ type: 'cell_arrived', cellId, nodeId: c.nodeId, cellType: c.type });
        }
      }
    }

    // ── Scout dwell complete → start return journey ───────────────────────────
    if (CELL_CONFIG[c.type]?.isScout && c.phase === 'arrived' &&
        c.scoutDwellUntilTick != null && tick >= c.scoutDwellUntilTick) {
      const returnPath = computePathWithModifiers(c.nodeId, HQ_NODE_ID, modifiers);
      c.phase = 'returning';
      c.path = returnPath;
      c.pathIndex = 0;
      c.destNodeId = HQ_NODE_ID;
      c.scoutDwellUntilTick = null;
    }

    // ── Patrol movement (destination-based) ──────────────────────────────────
    if (c.isPatrolling && c.phase === 'arrived') {
      if (c.patrolDestNodeId && c.nodeId !== c.patrolDestNodeId) {
        // Traveling toward destination — move one hop per dwell cycle
        if (c.patrolNextMoveTick != null && tick >= c.patrolNextMoveTick) {
          const path = computePathWithModifiers(c.nodeId, c.patrolDestNodeId, modifiers);
          if (path.length > 1) {
            c.nodeId = path[1];
            c.patrolNextMoveTick = tick + PATROL_DWELL_TICKS;
            nodesVisited.push({ cellId, cellType: c.type, nodeId: c.nodeId });
          }
        }
      } else if (c.patrolDestNodeId && c.nodeId === c.patrolDestNodeId) {
        // Arrived at destination — dwell, then clear dest to trigger reassignment
        if (c.patrolNextMoveTick != null && tick >= c.patrolNextMoveTick) {
          c.patrolDestNodeId = null;
        }
      }
      // patrolDestNodeId === null: waiting for assignPatrolDestinations
    }

    // ── Returning movement (path-based) ───────────────────────────────────────
    if (c.phase === 'returning' && c.path) {
      // Move along path (only if not already at HQ)
      if (c.pathIndex < c.path.length - 1) {
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
      }

      // Arrival at HQ — evaluated separately so zero-distance returns also complete.
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
        c.isPatrolling = false;
        c.patrolDestNodeId = null;
        c.patrolNextMoveTick = null;
        c.stationaryTurns = 0;
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
      c.stationaryTurns = 0;
    }

    // Stationary bonus tracker: increment while stationed, reset when moving.
    if (CELL_CONFIG[c.type]?.stationaryBonus) {
      if (c.phase === 'arrived') {
        c.stationaryTurns = (c.stationaryTurns ?? 0) + 1;
      } else {
        c.stationaryTurns = 0;
      }
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
    if (CELL_CONFIG[cell.type]?.cellLifetime != null) continue; // lifetime cells fight to the end
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
 * Used by cells with requiresClassified=true (Killer T) to gate deployment.
 */
export function nodeHasClassifiedPathogen(nodeId, nodeStates) {
  const ns = nodeStates?.[nodeId];
  return ns?.pathogens?.some(i => i.detected_level === 'classified') ?? false;
}

/**
 * Assign patrol destinations after each turn.
 *
 * Priority:
 *   1. Nodes not currently visible, ordered by turnsSinceLastVisible descending.
 *      Closest available patrol is assigned to each (by hop count).
 *   2. Remaining patrols get a weighted-random node from the unassigned pool,
 *      using NODES[id].patrolDestinationWeight.
 *
 * Only patrols with phase === 'arrived' and patrolDestNodeId === null are considered.
 * patrolNextMoveTick is set to tick so movement begins on the next turn.
 */
export function assignPatrolDestinations(deployedCells, nodeStates, tick, modifiers = null) {
  const needsAssignment = Object.values(deployedCells).filter(
    c => c.isPatrolling && c.phase === 'arrived' && !c.patrolDestNodeId
  );
  if (needsAssignment.length === 0) return deployedCells;

  const visible = computeVisibility(deployedCells);

  // Nodes already targeted by patrols that are en-route (don't double-assign)
  const alreadyTargeted = new Set(
    Object.values(deployedCells)
      .filter(c => c.isPatrolling && c.patrolDestNodeId)
      .map(c => c.patrolDestNodeId)
  );

  // Sort unseen, un-targeted nodes by turnsSinceLastVisible descending
  const unseen = NODE_IDS
    .filter(id => !visible.has(id) && !alreadyTargeted.has(id))
    .sort((a, b) => (nodeStates[b]?.turnsSinceLastVisible ?? 0) - (nodeStates[a]?.turnsSinceLastVisible ?? 0));

  const updated = { ...deployedCells };
  const assignedNodes = new Set(alreadyTargeted); // seed with already-targeted nodes
  let remaining = [...needsAssignment];

  // Phase 1: assign closest patrol to each unseen node in priority order
  for (const targetId of unseen) {
    if (remaining.length === 0) break;

    let closestIdx = 0;
    let closestHops = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const path = computePathWithModifiers(remaining[i].nodeId, targetId, modifiers);
      if (path.length - 1 < closestHops) {
        closestHops = path.length - 1;
        closestIdx = i;
      }
    }

    const patrol = remaining[closestIdx];
    updated[patrol.id] = { ...patrol, patrolDestNodeId: targetId, patrolNextMoveTick: tick };
    assignedNodes.add(targetId);
    remaining.splice(closestIdx, 1);
  }

  // Phase 2: weighted-random destination for any unassigned patrols
  if (remaining.length > 0) {
    const eligibleIds = NODE_IDS.filter(id => !assignedNodes.has(id));
    const weights = eligibleIds.map(id => NODES[id].patrolDestinationWeight ?? 0);
    const totalWeight = weights.reduce((s, w) => s + w, 0);

    for (const patrol of remaining) {
      if (totalWeight <= 0) break;
      let rand = Math.random() * totalWeight;
      let chosen = eligibleIds[eligibleIds.length - 1];
      for (let i = 0; i < eligibleIds.length; i++) {
        rand -= weights[i];
        if (rand <= 0) { chosen = eligibleIds[i]; break; }
      }
      updated[patrol.id] = { ...patrol, patrolDestNodeId: chosen, patrolNextMoveTick: tick };
    }
  }

  return updated;
}

/**
 * Start a patrol for a recon cell. Picks the first destination using the same
 * priority logic as assignPatrolDestinations and sends the cell outbound.
 * Called immediately when the player taps Patrol.
 */
export function startPatrol(cellId, deployedCells, nodeStates, tick, modifiers = null) {
  const cell = deployedCells[cellId];
  if (!cell) return { success: false, error: 'Cell not found' };
  if (!CELL_CONFIG[cell.type]?.isRecon) return { success: false, error: 'Not a recon cell' };
  if (cell.phase !== 'ready') return { success: false, error: 'Cell is not ready' };

  // Temporarily mark the cell as arrived at HQ so assignPatrolDestinations can pick a destination
  const tempCells = {
    ...deployedCells,
    [cellId]: {
      ...cell,
      phase: 'arrived',
      nodeId: HQ_NODE_ID,
      isPatrolling: true,
      patrolDestNodeId: null,
      patrolNextMoveTick: null,
    },
  };
  const assigned = assignPatrolDestinations(tempCells, nodeStates, tick, modifiers);
  const destNodeId = assigned[cellId]?.patrolDestNodeId ?? null;

  if (!destNodeId || destNodeId === HQ_NODE_ID) {
    // No useful destination — stay at HQ as arrived, patrol will pick up next turn
    return {
      success: true,
      newDeployedCells: {
        ...deployedCells,
        [cellId]: {
          ...cell,
          phase: 'arrived',
          nodeId: HQ_NODE_ID,
          deployedAtTick: tick,
          arrivalTick: tick,
          isPatrolling: true,
          patrolDestNodeId: null,
          patrolNextMoveTick: tick,
        },
      },
    };
  }

  const path = computePathWithModifiers(HQ_NODE_ID, destNodeId, modifiers);
  return {
    success: true,
    newDeployedCells: {
      ...deployedCells,
      [cellId]: {
        ...cell,
        nodeId: HQ_NODE_ID,
        phase: 'outbound',
        path,
        pathIndex: 0,
        destNodeId,
        deployedAtTick: tick,
        arrivalTick: null,
        returnTick: null,
        scoutDwellUntilTick: null,
        isPatrolling: true,
        patrolDestNodeId: destNodeId,
        patrolNextMoveTick: null,
      },
    },
  };
}

/**
 * Update per-cell specialization scores based on what pathogens were present after this turn's clearance.
 * Called after advanceGroundTruth so the bonus takes effect on subsequent turns.
 * Config-driven: any cell type with `specializationSlots` in CELL_CONFIG participates.
 */
export function updateCellSpecializations(cells, nodeStates) {
  let changed = false;
  const updated = {};
  for (const [id, cell] of Object.entries(cells)) {
    const cfg = CELL_CONFIG[cell.type];
    if (!cfg?.specializationSlots || !cell.specialization || cell.phase !== 'arrived' || !cell.nodeId) {
      updated[id] = cell;
      continue;
    }

    const presentTypes = new Set(
      (nodeStates[cell.nodeId]?.pathogens ?? [])
        .filter(p => p.actualLoad > 0)
        .map(p => p.type)
    );

    const { specializationSlots, specializationGainPerTurn, specializationDecayPerTurn,
            specializationMax, specializationMin } = cfg;

    const spec = { ...cell.specialization };

    // Top-N types by current score (before this turn's update, for stability)
    const sorted = Object.entries(spec).sort(([, a], [, b]) => b - a);
    const topTypes = new Set(sorted.slice(0, specializationSlots).map(([t]) => t));

    for (const pathogenType of Object.keys(spec)) {
      if (presentTypes.has(pathogenType) && topTypes.has(pathogenType)) {
        // Actively fighting a top-slot type — gain specialization
        spec[pathogenType] = Math.min(specializationMax, spec[pathogenType] + specializationGainPerTurn);
      } else if (!topTypes.has(pathogenType)) {
        // Not a top-slot type — decay (whether present or absent)
        spec[pathogenType] = Math.max(specializationMin, spec[pathogenType] - specializationDecayPerTurn);
      }
      // Present but not in top slots: no change (avoids penalising multi-infection encounters)
    }

    updated[id] = { ...cell, specialization: spec };
    changed = true;
  }
  return changed ? updated : cells;
}

/**
 * Approximate total clearance power at a node — for display/informational use.
 * Assumes 'classified' level (maximum effectiveness) per cell.
 * For actual per-pathogen clearance, see pathogen.js getClearancePower.
 */
export function getClearancePower(nodeId, deployedCells, modifiers = null) {
  let total = 0;
  for (const cell of Object.values(deployedCells)) {
    if (cell.phase !== 'arrived' || cell.nodeId !== nodeId) continue;
    const effectiveRate = getEffectiveClearanceRate(cell.type, modifiers);
    if (effectiveRate === 0) continue;
    const effectiveness = getEffectiveEffectiveness(cell.type, 'classified', modifiers);
    total += effectiveRate * effectiveness;
  }
  return total;
}

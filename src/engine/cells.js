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

import { NODES, NODE_IDS, HQ_NODE_ID, computePathWithModifiers } from '../data/nodes.js';
import { nodeHasActivePathogen } from '../data/pathogens.js';
import { PATROL_DWELL_TICKS } from '../data/gameConfig.js';
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
    autoReturn: true,
  };
}

// ── Manufacturing ─────────────────────────────────────────────────────────────

export function trainCell(type, deployedCells, tokenCapacity, tick, modifiers = null, autoReturn = true) {
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
    autoReturn,
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

  const fromNodeId = (cell.phase === 'arrived' || cell.phase === 'returning' || cell.phase === 'outbound')
    ? cell.nodeId
    : HQ_NODE_ID;

  // If already at the destination, arrive immediately (handles cancel-by-reclick).
  if (fromNodeId === nodeId) {
    const extra = _deployExtra(cell.type);
    return {
      success: true,
      newDeployedCells: {
        ...deployedCells,
        [cellId]: {
          ...cell,
          nodeId,
          phase: 'arrived',
          path: null,
          pathIndex: 0,
          destNodeId: null,
          deployedAtTick: tick,
          arrivalTick: tick,
          returnTick: null,
          ...extra,
        },
      },
    };
  }

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
          ...extra,
      },
    },
  };
}

// Extra fields set on the cell state at deploy time (type-specific runtime state only).
// Effectiveness is now computed dynamically per pathogen instance — not stored on cell.
function _deployExtra(type) {
  const cfg = CELL_CONFIG[type];
  if (cfg?.isDetector || cfg?.isClassifier) {
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
    // If moving from a body node (not HQ), restore the cell there as 'arrived'.
    // If moving from HQ, restore to 'ready' at HQ (no nodeId).
    const originIsBodyNode = cell.nodeId && cell.nodeId !== HQ_NODE_ID;
    return {
      success: true,
      newDeployedCells: {
        ...deployedCells,
        [cellId]: {
          ...cell,
          phase: originIsBodyNode ? 'arrived' : 'ready',
          nodeId: originIsBodyNode ? cell.nodeId : null,
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
// nodeStates (optional): used by patrol to check if a node is clear before pressing on.

export function advanceCells(deployedCells, tick, modifiers = null, nodeStates = null) {
  const updated = {};
  const events = [];
  const nodesVisited = [];

  for (const [cellId, cell] of Object.entries(deployedCells)) {
    let c = { ...cell };

    // ── Lifetime expiry ───────────────────────────────────────────────────────
    const lifetime = CELL_CONFIG[c.type]?.cellLifetime;
    // Lifetime expiry is now handled by expireLifetimeCells(), called after ground truth
    // so that cells clear on the turn they expire before being removed.

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
        c.stationaryTurns = 0;  // always reset on arrival — stationary bonus counts from this node
        if (c.isPatrolling) {
          c.patrolNextMoveTick = tick + PATROL_DWELL_TICKS;
        }
        events.push({ type: 'cell_arrived', cellId, nodeId: c.nodeId, cellType: c.type });
      }
    }

    // ── Patrol movement (destination-based) ──────────────────────────────────
    if (c.isPatrolling && c.phase === 'arrived') {
      // "Clear" means no undetected (none-level) pathogens remain — the patrol has fired its
      // detection roll here. Does NOT wait for pathogens to be eliminated — that's attack cells.
      const hasUndetected = nodeStates
        ? (nodeStates[c.nodeId]?.pathogens?.some(p => p.detected_level === 'none') ?? false)
        : false;
      const currentNodeClear = !hasUndetected;

      if (c.patrolDestNodeId && c.nodeId !== c.patrolDestNodeId) {
        // Traveling toward destination — only move when current node is detection-clear
        if (currentNodeClear && c.patrolNextMoveTick != null && tick >= c.patrolNextMoveTick) {
          const path = computePathWithModifiers(c.nodeId, c.patrolDestNodeId, modifiers);
          if (path.length > 1) {
            c.nodeId = path[1];
            c.patrolNextMoveTick = tick + PATROL_DWELL_TICKS;
            nodesVisited.push({ cellId, cellType: c.type, nodeId: c.nodeId });
          }
        }
        // If not clear: stay put — patrol waits for the node to be clear before pressing on
      } else if (c.patrolDestNodeId && c.nodeId === c.patrolDestNodeId) {
        // Arrived at destination — clear dest once node is clear, triggering reassignment
        if (currentNodeClear) {
          c.patrolDestNodeId = null;
        }
      } else if (!c.patrolDestNodeId && c.nodeId !== HQ_NODE_ID) {
        // No destination assigned and not at HQ — drift one hop toward HQ.
        // patrolDestNodeId stays null so assignPatrolDestinations can reassign any turn.
        if (currentNodeClear && c.patrolNextMoveTick != null && tick >= c.patrolNextMoveTick) {
          const pathToHQ = computePathWithModifiers(c.nodeId, HQ_NODE_ID, modifiers);
          if (pathToHQ.length > 1) {
            c.nodeId = pathToHQ[1];
            c.patrolNextMoveTick = tick + PATROL_DWELL_TICKS;
            nodesVisited.push({ cellId, cellType: c.type, nodeId: c.nodeId });
          }
        }
      }
      // no destination + at HQ: sit and wait for assignPatrolDestinations
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

    updated[cellId] = c;
  }

  return { updatedCells: updated, events, nodesVisited };
}

// Increment stationaryTurns AFTER clearance so the bonus applies starting the NEXT turn.
// Resets to 0 when not arrived (in transit, returning, etc.).
export function incrementStationaryTurns(deployedCells) {
  const updated = {};
  for (const [id, cell] of Object.entries(deployedCells)) {
    if (!CELL_CONFIG[cell.type]?.stationaryBonus) { updated[id] = cell; continue; }
    if (cell.phase === 'arrived') {
      updated[id] = { ...cell, stationaryTurns: (cell.stationaryTurns ?? 0) + 1 };
    } else {
      updated[id] = cell.stationaryTurns !== 0 ? { ...cell, stationaryTurns: 0 } : cell;
    }
  }
  return updated;
}

// Remove cells whose lifetime has expired. Called AFTER advanceGroundTruth so cells
// contribute clearance on the turn they die rather than being removed beforehand.
export function expireLifetimeCells(deployedCells, tick) {
  const updated = {};
  const events = [];
  for (const [cellId, cell] of Object.entries(deployedCells)) {
    const lifetime = CELL_CONFIG[cell.type]?.cellLifetime;
    if (lifetime != null && cell.deployedAtTick != null && tick >= cell.deployedAtTick + lifetime) {
      events.push({ type: 'cell_died', cellId, cellType: cell.type, nodeId: cell.nodeId });
    } else {
      updated[cellId] = cell;
    }
  }
  return { updatedCells: updated, events };
}

// Auto-return cells when their work at the current node is done.
// Attack cells return when no active pathogens remain.
// Recon (detector/classifier) cells return when the node is fully classified (no none/unknown).
// Macrophage has autoReturn: false and is skipped.
export function startReturnForClearedNodes(deployedCells, nodeStates, tick, modifiers = null) {
  const updated = { ...deployedCells };
  for (const [cellId, cell] of Object.entries(updated)) {
    const cfg = CELL_CONFIG[cell.type];
    if (!cfg?.autoReturn) continue;
    if (cell.autoReturn === false) continue; // player disabled auto-return for this cell
    if (cell.phase !== 'arrived') continue;
    if (cell.isPatrolling) continue; // patrolling cells manage their own movement
    if (cfg.cellLifetime != null) continue; // lifetime cells fight to the end

    const ns = nodeStates[cell.nodeId];
    let shouldReturn = false;

    if (cfg.isAttack) {
      shouldReturn = !nodeHasActivePathogen(ns);
    } else if (cfg.isDetector || cfg.isClassifier) {
      // Return when no unresolved pathogens remain (all classified or node empty)
      const hasUnresolved = ns?.pathogens?.some(
        p => p.detected_level === 'none' || p.detected_level === 'unknown'
      ) ?? false;
      shouldReturn = !hasUnresolved;
    }

    if (shouldReturn) {
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
 * Algorithm (node-first):
 * 1. Get the node with the longest time since last clear detection roll.
 * 2. Find the nearest available patrol.
 * 3. Assign it; mark every node on the path as covered (they'll be visited en route).
 * 4. Repeat for the next stalest uncovered node until patrols or nodes are exhausted.
 * 5. Leftover patrols (nothing left to visit) return to HQ and stop patrolling.
 *
 * Only patrols with phase === 'arrived' and patrolDestNodeId === null need assignment.
 */
export function assignPatrolDestinations(deployedCells, nodeStates, tick, modifiers = null) {
  const needsAssignment = Object.values(deployedCells).filter(
    c => c.isPatrolling && c.phase === 'arrived' && !c.patrolDestNodeId
  );
  if (needsAssignment.length === 0) return deployedCells;

  // Seed covered set with every node already on an active patrol's path
  const coveredNodes = new Set();
  for (const c of Object.values(deployedCells)) {
    if (!c.isPatrolling || !c.patrolDestNodeId) continue;
    const path = computePathWithModifiers(c.nodeId ?? HQ_NODE_ID, c.patrolDestNodeId, modifiers);
    for (const id of path) coveredNodes.add(id);
  }

  // Sort uncovered nodes: stalest first; ties broken by patrolDestinationWeight (end-of-line nodes first)
  const priorityNodes = NODE_IDS
    .filter(id => !coveredNodes.has(id))
    .sort((a, b) => {
      const staleDiff = (nodeStates[b]?.turnsSinceLastClear ?? 0) - (nodeStates[a]?.turnsSinceLastClear ?? 0);
      if (staleDiff !== 0) return staleDiff;
      return (NODES[b].patrolDestinationWeight ?? 0) - (NODES[a].patrolDestinationWeight ?? 0);
    });

  const updated = { ...deployedCells };
  let remaining = [...needsAssignment];

  for (const targetId of priorityNodes) {
    if (remaining.length === 0) break;

    // Nearest available patrol to this target
    let nearestIdx = 0;
    let nearestHops = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const path = computePathWithModifiers(remaining[i].nodeId ?? HQ_NODE_ID, targetId, modifiers);
      if (path.length - 1 < nearestHops) {
        nearestHops = path.length - 1;
        nearestIdx = i;
      }
    }

    const patrol = remaining[nearestIdx];
    const path = computePathWithModifiers(patrol.nodeId ?? HQ_NODE_ID, targetId, modifiers);

    // Cover all nodes on this path so they aren't double-assigned
    for (const id of path) coveredNodes.add(id);

    updated[patrol.id] = { ...patrol, patrolDestNodeId: targetId, patrolNextMoveTick: tick };
    remaining.splice(nearestIdx, 1);
  }

  // Leftover patrols: no destination committed — drift toward HQ one hop at a time.
  // patrolDestNodeId stays null so next turn's assignment can claim them for a real target.
  for (const patrol of remaining) {
    updated[patrol.id] = { ...patrol, patrolNextMoveTick: tick };
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
  const cfg = CELL_CONFIG[cell.type];
  if (!cfg?.isDetector && !cfg?.isClassifier) return { success: false, error: 'Not a recon cell' };
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
        isPatrolling: true,
        patrolDestNodeId: destNodeId,
        patrolNextMoveTick: null,
      },
    },
  };
}

/**
 * Update global per-type specialization scores based on what pathogens were present after clearance.
 * Called after advanceGroundTruth so the bonus takes effect on subsequent turns.
 * Config-driven: any cell type with `specializationSlots` in CELL_CONFIG participates.
 *
 * Specialization is now global per cell type (stored in cellTypeState), not per individual cell.
 * All cells of a given type share the same specialization scores — they develop memory together.
 *
 * @param {Object} cells        — deployed cells (used to find which nodes each type is stationed at)
 * @param {Object} nodeStates   — ground truth node states after clearance
 * @param {Object} cellTypeState — current cellTypeState (from game state)
 * @returns {Object} updated cellTypeState
 */
export function updateCellSpecializations(cells, nodeStates, cellTypeState) {
  let newCellTypeState = cellTypeState;

  for (const [cellType, cfg] of Object.entries(CELL_CONFIG)) {
    if (!cfg.specializationSlots) continue;
    const typeState = cellTypeState?.[cellType];
    if (!typeState?.specialization) continue;

    // Collect all pathogen types present at nodes where this cell type is stationed
    const presentTypes = new Set();
    for (const cell of Object.values(cells)) {
      if (cell.type !== cellType || cell.phase !== 'arrived' || !cell.nodeId) continue;
      for (const p of (nodeStates[cell.nodeId]?.pathogens ?? [])) {
        if (p.actualLoad > 0) presentTypes.add(p.type);
      }
    }

    // No stationed cells of this type — nothing to update
    const hasStationedCells = Object.values(cells).some(
      c => c.type === cellType && c.phase === 'arrived' && c.nodeId
    );
    if (!hasStationedCells) continue;

    const { specializationSlots, specializationGainPerTurn, specializationDecayPerTurn,
            specializationMax, specializationMin } = cfg;

    const spec = { ...typeState.specialization };

    // Top-N types by current score (before this turn's update, for stability)
    const sorted = Object.entries(spec).sort(([, a], [, b]) => b - a);
    const topTypes = new Set(sorted.slice(0, specializationSlots).map(([t]) => t));

    let changed = false;
    for (const pathogenType of Object.keys(spec)) {
      const prev = spec[pathogenType];
      if (presentTypes.has(pathogenType) && topTypes.has(pathogenType)) {
        spec[pathogenType] = Math.min(specializationMax, prev + specializationGainPerTurn);
      } else if (!topTypes.has(pathogenType)) {
        spec[pathogenType] = Math.max(specializationMin, prev - specializationDecayPerTurn);
      }
      if (spec[pathogenType] !== prev) changed = true;
    }

    if (changed) {
      newCellTypeState = {
        ...newCellTypeState,
        [cellType]: { ...typeState, specialization: spec },
      };
    }
  }

  return newCellTypeState;
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

// Cell deployment mechanics — pure functions.
// Handles deployment validation, transit timing, effectiveness, patrol coverage.

import { NODES } from '../data/nodes.js';

export const CELL_TYPES = {
  DENDRITIC: 'dendritic',
  NEUTROPHIL: 'neutrophil',
  RESPONDER: 'responder',
};

export const DEPLOY_COSTS = {
  [CELL_TYPES.DENDRITIC]: 2,
  [CELL_TYPES.NEUTROPHIL]: 1,
  [CELL_TYPES.RESPONDER]: 3,
};

// Dendritic cells take 2 turns in transit + 1 turn to sample = returns 3 turns later
const DENDRITIC_TRANSIT_TURNS = 3;

let _cellIdCounter = 1;
function nextCellId() {
  return `cell_${_cellIdCounter++}`;
}

/**
 * Deploy a dendritic cell to a node.
 * Returns { success, newDeployedCells, cost, error }
 */
export function deployDendriticCell(nodeId, deployedCells, attentionTokens, turn) {
  const cost = DEPLOY_COSTS[CELL_TYPES.DENDRITIC];

  if (attentionTokens < cost) {
    return { success: false, error: `Insufficient tokens (need ${cost}, have ${attentionTokens})` };
  }

  const node = NODES[nodeId];
  if (!node) {
    return { success: false, error: `Unknown node: ${nodeId}` };
  }

  const cellId = nextCellId();
  const cell = {
    id: cellId,
    type: CELL_TYPES.DENDRITIC,
    nodeId,
    inTransit: true,
    deployedOnTurn: turn,
    returnsOnTurn: turn + DENDRITIC_TRANSIT_TURNS,
    hasScouted: false,
  };

  return {
    success: true,
    newDeployedCells: { ...deployedCells, [cellId]: cell },
    cost,
  };
}

/**
 * Deploy a neutrophil patrol to a node.
 * Returns { success, newDeployedCells, cost, error }
 */
export function deployNeutrophilPatrol(nodeId, deployedCells, attentionTokens, turn) {
  const cost = DEPLOY_COSTS[CELL_TYPES.NEUTROPHIL];

  if (attentionTokens < cost) {
    return { success: false, error: `Insufficient tokens (need ${cost}, have ${attentionTokens})` };
  }

  const node = NODES[nodeId];
  if (!node) {
    return { success: false, error: `Unknown node: ${nodeId}` };
  }

  const cellId = nextCellId();
  const cell = {
    id: cellId,
    type: CELL_TYPES.NEUTROPHIL,
    nodeId,
    inTransit: false,  // Neutrophils arrive immediately
    deployedOnTurn: turn,
    isPatrolling: true,
  };

  return {
    success: true,
    newDeployedCells: { ...deployedCells, [cellId]: cell },
    cost,
  };
}

/**
 * Deploy a responder to a node.
 * Responder effectiveness depends on whether a dendritic cell has scouted the node.
 * Returns { success, newDeployedCells, cost, error, effectiveness }
 */
export function deployResponder(nodeId, deployedCells, attentionTokens, turn, hasDendriticConfirmation) {
  const cost = DEPLOY_COSTS[CELL_TYPES.RESPONDER];

  if (attentionTokens < cost) {
    return { success: false, error: `Insufficient tokens (need ${cost}, have ${attentionTokens})` };
  }

  const node = NODES[nodeId];
  if (!node) {
    return { success: false, error: `Unknown node: ${nodeId}` };
  }

  // Effectiveness is reduced without prior dendritic confirmation
  const effectiveness = hasDendriticConfirmation ? 1.0 : 0.6;

  const cellId = nextCellId();
  const cell = {
    id: cellId,
    type: CELL_TYPES.RESPONDER,
    nodeId,
    inTransit: false,
    deployedOnTurn: turn,
    effectiveness,
    hasDendriticBacking: hasDendriticConfirmation,
  };

  return {
    success: true,
    newDeployedCells: { ...deployedCells, [cellId]: cell },
    cost,
    effectiveness,
  };
}

/**
 * Recall a unit — free action, removes cell from deployment.
 */
export function recallUnit(cellId, deployedCells) {
  if (!deployedCells[cellId]) {
    return { success: false, error: `Cell ${cellId} not found` };
  }

  const { [cellId]: removed, ...rest } = deployedCells;
  return { success: true, newDeployedCells: rest };
}

/**
 * Advance all deployed cells by one turn.
 * Returns updated deployedCells.
 */
export function advanceCells(deployedCells, turn) {
  const updated = {};

  for (const [cellId, cell] of Object.entries(deployedCells)) {
    if (cell.type === CELL_TYPES.DENDRITIC) {
      // Dendritic cells complete transit when returnsOnTurn matches
      const arrived = cell.returnsOnTurn <= turn && cell.inTransit;
      updated[cellId] = {
        ...cell,
        inTransit: arrived ? false : cell.inTransit,
        hasScouted: arrived ? true : cell.hasScouted,
      };
    } else {
      updated[cellId] = cell;
    }
  }

  return updated;
}

/**
 * Check if a node has dendritic confirmation (a dendritic cell has returned from it).
 */
export function hasDendriticConfirmation(nodeId, deployedCells) {
  return Object.values(deployedCells).some(
    cell => cell.type === CELL_TYPES.DENDRITIC && cell.nodeId === nodeId && cell.hasScouted
  );
}

/**
 * Get patrol coverage — which nodes have neutrophils.
 */
export function getPatrolCoverage(deployedCells) {
  const coverage = {};
  for (const cell of Object.values(deployedCells)) {
    if (cell.type === CELL_TYPES.NEUTROPHIL && cell.isPatrolling) {
      coverage[cell.nodeId] = true;
    }
  }
  return coverage;
}

/**
 * Get a summary of all deployed cells for UI display.
 */
export function getDeploymentSummary(deployedCells) {
  return Object.values(deployedCells).map(cell => ({
    id: cell.id,
    type: cell.type,
    nodeId: cell.nodeId,
    inTransit: cell.inTransit ?? false,
    returnsOnTurn: cell.returnsOnTurn ?? null,
    effectiveness: cell.effectiveness ?? null,
    hasDendriticBacking: cell.hasDendriticBacking ?? null,
  }));
}

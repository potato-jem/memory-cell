// Cell deployment mechanics — pure functions.
// Layer 2: adds Killer T-Cell, B-Cell, NK Cell, Macrophage.

import { NODES } from '../data/nodes.js';

export const CELL_TYPES = {
  DENDRITIC: 'dendritic',
  NEUTROPHIL: 'neutrophil',
  RESPONDER: 'responder',         // Layer 1 generic responder (kept for compat)
  KILLER_T: 'killer_t',
  B_CELL: 'b_cell',
  NK_CELL: 'nk_cell',
  MACROPHAGE: 'macrophage',
};

export const DEPLOY_COSTS = {
  [CELL_TYPES.DENDRITIC]: 2,
  [CELL_TYPES.NEUTROPHIL]: 1,
  [CELL_TYPES.RESPONDER]: 3,
  [CELL_TYPES.KILLER_T]: 4,      // expensive — requires dendritic confirmation
  [CELL_TYPES.B_CELL]: 2,        // cheaper, slower, safer
  [CELL_TYPES.NK_CELL]: 3,       // no confirmation needed — calculated risk
  [CELL_TYPES.MACROPHAGE]: 1,    // ambient sensing + cleanup
};

// Clearance rates per responder type (strength removed per active turn)
export const CLEARANCE_RATES = {
  [CELL_TYPES.RESPONDER]: 12,
  [CELL_TYPES.KILLER_T]: 20,     // high clearance, high autoimmune risk if misapplied
  [CELL_TYPES.B_CELL]: 8,        // tags threats for other cells; safer but slower
  [CELL_TYPES.NK_CELL]: 15,      // no confirmation; can hit stressed healthy tissue
  [CELL_TYPES.MACROPHAGE]: 4,    // ambient; continuous light clearance + sensing
};

// Autoimmune risk per type when deployed to clean node
export const AUTOIMMUNE_RISK = {
  [CELL_TYPES.RESPONDER]: 0.3,
  [CELL_TYPES.KILLER_T]: 0.6,    // highest risk — T-cells attacking self is a crisis
  [CELL_TYPES.B_CELL]: 0.1,
  [CELL_TYPES.NK_CELL]: 0.3,
  [CELL_TYPES.MACROPHAGE]: 0.0,
};

const DENDRITIC_TRANSIT_TURNS = 3;

let _cellIdCounter = 1;
function nextCellId() {
  return `cell_${_cellIdCounter++}`;
}

// ── Deploy functions ──────────────────────────────────────────────────────────

export function deployDendriticCell(nodeId, deployedCells, attentionTokens, turn) {
  return deployCell(CELL_TYPES.DENDRITIC, nodeId, deployedCells, attentionTokens, turn, {
    inTransit: true,
    returnsOnTurn: turn + DENDRITIC_TRANSIT_TURNS,
    hasScouted: false,
  });
}

export function deployNeutrophilPatrol(nodeId, deployedCells, attentionTokens, turn) {
  return deployCell(CELL_TYPES.NEUTROPHIL, nodeId, deployedCells, attentionTokens, turn, {
    isPatrolling: true,
  });
}

export function deployResponder(nodeId, deployedCells, attentionTokens, turn, hasDendriticConfirmation) {
  const effectiveness = hasDendriticConfirmation ? 1.0 : 0.6;
  return deployCell(CELL_TYPES.RESPONDER, nodeId, deployedCells, attentionTokens, turn, {
    effectiveness,
    hasDendriticBacking: hasDendriticConfirmation,
  });
}

export function deployKillerT(nodeId, deployedCells, attentionTokens, turn, hasDendriticConfirmation) {
  if (!hasDendriticConfirmation) {
    return {
      success: false,
      error: 'Killer T-Cells require prior dendritic scout confirmation. Deploy a dendritic cell first.',
      requiresDendritic: true,
    };
  }
  return deployCell(CELL_TYPES.KILLER_T, nodeId, deployedCells, attentionTokens, turn, {
    effectiveness: 1.0,
    hasDendriticBacking: true,
  });
}

export function deployBCell(nodeId, deployedCells, attentionTokens, turn, hasDendriticConfirmation) {
  const effectiveness = hasDendriticConfirmation ? 1.0 : 0.85;
  return deployCell(CELL_TYPES.B_CELL, nodeId, deployedCells, attentionTokens, turn, {
    effectiveness,
    hasDendriticBacking: hasDendriticConfirmation,
  });
}

export function deployNKCell(nodeId, deployedCells, attentionTokens, turn) {
  // NK cells need no confirmation — but risk hitting stressed healthy tissue
  return deployCell(CELL_TYPES.NK_CELL, nodeId, deployedCells, attentionTokens, turn, {
    effectiveness: 1.0,
    hasDendriticBacking: false,
  });
}

export function deployMacrophage(nodeId, deployedCells, attentionTokens, turn) {
  return deployCell(CELL_TYPES.MACROPHAGE, nodeId, deployedCells, attentionTokens, turn, {
    isPatrolling: true,
    coversAdjacentNodes: true,   // macrophages sense adjacent nodes too
  });
}

function deployCell(type, nodeId, deployedCells, attentionTokens, turn, extra = {}) {
  const cost = DEPLOY_COSTS[type];
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
    type,
    nodeId,
    inTransit: false,
    deployedOnTurn: turn,
    ...extra,
  };

  return {
    success: true,
    newDeployedCells: { ...deployedCells, [cellId]: cell },
    cost,
  };
}

// ── Recall ────────────────────────────────────────────────────────────────────

export function recallUnit(cellId, deployedCells) {
  if (!deployedCells[cellId]) {
    return { success: false, error: `Cell ${cellId} not found` };
  }
  const { [cellId]: removed, ...rest } = deployedCells;
  return { success: true, newDeployedCells: rest };
}

// ── Turn advance ──────────────────────────────────────────────────────────────

export function advanceCells(deployedCells, turn) {
  const updated = {};
  for (const [cellId, cell] of Object.entries(deployedCells)) {
    if (cell.type === CELL_TYPES.DENDRITIC) {
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

// ── Queries ───────────────────────────────────────────────────────────────────

export function hasDendriticConfirmation(nodeId, deployedCells) {
  return Object.values(deployedCells).some(
    cell => cell.type === CELL_TYPES.DENDRITIC && cell.nodeId === nodeId && cell.hasScouted
  );
}

export function getPatrolCoverage(deployedCells) {
  const coverage = {};
  for (const cell of Object.values(deployedCells)) {
    if ((cell.type === CELL_TYPES.NEUTROPHIL || cell.type === CELL_TYPES.MACROPHAGE)
        && cell.isPatrolling && !cell.inTransit) {
      coverage[cell.nodeId] = true;
      // Macrophages also cover adjacent nodes (at lower fidelity)
      if (cell.coversAdjacentNodes && NODES[cell.nodeId]) {
        for (const adj of NODES[cell.nodeId].connections) {
          if (!coverage[adj]) coverage[adj] = 'adjacent'; // lower coverage flag
        }
      }
    }
  }
  return coverage;
}

/**
 * Count effective clearance power at a node from all responder-type cells.
 * Used by pathogen.js.
 */
export function getClearancePower(nodeId, deployedCells, groundTruth) {
  let total = 0;
  for (const cell of Object.values(deployedCells)) {
    if (cell.inTransit || cell.nodeId !== nodeId) continue;
    const baseRate = CLEARANCE_RATES[cell.type] ?? 0;
    if (baseRate === 0) continue;

    const effectiveness = cell.effectiveness ?? 1.0;
    const nodeState = groundTruth?.nodeStates?.[nodeId];

    // NK cells hitting stressed-but-clean nodes have reduced effect on pathogen
    // (they're hitting the wrong target)
    if (cell.type === CELL_TYPES.NK_CELL && nodeState?.isClean) {
      total += baseRate * 0.3; // hitting healthy tissue, not pathogen
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
    inTransit: cell.inTransit ?? false,
    returnsOnTurn: cell.returnsOnTurn ?? null,
    effectiveness: cell.effectiveness ?? null,
    hasDendriticBacking: cell.hasDendriticBacking ?? null,
    isPatrolling: cell.isPatrolling ?? false,
  }));
}

// Projection engine — computes expected next-turn deltas without mutating state.
// Used by the UI to display +/- indicators and breakdown tooltips.
//
// The projection calls the same core functions as advanceGroundTruth (via advanceNodeSite)
// but skips spreads, spawns, and events — those involve randomness or future-state unknowns.

import { NODE_IDS } from '../data/nodes.js';
import { TICKS_PER_TURN } from '../data/gameConfig.js';
import { advanceCells } from './cells.js';
import { advanceNodeSite } from './groundTruth.js';
import { computeSystemicStress, applySystemicIntegrityHits } from './systemicValues.js';

/**
 * Compute projected next-turn deltas for all nodes and systemic values.
 *
 * @param {Object} state           — full game state + selectedCellId
 * @param {string|null} hoveredNodeId — if set, and a ready cell is selected, simulate
 *                                      that cell as deployed to this node
 * @returns Projection result, or null if not in playing phase
 */
export function computeProjectedChanges(state, hoveredNodeId = null) {
  if (state.phase !== 'playing') return null;

  const { deployedCells, groundTruth, systemicStress, systemicIntegrity, fever, runModifiers, selectedCellId } = state;

  // Advance cells first (same order as the real turn) so expired cells are removed
  const { updatedCells } = advanceCells(deployedCells, state.tick + TICKS_PER_TURN, runModifiers);

  // Build effective cell map — optionally inject selected cell as arrived at hovered node
  let effectiveDeployedCells = updatedCells;
  if (hoveredNodeId && selectedCellId) {
    const cell = updatedCells[selectedCellId];
    if (cell?.phase === 'ready') {
      effectiveDeployedCells = {
        ...updatedCells,
        [selectedCellId]: { ...cell, phase: 'arrived', nodeId: hoveredNodeId, stationaryTurns: 0 },
      };
    }
  }

  const nodeProjections = {};
  const perSiteOutputs = {};

  for (const nodeId of NODE_IDS) {
    const ns = groundTruth.nodeStates[nodeId];
    if (!ns) continue;

    const {
      updatedPathogens,
      newInflammation,
      newIntegrity,
      toxinOutput,
      pathogenBreakdowns,
    } = advanceNodeSite(ns, nodeId, effectiveDeployedCells, systemicStress, runModifiers);

    perSiteOutputs[nodeId] = { toxinOutput };

    // Per-pathogen deltas — only for classified pathogens (type known to player)
    const pathogenDeltas = {};
    for (const inst of (ns.pathogens ?? [])) {
      if (inst.detected_level !== 'classified') continue;
      const projectedInst = updatedPathogens.find(p => p.uid === inst.uid);
      const projectedLoad = projectedInst ? projectedInst.actualLoad : 0;
      pathogenDeltas[inst.uid] = {
        delta: projectedLoad - inst.actualLoad,
        breakdown: pathogenBreakdowns[inst.uid] ?? [],
      };
    }

    nodeProjections[nodeId] = {
      pathogenDeltas,
      inflammationDelta: newInflammation - ns.inflammation,
      tissueIntegrityDelta: newIntegrity - ns.tissueIntegrity,
    };
  }

  // Build synthetic post-turn nodeStates for systemic stress calculation.
  const projectedNodeStates = { ...groundTruth.nodeStates };
  for (const nodeId of NODE_IDS) {
    const ns = groundTruth.nodeStates[nodeId];
    if (!ns || !nodeProjections[nodeId]) continue;
    projectedNodeStates[nodeId] = {
      ...ns,
      inflammation: nodeProjections[nodeId].inflammationDelta + ns.inflammation,
      tissueIntegrity: nodeProjections[nodeId].tissueIntegrityDelta + ns.tissueIntegrity,
    };
  }

  const { stress: projectedStress } = computeSystemicStress(
    projectedNodeStates, perSiteOutputs, fever, systemicStress, runModifiers
  );

  const projectedIntegrity = applySystemicIntegrityHits(systemicIntegrity, projectedStress);

  return {
    nodes: nodeProjections,
    systemicStressDelta: projectedStress - systemicStress,
    projectedSystemicStress: projectedStress,
    systemicIntegrityDelta: projectedIntegrity - systemicIntegrity,
  };
}

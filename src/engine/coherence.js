// Coherence engine — computes the gap between ground truth and perceived state.
// Pure functions. No React, no UI.
// Coherence = 100 - total gap score. The only place ground truth and perceived state meet.

import { NODES, NODE_IDS } from '../data/nodes.js';

const UNDETECTED_THREAT_BASE_WEIGHT = 1.5;
const OVER_RESPONSE_BASE_WEIGHT = 0.8;
const SPLEEN_STRESS_MULTIPLIER_MAX = 0.3; // max additional penalty from spleen stress

/**
 * Compute coherence from ground truth and perceived state.
 * @param {Object} groundTruth - hidden game state
 * @param {Object} perceivedState - player's working model
 * @returns {{ score: number, breakdown: Object[] }}
 */
export function computeCoherence(groundTruth, perceivedState) {
  const breakdown = [];
  let totalGap = 0;

  for (const nodeId of NODE_IDS) {
    const node = NODES[nodeId];
    const gtNode = groundTruth.nodeStates[nodeId];
    const psNode = perceivedState.nodes[nodeId];

    if (!gtNode || !psNode) continue;

    const actualThreat = gtNode.pathogenStrength > 0;
    const perceivedThreat = psNode.threatLevel > 0;
    const responseLevel = psNode.responseLevel ?? 0;

    // Gap type 1: Undetected threat
    // Ground truth shows threat, perceived state shows nothing
    if (actualThreat && !perceivedThreat) {
      const severity = gtNode.pathogenStrength / 100;
      const gap = UNDETECTED_THREAT_BASE_WEIGHT * severity * (node.damageWeight ?? 1);
      totalGap += gap;
      breakdown.push({
        nodeId,
        nodeLabel: node.label,
        type: 'undetected_threat',
        score: gap,
        detail: `Undetected threat at ${node.label} (strength ${Math.round(gtNode.pathogenStrength)})`,
      });
    }

    // Gap type 2: Over-response
    // Perceived state is responding to a node where ground truth shows no threat
    if (!actualThreat && responseLevel > 0) {
      const gap = OVER_RESPONSE_BASE_WEIGHT * (responseLevel / 3) * (node.damageWeight ?? 1);
      totalGap += gap;
      breakdown.push({
        nodeId,
        nodeLabel: node.label,
        type: 'over_response',
        score: gap,
        detail: `Responding to ${node.label} but no threat present (response level ${responseLevel})`,
      });
    }

    // Gap type 3: Under-response to confirmed threat
    // Ground truth shows serious threat, player has confirmed but not responded
    if (actualThreat && perceivedThreat && responseLevel === 0 && gtNode.pathogenStrength > 40) {
      const gap = 0.5 * (gtNode.pathogenStrength / 100);
      totalGap += gap;
      breakdown.push({
        nodeId,
        nodeLabel: node.label,
        type: 'under_response',
        score: gap,
        detail: `Confirmed threat at ${node.label} with no response deployed`,
      });
    }

    // Collateral damage penalty
    if (gtNode.inflammation > 60) {
      const gap = 0.4 * (gtNode.inflammation / 100);
      totalGap += gap;
      breakdown.push({
        nodeId,
        nodeLabel: node.label,
        type: 'collateral_damage',
        score: gap,
        detail: `High inflammation at ${node.label} (${Math.round(gtNode.inflammation)}%)`,
      });
    }
  }

  // Spleen stress multiplier
  const spleenStressMultiplier = 1 + (groundTruth.spleenStress / 100) * SPLEEN_STRESS_MULTIPLIER_MAX;
  totalGap *= spleenStressMultiplier;

  if (groundTruth.spleenStress > 30) {
    breakdown.push({
      nodeId: 'SPLEEN',
      nodeLabel: 'Spleen',
      type: 'spleen_stress',
      score: totalGap * (spleenStressMultiplier - 1),
      detail: `HQ stress amplifying all gaps (${Math.round(groundTruth.spleenStress)}% stress)`,
    });
  }

  // Convert to 0-100 score
  // Gap of 10 = coherence of 0 (calibrated for typical play session)
  const score = Math.max(0, Math.min(100, 100 - totalGap * 10));

  return { score: Math.round(score), breakdown };
}

/**
 * Determine if coherence collapse has occurred (score hits 0).
 */
export function isCoherenceCollapsed(coherenceScore) {
  return coherenceScore <= 0;
}

/**
 * Compute routing pressure for this turn.
 * Used by ground truth to update spleen stress.
 * @param {Object[]} routingDecisions - decisions made this turn
 * @returns {number} 0-1 pressure value
 */
export function computeRoutingPressure(routingDecisions) {
  if (!routingDecisions || routingDecisions.length === 0) return 0;

  const amplifyCount = routingDecisions.filter(d => d.decision === 'amplify').length;
  const forwardCount = routingDecisions.filter(d => d.decision === 'forward').length;

  // Amplifies cause high pressure, forwards moderate
  const pressure = (amplifyCount * 0.3 + forwardCount * 0.1) / Math.max(1, routingDecisions.length);
  return Math.min(1, pressure);
}

/**
 * Describe the dominant failure mode for the post-mortem.
 */
export function identifyFailureMode(coherenceHistory, breakdown) {
  if (!breakdown || breakdown.length === 0) return 'unknown';

  const dominant = breakdown.reduce((max, item) =>
    item.score > max.score ? item : max, { score: 0, type: 'unknown' }
  );

  const modeMap = {
    undetected_threat: 'missed_threat',
    over_response: 'over_response',
    under_response: 'slow_response',
    collateral_damage: 'collateral_damage',
    spleen_stress: 'routing_overload',
  };

  return modeMap[dominant.type] ?? 'unknown';
}

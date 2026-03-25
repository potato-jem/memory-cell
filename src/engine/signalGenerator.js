// Signal Generator — translates ground truth into signals each turn.
// Pure functions. No React, no UI.
// Silence is information — this file deliberately omits signals sometimes.

import { NODES, NODE_IDS } from '../data/nodes.js';
import {
  SIGNAL_TYPES,
  SIGNAL_SOURCES,
  CONFIDENCE_LEVELS,
  getSignalText,
} from '../data/signals.js';

let _signalIdCounter = 1;
function nextSignalId() {
  return `sig_${_signalIdCounter++}`;
}

/**
 * Generate signals for the current turn.
 * @param {Object} groundTruth - hidden game state
 * @param {Object} deployedCells - current deployed cells
 * @param {Object} situationDef - situation parameters
 * @param {number} turn - current turn number
 * @param {Object[]} seededEventsThisTurn - seeded events for this exact turn
 * @returns {Object[]} array of signal objects
 */
export function generateSignals(groundTruth, deployedCells, situationDef, turn, seededEventsThisTurn) {
  const signals = [];
  const usedNodes = new Set(); // avoid duplicate signals from same node same turn

  // 1. Process seeded events first (they take priority)
  for (const event of seededEventsThisTurn) {
    if (event.type !== 'signal') continue;

    const node = NODES[event.nodeId];
    if (!node) continue;

    const signal = makeSignal({
      nodeId: event.nodeId,
      nodeLabel: node.label,
      type: event.signalType,
      confidence: event.confidence,
      source: SIGNAL_SOURCES.NEUTROPHIL,
      delay: Math.floor(node.signalSpeed),
      isFalseAlarm: event.isFalseAlarm ?? false,
      isSeeded: true,
      turn,
    });

    signals.push(signal);
    usedNodes.add(event.nodeId);
  }

  // 2. Organic signals from infected nodes (probabilistic)
  for (const [nodeId, pathogenData] of Object.entries(groundTruth.pathogenState)) {
    if (!pathogenData || pathogenData.strength <= 0) continue;
    if (usedNodes.has(nodeId)) continue;

    const node = NODES[nodeId];
    if (!node) continue;

    // Signal accuracy check — silence is information
    if (Math.random() > situationDef.signalAccuracyRate) {
      // No signal this turn from this infected node
      continue;
    }

    const strength = pathogenData.strength;
    const confidence = strengthToConfidence(strength);
    const signalType = strengthToSignalType(strength, situationDef.pathogen.spreadThreshold);

    const signal = makeSignal({
      nodeId,
      nodeLabel: node.label,
      type: signalType,
      confidence,
      source: SIGNAL_SOURCES.NEUTROPHIL,
      delay: node.signalSpeed,
      isFalseAlarm: false,
      isSeeded: false,
      turn,
    });

    signals.push(signal);
    usedNodes.add(nodeId);
  }

  // 3. Dendritic cell returns — high-confidence ground truth
  for (const [cellId, cell] of Object.entries(deployedCells)) {
    if (cell.type !== 'dendritic') continue;
    if (cell.returnsOnTurn !== turn) continue;

    const node = NODES[cell.nodeId];
    const pathogenHere = groundTruth.pathogenState[cell.nodeId];
    const hasPathogen = pathogenHere && pathogenHere.strength > 0;

    const signalType = hasPathogen
      ? (pathogenHere.strength >= situationDef.pathogen.spreadThreshold
          ? SIGNAL_TYPES.THREAT_EXPANDING
          : SIGNAL_TYPES.THREAT_CONFIRMED)
      : SIGNAL_TYPES.FALSE_ALARM;

    const signal = makeSignal({
      nodeId: cell.nodeId,
      nodeLabel: node.label,
      type: signalType,
      confidence: CONFIDENCE_LEVELS.HIGH,
      source: SIGNAL_SOURCES.DENDRITIC,
      delay: 0,
      isFalseAlarm: !hasPathogen,
      isSeeded: false,
      turn,
      isDendriticReturn: true,
      cellId,
    });

    signals.push(signal);
    usedNodes.add(cell.nodeId);
  }

  // 4. Collateral damage signals from high inflammation
  for (const nodeId of NODE_IDS) {
    if (usedNodes.has(nodeId)) continue;

    const nodeState = groundTruth.nodeStates[nodeId];
    if (!nodeState || nodeState.inflammation < 40) continue;

    const node = NODES[nodeId];
    const confidence = nodeState.inflammation > 70
      ? CONFIDENCE_LEVELS.HIGH
      : CONFIDENCE_LEVELS.MEDIUM;

    const signal = makeSignal({
      nodeId,
      nodeLabel: node.label,
      type: SIGNAL_TYPES.COLLATERAL_DAMAGE,
      confidence,
      source: SIGNAL_SOURCES.MACROPHAGE,
      delay: node.signalSpeed,
      isFalseAlarm: false,
      isSeeded: false,
      turn,
    });

    signals.push(signal);
    usedNodes.add(nodeId);
  }

  // 5. False alarm signals from patrolled clean nodes
  for (const [cellId, cell] of Object.entries(deployedCells)) {
    if (cell.type !== 'neutrophil') continue;
    if (cell.inTransit) continue;

    const nodeId = cell.nodeId;
    if (usedNodes.has(nodeId)) continue;

    const pathogenHere = groundTruth.pathogenState[nodeId];
    const isClean = !pathogenHere || pathogenHere.strength <= 0;

    if (isClean && Math.random() < situationDef.falseAlarmRate) {
      const node = NODES[nodeId];
      const signal = makeSignal({
        nodeId,
        nodeLabel: node.label,
        type: SIGNAL_TYPES.ANOMALY_DETECTED,
        confidence: CONFIDENCE_LEVELS.LOW,
        source: SIGNAL_SOURCES.NEUTROPHIL,
        delay: node.signalSpeed,
        isFalseAlarm: true,
        isSeeded: false,
        turn,
      });
      signals.push(signal);
      usedNodes.add(nodeId);
    }

    // Patrol clear signal from clean node
    if (isClean && Math.random() < 0.4) {
      const node = NODES[nodeId];
      if (!usedNodes.has(nodeId)) {
        const signal = makeSignal({
          nodeId,
          nodeLabel: node.label,
          type: SIGNAL_TYPES.PATROL_CLEAR,
          confidence: CONFIDENCE_LEVELS.MEDIUM,
          source: SIGNAL_SOURCES.NEUTROPHIL,
          delay: node.signalSpeed,
          isFalseAlarm: false,
          isSeeded: false,
          turn,
        });
        signals.push(signal);
        usedNodes.add(nodeId);
      }
    }
  }

  return signals;
}

function makeSignal({
  nodeId, nodeLabel, type, confidence, source, delay,
  isFalseAlarm, isSeeded, turn, isDendriticReturn = false, cellId = null,
}) {
  return {
    id: nextSignalId(),
    nodeId,
    text: getSignalText(type, confidence, nodeLabel),
    type,
    confidence,
    source,
    delay: Math.round(delay),
    isFalseAlarm,       // hidden during play, revealed in post-mortem
    isSeeded,
    isDendriticReturn,
    cellId,
    arrivedOnTurn: turn,
    routed: false,
    routingDecision: null,
    // Ground truth values — revealed in post-mortem only
    _groundTruthType: type,
    _wasAccurate: !isFalseAlarm,
  };
}

function strengthToConfidence(strength) {
  if (strength < 20) return CONFIDENCE_LEVELS.LOW;
  if (strength < 50) return CONFIDENCE_LEVELS.MEDIUM;
  return CONFIDENCE_LEVELS.HIGH;
}

function strengthToSignalType(strength, spreadThreshold) {
  if (strength >= spreadThreshold) return SIGNAL_TYPES.THREAT_EXPANDING;
  if (strength >= 25) return SIGNAL_TYPES.THREAT_CONFIRMED;
  return SIGNAL_TYPES.ANOMALY_DETECTED;
}

/**
 * Generate a "silence" notice for patrolled nodes with no signal.
 * These are informational — not routing targets.
 */
export function generateSilenceNotices(groundTruth, deployedCells, turn) {
  const notices = [];

  for (const [cellId, cell] of Object.entries(deployedCells)) {
    if (cell.type !== 'neutrophil' || cell.inTransit) continue;

    const nodeId = cell.nodeId;
    const node = NODES[nodeId];
    const pathogenHere = groundTruth.pathogenState[nodeId];
    const hasPathogen = pathogenHere && pathogenHere.strength > 0;

    // If the node has a real threat but we're generating no signal, flag the silence
    if (hasPathogen) {
      notices.push({
        nodeId,
        nodeLabel: node.label,
        message: `No signal received from ${node.label} this turn — but the node is patrolled.`,
        turn,
        _groundTruthHasThreat: true,
      });
    }
  }

  return notices;
}

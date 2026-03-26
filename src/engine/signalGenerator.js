// Signal Generator — translates ground truth into signals each turn.
// Real-time: signals carry expiresAtTick; collateral_damage gated on patrol coverage.

import { NODES, NODE_IDS } from '../data/nodes.js';
import {
  SIGNAL_TYPES,
  SIGNAL_SOURCES,
  CONFIDENCE_LEVELS,
  getSignalText,
  THREAT_TYPES,
} from '../data/signals.js';
import {
  WARNING_SIGNAL_TIMEOUT,
  ALERT_SIGNAL_TIMEOUT,
  INFO_SIGNAL_TIMEOUT,
  INFLAMMATION_REQUIRES_VISIBILITY,
} from '../data/gameConfig.js';
import { getSignalAccuracyForType } from './pathogen.js';
import { applyMemoryBonus } from './memory.js';

let _signalIdCounter = 1;
function nextSignalId() { return `sig_${_signalIdCounter++}`; }

/**
 * Generate signals for the current turn.
 * @param {Object} groundTruth
 * @param {Object} deployedCells
 * @param {Object} situationDef
 * @param {number} turn        - simulation turn (used for situation logic)
 * @param {Object[]} seededEventsThisTurn
 * @param {Object} memoryBank
 * @param {string} situationId
 * @param {number} tick        - current real tick (for expiresAtTick)
 * @param {Object} patrolCoverage - from getPatrolCoverage(deployedCells)
 */
export function generateSignals(
  groundTruth,
  deployedCells,
  situationDef,
  turn,
  seededEventsThisTurn,
  memoryBank = null,
  situationId = 'primary',
  tick = 0,
  patrolCoverage = {}
) {
  const signals = [];
  const usedNodes = new Set();
  const pathogenType = situationDef.pathogen.type;

  // 1. Seeded events
  for (const event of seededEventsThisTurn) {
    if (event.type !== 'signal') continue;
    const node = NODES[event.nodeId];
    if (!node) continue;

    let signal = makeSignal({
      nodeId: event.nodeId,
      nodeLabel: node.label,
      type: event.signalType,
      confidence: event.confidence,
      source: SIGNAL_SOURCES.NEUTROPHIL,
      isFalseAlarm: event.isFalseAlarm ?? false,
      isSeeded: true,
      turn,
      tick,
      threatType: event.isFalseAlarm ? null : pathogenType,
      situationId,
    });

    signal = maybeApplyMemoryBonus(signal, memoryBank, event.isFalseAlarm ? null : pathogenType);
    signals.push(signal);
    usedNodes.add(event.nodeId);
  }

  // 2. Organic signals from infected nodes
  for (const [nodeId, pathogenData] of Object.entries(groundTruth.pathogenState)) {
    if (!pathogenData || pathogenData.strength <= 0) continue;
    if (usedNodes.has(nodeId)) continue;

    const node = NODES[nodeId];
    if (!node) continue;

    const accuracy = getSignalAccuracyForType(pathogenType, pathogenData.strength, turn, situationDef);
    if (Math.random() > accuracy) continue;

    const strength = pathogenData.strength;
    const confidence = strengthToConfidence(strength);
    const signalType = strengthToSignalType(strength, situationDef.pathogen.spreadThreshold, pathogenType, turn);

    const source = pathogenType === THREAT_TYPES.AUTOIMMUNE
      ? SIGNAL_SOURCES.NK_CELL
      : pathogenType === THREAT_TYPES.VIRAL
      ? SIGNAL_SOURCES.INFECTED_CELL
      : SIGNAL_SOURCES.NEUTROPHIL;

    let signal = makeSignal({
      nodeId, nodeLabel: node.label, type: signalType, confidence, source,
      isFalseAlarm: false, isSeeded: false, turn, tick, threatType: pathogenType, situationId,
    });

    signal = maybeApplyMemoryBonus(signal, memoryBank, pathogenType);
    signals.push(signal);
    usedNodes.add(nodeId);
  }

  // 3. Scout (dendritic) returns — triggered by 'scout_arrived' events in actions.js
  //    (handled directly in the TICK handler, not here)

  // 4. Collateral damage — only visible if patrol/macrophage covers the node
  for (const nodeId of NODE_IDS) {
    if (usedNodes.has(nodeId)) continue;
    const nodeState = groundTruth.nodeStates[nodeId];
    if (!nodeState || nodeState.inflammation < 40) continue;

    // Visibility gate: must have patrol or macrophage coverage
    if (INFLAMMATION_REQUIRES_VISIBILITY && !patrolCoverage[nodeId]) continue;

    const node = NODES[nodeId];
    const confidence = nodeState.inflammation > 70 ? CONFIDENCE_LEVELS.HIGH : CONFIDENCE_LEVELS.MEDIUM;

    signals.push(makeSignal({
      nodeId, nodeLabel: node.label,
      type: SIGNAL_TYPES.COLLATERAL_DAMAGE, confidence,
      source: SIGNAL_SOURCES.MACROPHAGE,
      isFalseAlarm: false, isSeeded: false, turn, tick,
      threatType: pathogenType, situationId,
    }));
    usedNodes.add(nodeId);
  }

  // 5. False alarms and patrol-clear from patrol cells at their current node
  for (const cell of Object.values(deployedCells)) {
    if (!['neutrophil', 'macrophage'].includes(cell.type)) continue;
    if (cell.phase !== 'arrived') continue;

    const nodeId = cell.nodeId;
    if (usedNodes.has(nodeId)) continue;

    const pathogenHere = groundTruth.pathogenState[nodeId];
    const isClean = !pathogenHere || pathogenHere.strength <= 0;

    if (isClean) {
      if (Math.random() < (situationDef.falseAlarmRate ?? 0.15)) {
        const node = NODES[nodeId];
        signals.push(makeSignal({
          nodeId, nodeLabel: node.label,
          type: SIGNAL_TYPES.ANOMALY_DETECTED, confidence: CONFIDENCE_LEVELS.LOW,
          source: SIGNAL_SOURCES.NEUTROPHIL,
          isFalseAlarm: true, isSeeded: false, turn, tick, situationId,
        }));
        usedNodes.add(nodeId);
      } else if (Math.random() < 0.4) {
        const node = NODES[nodeId];
        signals.push(makeSignal({
          nodeId, nodeLabel: node.label,
          type: SIGNAL_TYPES.PATROL_CLEAR, confidence: CONFIDENCE_LEVELS.MEDIUM,
          source: SIGNAL_SOURCES.NEUTROPHIL,
          isFalseAlarm: false, isSeeded: false, turn, tick, situationId,
        }));
        usedNodes.add(nodeId);
      }
    }
  }

  return signals;
}

function maybeApplyMemoryBonus(signal, memoryBank, threatType) {
  if (!memoryBank || !threatType) return signal;
  return applyMemoryBonus(signal, memoryBank, threatType);
}

function signalExpiry(type, tick) {
  switch (type) {
    case SIGNAL_TYPES.THREAT_CONFIRMED:
    case SIGNAL_TYPES.THREAT_EXPANDING:
      return ALERT_SIGNAL_TIMEOUT == null ? null : tick + ALERT_SIGNAL_TIMEOUT;
    case SIGNAL_TYPES.ANOMALY_DETECTED:
    case SIGNAL_TYPES.COLLATERAL_DAMAGE:
      return tick + WARNING_SIGNAL_TIMEOUT;
    default: // patrol_clear, false_alarm, resolution
      return INFO_SIGNAL_TIMEOUT == null ? null : tick + INFO_SIGNAL_TIMEOUT;
  }
}

function makeSignal({
  nodeId, nodeLabel, type, confidence, source,
  isFalseAlarm, isSeeded, turn, tick, isDendriticReturn = false,
  cellId = null, threatType = null, situationId = 'primary',
}) {
  return {
    id: nextSignalId(),
    nodeId,
    text: getSignalText(type, confidence, nodeLabel, threatType),
    type,
    confidence,
    source,
    isFalseAlarm,
    isSeeded,
    isDendriticReturn,
    cellId,
    threatType,
    situationId,
    arrivedOnTurn: turn,
    arrivedAtTick: tick,
    expiresAtTick: signalExpiry(type, tick),
    routed: false,
    routingDecision: null,
    hasMemoryBonus: false,
    _groundTruthType: type,
    _wasAccurate: !isFalseAlarm,
  };
}

function strengthToConfidence(strength) {
  if (strength < 20) return CONFIDENCE_LEVELS.LOW;
  if (strength < 50) return CONFIDENCE_LEVELS.MEDIUM;
  return CONFIDENCE_LEVELS.HIGH;
}

function strengthToSignalType(strength, spreadThreshold, pathogenType, turn) {
  if (pathogenType === THREAT_TYPES.CANCER) {
    if (strength < 30) return SIGNAL_TYPES.ANOMALY_DETECTED;
    if (strength < 60) return SIGNAL_TYPES.THREAT_CONFIRMED;
    return SIGNAL_TYPES.THREAT_EXPANDING;
  }
  if (pathogenType === THREAT_TYPES.MIMIC) {
    if (strength < 40) return SIGNAL_TYPES.ANOMALY_DETECTED;
    return SIGNAL_TYPES.THREAT_CONFIRMED;
  }
  if (strength >= spreadThreshold) return SIGNAL_TYPES.THREAT_EXPANDING;
  if (strength >= 25) return SIGNAL_TYPES.THREAT_CONFIRMED;
  return SIGNAL_TYPES.ANOMALY_DETECTED;
}

// Build a dendritic-return signal directly (called from TICK handler on scout_arrived event)
export function makeDendriticReturnSignal(cell, groundTruth, situationDef, tick, turn, situationId) {
  const node = NODES[cell.nodeId];
  const pathogenHere = groundTruth.pathogenState[cell.nodeId];
  const hasPathogen = pathogenHere && pathogenHere.strength > 0;
  const pathogenType = situationDef.pathogen.type;

  const signalType = hasPathogen
    ? (pathogenHere.strength >= situationDef.pathogen.spreadThreshold
        ? SIGNAL_TYPES.THREAT_EXPANDING
        : SIGNAL_TYPES.THREAT_CONFIRMED)
    : SIGNAL_TYPES.FALSE_ALARM;

  return makeSignal({
    nodeId: cell.nodeId,
    nodeLabel: node.label,
    type: signalType,
    confidence: CONFIDENCE_LEVELS.HIGH,
    source: SIGNAL_SOURCES.DENDRITIC,
    isFalseAlarm: !hasPathogen,
    isSeeded: false,
    turn,
    tick,
    isDendriticReturn: true,
    cellId: cell.id,
    threatType: hasPathogen ? pathogenType : null,
    situationId,
  });
}

export function generateSilenceNotices(groundTruth, deployedCells, turn) {
  const notices = [];
  for (const cell of Object.values(deployedCells)) {
    if (cell.type !== 'neutrophil' || cell.phase !== 'arrived') continue;
    const nodeId = cell.nodeId;
    const node = NODES[nodeId];
    const pathogenHere = groundTruth.pathogenState[nodeId];
    if (pathogenHere && pathogenHere.strength > 0) {
      notices.push({
        nodeId,
        nodeLabel: node.label,
        message: `No signal from ${node.label} — node is patrolled.`,
        turn,
        _groundTruthHasThreat: true,
      });
    }
  }
  return notices;
}

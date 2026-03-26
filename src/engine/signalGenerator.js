// Signal Generator — translates ground truth into signals each turn.
// Layer 2: threat-type-specific vocabularies, memory bonus, new cell type sources.

import { NODES, NODE_IDS } from '../data/nodes.js';
import {
  SIGNAL_TYPES,
  SIGNAL_SOURCES,
  CONFIDENCE_LEVELS,
  getSignalText,
  THREAT_TYPES,
} from '../data/signals.js';
import { getSignalAccuracyForType } from './pathogen.js';
import { applyMemoryBonus } from './memory.js';

let _signalIdCounter = 1;
function nextSignalId() {
  return `sig_${_signalIdCounter++}`;
}

/**
 * Generate signals for the current turn.
 * @param {Object} groundTruth
 * @param {Object} deployedCells
 * @param {Object} situationDef
 * @param {number} turn
 * @param {Object[]} seededEventsThisTurn
 * @param {Object} memoryBank - player's immune memory
 * @param {string} situationId - for concurrent mode tagging
 */
export function generateSignals(
  groundTruth,
  deployedCells,
  situationDef,
  turn,
  seededEventsThisTurn,
  memoryBank = null,
  situationId = 'primary'
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
      delay: Math.floor(node.signalSpeed),
      isFalseAlarm: event.isFalseAlarm ?? false,
      isSeeded: true,
      turn,
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

    // Type-specific signal accuracy (cancer is quiet, mimic is silent early)
    const accuracy = getSignalAccuracyForType(
      pathogenType,
      pathogenData.strength,
      turn,
      situationDef
    );

    if (Math.random() > accuracy) continue;

    const strength = pathogenData.strength;
    const confidence = strengthToConfidence(strength);
    const signalType = strengthToSignalType(strength, situationDef.pathogen.spreadThreshold, pathogenType, turn);

    // Autoimmune signals come from NK/responder cells, not neutrophils
    const source = pathogenType === THREAT_TYPES.AUTOIMMUNE
      ? SIGNAL_SOURCES.NK_CELL
      : pathogenType === THREAT_TYPES.VIRAL
      ? SIGNAL_SOURCES.INFECTED_CELL
      : SIGNAL_SOURCES.NEUTROPHIL;

    let signal = makeSignal({
      nodeId,
      nodeLabel: node.label,
      type: signalType,
      confidence,
      source,
      delay: node.signalSpeed,
      isFalseAlarm: false,
      isSeeded: false,
      turn,
      threatType: pathogenType,
      situationId,
    });

    signal = maybeApplyMemoryBonus(signal, memoryBank, pathogenType);
    signals.push(signal);
    usedNodes.add(nodeId);
  }

  // 3. Dendritic cell returns
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
      threatType: hasPathogen ? pathogenType : null,
      situationId,
    });

    signals.push(signal);
    usedNodes.add(cell.nodeId);
  }

  // 4. Collateral damage signals
  for (const nodeId of NODE_IDS) {
    if (usedNodes.has(nodeId)) continue;
    const nodeState = groundTruth.nodeStates[nodeId];
    if (!nodeState || nodeState.inflammation < 40) continue;

    const node = NODES[nodeId];
    const confidence = nodeState.inflammation > 70 ? CONFIDENCE_LEVELS.HIGH : CONFIDENCE_LEVELS.MEDIUM;

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
      threatType: pathogenType, // collateral is threat-type aware
      situationId,
    });

    signals.push(signal);
    usedNodes.add(nodeId);
  }

  // 5. False alarms from patrolled clean nodes
  for (const [cellId, cell] of Object.entries(deployedCells)) {
    if (!['neutrophil', 'macrophage'].includes(cell.type)) continue;
    if (cell.inTransit) continue;

    const nodeId = cell.nodeId;
    if (usedNodes.has(nodeId)) continue;

    const pathogenHere = groundTruth.pathogenState[nodeId];
    const isClean = !pathogenHere || pathogenHere.strength <= 0;

    if (isClean) {
      if (Math.random() < (situationDef.falseAlarmRate ?? 0.15)) {
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
          situationId,
        });
        signals.push(signal);
        usedNodes.add(nodeId);
      } else if (Math.random() < 0.4) {
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
            situationId,
          });
          signals.push(signal);
          usedNodes.add(nodeId);
        }
      }
    }
  }

  return signals;
}

function maybeApplyMemoryBonus(signal, memoryBank, threatType) {
  if (!memoryBank || !threatType) return signal;
  return applyMemoryBonus(signal, memoryBank, threatType);
}

function makeSignal({
  nodeId, nodeLabel, type, confidence, source, delay,
  isFalseAlarm, isSeeded, turn, isDendriticReturn = false,
  cellId = null, threatType = null, situationId = 'primary',
}) {
  return {
    id: nextSignalId(),
    nodeId,
    text: getSignalText(type, confidence, nodeLabel, threatType),
    type,
    confidence,
    source,
    delay: Math.round(delay),
    isFalseAlarm,
    isSeeded,
    isDendriticReturn,
    cellId,
    threatType,
    situationId,
    arrivedOnTurn: turn,
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
  // Cancer: always quiet signals
  if (pathogenType === THREAT_TYPES.CANCER) {
    if (strength < 30) return SIGNAL_TYPES.ANOMALY_DETECTED;
    if (strength < 60) return SIGNAL_TYPES.THREAT_CONFIRMED;
    return SIGNAL_TYPES.THREAT_EXPANDING;
  }

  // Mimic: quiet early, sudden reveal late
  if (pathogenType === THREAT_TYPES.MIMIC) {
    if (strength < 40) return SIGNAL_TYPES.ANOMALY_DETECTED; // "something changed"
    return SIGNAL_TYPES.THREAT_CONFIRMED;
  }

  if (strength >= spreadThreshold) return SIGNAL_TYPES.THREAT_EXPANDING;
  if (strength >= 25) return SIGNAL_TYPES.THREAT_CONFIRMED;
  return SIGNAL_TYPES.ANOMALY_DETECTED;
}

export function generateSilenceNotices(groundTruth, deployedCells, turn) {
  const notices = [];

  for (const cell of Object.values(deployedCells)) {
    if (cell.type !== 'neutrophil' || cell.inTransit) continue;

    const nodeId = cell.nodeId;
    const node = NODES[nodeId];
    const pathogenHere = groundTruth.pathogenState[nodeId];
    const hasPathogen = pathogenHere && pathogenHere.strength > 0;

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

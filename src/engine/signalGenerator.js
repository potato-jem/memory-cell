// Signal Generator — translates ground truth into signals each turn.
// Organic signals only come from patrol/macrophage cells actively at nodes.
// Detection outcomes from detection.js determine what (if anything) they perceive.

import { NODES, NODE_IDS } from '../data/nodes.js';
import { SIGNAL_TYPES, SIGNAL_SOURCES, CONFIDENCE_LEVELS } from '../data/signals.js';
import { WARNING_SIGNAL_TIMEOUT, ALERT_SIGNAL_TIMEOUT, INFO_SIGNAL_TIMEOUT } from '../data/gameConfig.js';
import { rollDetection, DETECTION_OUTCOMES } from '../data/detection.js';
import { applyMemoryBonus } from './memory.js';

let _signalIdCounter = 1;
function nextSignalId() { return `sig_${_signalIdCounter++}`; }

/**
 * Generate signals for one simulation turn.
 *
 * @param {Object} groundTruth
 * @param {Object} deployedCells
 * @param {Object} situationDef
 * @param {number} turn
 * @param {Object[]} seededEventsThisTurn  - authored events; bypass detection roll
 * @param {Object|null} memoryBank
 * @param {string} situationId
 * @param {number} tick                    - for expiresAtTick
 * @param {Object} _patrolCoverage         - unused here now; kept for API compat
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
  _patrolCoverage = {}
) {
  const signals = [];
  const usedNodes = new Set();
  const pathogenType = situationDef.pathogen.type;

  // ── 1. Seeded events (authored; always fire, bypass detection) ─────────────
  for (const event of seededEventsThisTurn) {
    if (event.type !== 'signal') continue;
    const node = NODES[event.nodeId];
    if (!node) continue;

    let sig = makeSignal({
      nodeId: event.nodeId, nodeLabel: node.label,
      type: event.signalType, confidence: event.confidence,
      source: SIGNAL_SOURCES.NEUTROPHIL,
      isFalseAlarm: event.isFalseAlarm ?? false,
      reportedThreatType: event.isFalseAlarm ? null : pathogenType,
      detectionOutcome: event.isFalseAlarm ? DETECTION_OUTCOMES.FALSE_ALARM : DETECTION_OUTCOMES.CORRECT_ID,
      isSeeded: true, turn, tick, situationId,
    });
    sig = maybeApplyMemoryBonus(sig, memoryBank, event.isFalseAlarm ? null : pathogenType);
    signals.push(sig);
    usedNodes.add(event.nodeId);
  }

  // ── 2. Per-cell detection rolls (patrol + macrophage) ─────────────────────
  // Each cell at a node rolls independently against the detection matrix.
  // One signal per node per turn (first roll that produces a non-MISS wins).
  for (const cell of Object.values(deployedCells)) {
    if (!['neutrophil', 'macrophage'].includes(cell.type)) continue;
    if (cell.phase !== 'arrived') continue;

    const nodeId = cell.nodeId;
    if (usedNodes.has(nodeId)) continue;

    const nodeState = groundTruth.nodeStates?.[nodeId] ?? {};
    const pathogenHere = groundTruth.pathogenState?.[nodeId];
    const actualThreatType = (pathogenHere?.strength > 0) ? pathogenType : null;
    const threatStrength = pathogenHere?.strength ?? 0;
    const inflammation = nodeState.inflammation ?? 0;

    const { outcome, reportedType } = rollDetection(cell.type, actualThreatType, threatStrength, inflammation);
    if (outcome === DETECTION_OUTCOMES.MISS) continue;

    const sig = detectionOutcomeToSignal({
      outcome, reportedType,
      nodeId, nodeLabel: NODES[nodeId].label,
      cellType: cell.type, turn, tick, situationId, memoryBank,
    });
    if (!sig) continue;

    signals.push(sig);
    usedNodes.add(nodeId);
  }

  // ── 3. Collateral damage — macrophage/neutrophil at inflamed node ──────────
  // Separate from threat detection: did YOUR cells cause visible damage?
  // Already requires coverage (cell.phase === 'arrived') inherently.
  for (const cell of Object.values(deployedCells)) {
    if (!['neutrophil', 'macrophage'].includes(cell.type)) continue;
    if (cell.phase !== 'arrived') continue;

    const nodeId = cell.nodeId;
    if (usedNodes.has(nodeId)) continue; // already reported on this node this turn

    const nodeState = groundTruth.nodeStates?.[nodeId] ?? {};
    if ((nodeState.inflammation ?? 0) < 40) continue;

    const confidence = nodeState.inflammation > 70 ? CONFIDENCE_LEVELS.HIGH : CONFIDENCE_LEVELS.MEDIUM;
    signals.push(makeSignal({
      nodeId, nodeLabel: NODES[nodeId].label,
      type: SIGNAL_TYPES.COLLATERAL_DAMAGE, confidence,
      source: SIGNAL_SOURCES.MACROPHAGE,
      isFalseAlarm: false, reportedThreatType: null,
      detectionOutcome: DETECTION_OUTCOMES.ANOMALY,
      isSeeded: false, turn, tick, situationId,
    }));
    usedNodes.add(nodeId);
  }

  return signals;
}

// ── Dendritic scout return ────────────────────────────────────────────────────
// Called from the TICK handler when a scout_arrived event fires.
// The scout gets ONE detection roll on arrival — result is definitive for that visit.

export function makeDendriticReturnSignal(cell, groundTruth, situationDef, tick, turn, situationId) {
  const node = NODES[cell.nodeId];
  if (!node) return null;

  const pathogenType = situationDef.pathogen.type;
  const pathogenHere = groundTruth.pathogenState?.[cell.nodeId];
  const nodeState = groundTruth.nodeStates?.[cell.nodeId] ?? {};
  const actualThreatType = (pathogenHere?.strength > 0) ? pathogenType : null;
  const threatStrength = pathogenHere?.strength ?? 0;
  const inflammation = nodeState.inflammation ?? 0;

  const { outcome, reportedType } = rollDetection('dendritic', actualThreatType, threatStrength, inflammation);

  return detectionOutcomeToSignal({
    outcome, reportedType,
    nodeId: cell.nodeId, nodeLabel: node.label,
    cellType: 'dendritic', turn, tick, situationId,
    memoryBank: null,
    isDendriticReturn: true, cellId: cell.id,
  });
}

// ── Silence notices ───────────────────────────────────────────────────────────
// Informational only — not signals, not shown in badges.
export function generateSilenceNotices(groundTruth, deployedCells, turn) {
  const notices = [];
  for (const cell of Object.values(deployedCells)) {
    if (cell.type !== 'neutrophil' || cell.phase !== 'arrived') continue;
    const nodeId = cell.nodeId;
    const node = NODES[nodeId];
    const pathogenHere = groundTruth.pathogenState?.[nodeId];
    if (pathogenHere?.strength > 0) {
      notices.push({
        nodeId, nodeLabel: node?.label,
        message: `Patrol at ${node?.label} — no confirmed report this turn.`,
        turn,
      });
    }
  }
  return notices;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function detectionOutcomeToSignal({
  outcome, reportedType,
  nodeId, nodeLabel, cellType, turn, tick, situationId,
  memoryBank = null,
  isDendriticReturn = false, cellId = null,
}) {
  const source = cellType === 'macrophage' ? SIGNAL_SOURCES.MACROPHAGE
               : cellType === 'dendritic'  ? SIGNAL_SOURCES.DENDRITIC
               : SIGNAL_SOURCES.NEUTROPHIL;

  let type, confidence, isFalseAlarm;

  switch (outcome) {
    case DETECTION_OUTCOMES.ANOMALY:
      type = SIGNAL_TYPES.ANOMALY_DETECTED;
      confidence = CONFIDENCE_LEVELS.LOW;
      isFalseAlarm = false;
      break;
    case DETECTION_OUTCOMES.THREAT_UNCLASSIFIED:
      type = SIGNAL_TYPES.THREAT_CONFIRMED;
      confidence = CONFIDENCE_LEVELS.MEDIUM;
      isFalseAlarm = false;
      break;
    case DETECTION_OUTCOMES.CORRECT_ID:
      type = SIGNAL_TYPES.THREAT_CONFIRMED;
      confidence = CONFIDENCE_LEVELS.HIGH;
      isFalseAlarm = false;
      break;
    case DETECTION_OUTCOMES.WRONG_ID:
      type = SIGNAL_TYPES.THREAT_CONFIRMED;
      confidence = CONFIDENCE_LEVELS.MEDIUM;
      isFalseAlarm = false;
      break;
    case DETECTION_OUTCOMES.CLEAR:
      type = SIGNAL_TYPES.PATROL_CLEAR;
      confidence = CONFIDENCE_LEVELS.MEDIUM;
      isFalseAlarm = false;
      break;
    case DETECTION_OUTCOMES.FALSE_ALARM:
      type = SIGNAL_TYPES.ANOMALY_DETECTED;
      confidence = CONFIDENCE_LEVELS.LOW;
      isFalseAlarm = true;
      break;
    default:
      return null;
  }

  let sig = makeSignal({
    nodeId, nodeLabel, type, confidence, source,
    isFalseAlarm, reportedThreatType: reportedType,
    detectionOutcome: outcome,
    isDendriticReturn, cellId,
    isSeeded: false, turn, tick, situationId,
  });

  if (memoryBank && reportedType) {
    sig = maybeApplyMemoryBonus(sig, memoryBank, reportedType);
  }

  return sig;
}

function maybeApplyMemoryBonus(signal, memoryBank, threatType) {
  if (!memoryBank || !threatType) return signal;
  return applyMemoryBonus(signal, memoryBank, threatType);
}

function signalExpiry(type, tick) {
  if (type === SIGNAL_TYPES.THREAT_CONFIRMED || type === SIGNAL_TYPES.THREAT_EXPANDING) {
    return ALERT_SIGNAL_TIMEOUT == null ? null : tick + ALERT_SIGNAL_TIMEOUT;
  }
  if (type === SIGNAL_TYPES.ANOMALY_DETECTED || type === SIGNAL_TYPES.COLLATERAL_DAMAGE) {
    return tick + WARNING_SIGNAL_TIMEOUT;
  }
  return INFO_SIGNAL_TIMEOUT == null ? null : tick + INFO_SIGNAL_TIMEOUT;
}

function makeSignal({
  nodeId, nodeLabel, type, confidence, source,
  isFalseAlarm, reportedThreatType = null, detectionOutcome = null,
  isDendriticReturn = false, cellId = null,
  isSeeded, turn, tick, situationId = 'primary',
}) {
  return {
    id: nextSignalId(),
    nodeId,
    // Minimal text — flavour layer parked for now
    text: buildSignalText(type, confidence, nodeLabel, reportedThreatType, detectionOutcome),
    type,
    confidence,
    source,
    isFalseAlarm,
    reportedThreatType,     // what the cell thinks it is (may be wrong for WRONG_ID)
    detectionOutcome,       // raw outcome for debugging / post-mortem
    isDendriticReturn,
    cellId,
    isSeeded,
    situationId,
    arrivedOnTurn: turn,
    arrivedAtTick: tick,
    expiresAtTick: signalExpiry(type, tick),
    routed: false,
    routingDecision: null,
    hasMemoryBonus: false,
  };
}

function buildSignalText(type, confidence, nodeLabel, reportedThreatType, detectionOutcome) {
  const loc = nodeLabel ?? 'Unknown';
  switch (detectionOutcome) {
    case DETECTION_OUTCOMES.ANOMALY:
      return `${loc} — anomaly detected, unclassified`;
    case DETECTION_OUTCOMES.THREAT_UNCLASSIFIED:
      return `${loc} — threat present, type unknown`;
    case DETECTION_OUTCOMES.CORRECT_ID:
      return `${loc} — ${reportedThreatType} confirmed`;
    case DETECTION_OUTCOMES.WRONG_ID:
      return `${loc} — ${reportedThreatType} confirmed`; // player can't tell it's wrong
    case DETECTION_OUTCOMES.CLEAR:
      return `${loc} — all clear`;
    case DETECTION_OUTCOMES.FALSE_ALARM:
      return `${loc} — anomaly detected, low confidence`;
    default:
      return `${loc} — ${type}`;
  }
}

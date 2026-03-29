// Signal Generator — translates ground truth into signals each turn.
// Organic signals only come from patrol/macrophage cells actively at nodes.
// Detection outcomes from detection.js determine what (if anything) they perceive.

import { NODES } from '../data/nodes.js';
import { SIGNAL_TYPES, SIGNAL_SOURCES, CONFIDENCE_LEVELS } from '../data/signals.js';
import { WARNING_SIGNAL_TIMEOUT, ALERT_SIGNAL_TIMEOUT, INFO_SIGNAL_TIMEOUT } from '../data/gameConfig.js';
import { rollDetection, DETECTION_OUTCOMES } from '../data/detection.js';
import { applyMemoryBonus } from './memory.js';

let _signalIdCounter = 1;
function nextSignalId() { return `sig_${_signalIdCounter++}`; }

/**
 * Generate signals for one simulation turn.
 * Signals come only from cells actively present at nodes (phase === 'arrived').
 *
 * @param {Object} groundTruth
 * @param {Object} deployedCells
 * @param {Object} runConfig     — replaces situationDef
 * @param {number} turn
 * @param {Object|null} memoryBank
 * @param {string} situationId
 * @param {number} tick
 */
export function generateSignals(
  groundTruth,
  deployedCells,
  runConfig,
  turn,
  memoryBank = null,
  situationId = 'primary',
  tick = 0,
  modifiers = null
) {
  const signals = [];
  const usedNodes = new Set();

  // ── 1. Per-cell detection rolls — arrived patrol/macrophage only ──────────
  // One signal per node per turn (first roll that produces a non-MISS wins).
  // En-route detection is handled separately via generateSignalsForVisits.
  for (const cell of Object.values(deployedCells)) {
    if (cell.phase !== 'arrived') continue;
    if (!['neutrophil', 'macrophage'].includes(cell.type)) continue;

    const nodeId = cell.nodeId;
    if (usedNodes.has(nodeId)) continue;

    const nodeState = groundTruth.nodeStates?.[nodeId] ?? {};
    const { actualThreatType, threatStrength } = dominantPathogenForDetection(nodeState);
    const inflammation = nodeState.inflammation ?? 0;

    const { outcome, reportedType } = rollDetection(cell.type, actualThreatType, threatStrength, inflammation, modifiers);
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
      turn, tick, situationId,
    }));
    usedNodes.add(nodeId);
  }

  return signals;
}

// ── Dendritic scout return ────────────────────────────────────────────────────
// Called from the TICK handler when a scout_arrived event fires.
// The scout gets ONE detection roll on arrival — result is definitive for that visit.

export function makeDendriticReturnSignal(cell, groundTruth, runConfig, tick, turn, situationId, modifiers = null) {
  const node = NODES[cell.nodeId];
  if (!node) return null;

  const nodeState = groundTruth.nodeStates?.[cell.nodeId] ?? {};
  const { actualThreatType, threatStrength } = dominantPathogenForDetection(nodeState);
  const inflammation = nodeState.inflammation ?? 0;

  const { outcome, reportedType } = rollDetection('dendritic', actualThreatType, threatStrength, inflammation, modifiers);

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
    const ns = groundTruth.nodeStates?.[nodeId];
    const { threatStrength } = dominantPathogenForDetection(ns ?? {});
    if (threatStrength > 0) {
      notices.push({
        nodeId, nodeLabel: node?.label,
        message: `Patrol at ${node?.label} — no confirmed report this turn.`,
        turn,
      });
    }
  }
  return notices;
}

// ── Helper: derive dominant threat for detection rolls ────────────────────────
// Maps new nodeState.pathogens structure → { actualThreatType, threatStrength }
// that the existing detection roll system understands.

import { getDominantPathogen } from '../data/pathogens.js';
import { PATHOGEN_SIGNAL_TYPE } from '../data/pathogens.js';

function dominantPathogenForDetection(nodeState) {
  const dominant = getDominantPathogen(nodeState);
  if (!dominant) return { actualThreatType: null, threatStrength: 0 };
  // Map pathogen type to signal vocabulary type
  const signalType = PATHOGEN_SIGNAL_TYPE[dominant.type] ?? dominant.type;
  return { actualThreatType: signalType, threatStrength: dominant.load };
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
    turn, tick, situationId,
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
  turn, tick, situationId = 'primary',
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
    situationId,
    arrivedOnTurn: turn,
    arrivedAtTick: tick,
    expiresAtTick: signalExpiry(type, tick),
    routed: false,
    routingDecision: null,
    hasMemoryBonus: false,
  };
}


// ── En-route detection for intermediate node visits ───────────────────────────
// Called with nodesVisited from advanceCells.
// Only recon cell types (neutrophil, macrophage, dendritic) generate signals.
// One signal per unique node per call (first recon cell wins).

export function generateSignalsForVisits(nodesVisited, groundTruth, turn, tick, situationId = 'primary', modifiers = null) {
  const RECON_TYPES = new Set(['neutrophil', 'macrophage', 'dendritic']);
  const signals = [];
  const seenNodes = new Set();

  for (const { cellType, nodeId } of nodesVisited) {
    if (!RECON_TYPES.has(cellType)) continue;
    if (seenNodes.has(nodeId)) continue;
    if (!NODES[nodeId]) continue;

    const nodeState = groundTruth.nodeStates?.[nodeId] ?? {};
    const { actualThreatType, threatStrength } = dominantPathogenForDetection(nodeState);
    const inflammation = nodeState.inflammation ?? 0;

    const { outcome, reportedType } = rollDetection(cellType, actualThreatType, threatStrength, inflammation, modifiers);
    if (outcome === DETECTION_OUTCOMES.MISS) continue;

    const sig = detectionOutcomeToSignal({
      outcome, reportedType,
      nodeId, nodeLabel: NODES[nodeId].label,
      cellType, turn, tick, situationId, memoryBank: null,
    });
    if (!sig) continue;

    signals.push(sig);
    seenNodes.add(nodeId);
  }

  return signals;
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

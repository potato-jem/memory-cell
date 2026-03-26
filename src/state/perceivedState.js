// Perceived state — the player's working model of the body.
// Tracks foreign entity signatures detected at each node.
// "Coherence" is now called "health" throughout.

export const THREAT_LEVELS = {
  NONE: 0,
  SUSPECTED: 1,
  CONFIRMED: 2,
  CRITICAL: 3,
};

export const NODE_STATUSES = {
  CLEAN: 'clean',
  WATCHING: 'watching',
  INVESTIGATING: 'investigating',
  SUSPECTED: 'suspected',
  CONFIRMED: 'confirmed',
  RESPONDING: 'responding',
  RESOLVED: 'resolved',
};

// Foreign entity classes — what the player thinks is at a node
export const ENTITY_CLASS = {
  UNKNOWN: 'unknown',           // anomalous signal, unclassified
  PATHOGEN: 'pathogen',         // confirmed threat
  SELF_LIKE: 'self_like',       // appears normal (mimic hiding, or genuinely clean)
  BENIGN: 'benign',             // false alarm confirmed
  INFLAMMATORY: 'inflammatory', // collateral / autoimmune activity
  CLASSIFIED: 'classified',     // dendritic confirmed — has a classifiedType
};

let _entityIdCounter = 1;
function nextEntityId() { return `fe_${_entityIdCounter++}`; }

export function initPerceivedState(nodeIds) {
  const nodes = {};
  for (const nodeId of nodeIds) {
    nodes[nodeId] = makeCleanNode();
  }
  return {
    nodes,
    signalsByNode: {},
    foreignEntitiesByNode: {}, // { [nodeId]: ForeignEntity[] }
    overallAssessment: 'monitoring',
  };
}

function makeCleanNode() {
  return {
    status: NODE_STATUSES.CLEAN,
    threatLevel: THREAT_LEVELS.NONE,
    responseLevel: 0,
    scoutConfirmed: false,
    signalsReceived: [],
    lastSignalTurn: null,
    quarantinedSignalIds: [],
    dismissedSignalIds: [],
  };
}

// ── Signal → perceived state ──────────────────────────────────────────────────

export function applySignalToPerceivedState(perceivedState, signal) {
  const nodeId = signal.nodeId;
  const current = perceivedState.nodes[nodeId] ?? makeCleanNode();

  const newThreatLevel = signalTypeToThreatLevel(signal.type, current.threatLevel);
  const newStatus = threatLevelToStatus(newThreatLevel, current);

  const updatedNode = {
    ...current,
    threatLevel: newThreatLevel,
    status: newStatus,
    signalsReceived: [...current.signalsReceived, signal.id],
    lastSignalTurn: signal.arrivedOnTurn,
  };

  // Update foreign entities
  const updatedEntities = applySignalToEntities(
    perceivedState.foreignEntitiesByNode[nodeId] ?? [],
    signal
  );

  return {
    ...perceivedState,
    nodes: { ...perceivedState.nodes, [nodeId]: updatedNode },
    signalsByNode: {
      ...perceivedState.signalsByNode,
      [nodeId]: [...(perceivedState.signalsByNode[nodeId] ?? []), signal.id],
    },
    foreignEntitiesByNode: {
      ...perceivedState.foreignEntitiesByNode,
      [nodeId]: updatedEntities,
    },
  };
}

function applySignalToEntities(existing, signal) {
  const turn = signal.arrivedOnTurn;

  // What entity class does this signal imply?
  const impliedClass = signalTypeToEntityClass(signal.type);
  if (!impliedClass) return existing; // patrol_clear on clean node adds nothing

  // Find an existing unresolved entity to update, or create new one
  const existingIdx = existing.findIndex(
    e => !e.isDismissed && e.perceivedClass === impliedClass
  );

  if (existingIdx >= 0) {
    // Update existing entity — upgrade confidence if signal is stronger
    const e = existing[existingIdx];
    const newConf = higherConfidence(e.confidence, signal.confidence);
    const updated = {
      ...e,
      confidence: newConf,
      lastUpdatedTurn: turn,
      signalIds: [...e.signalIds, signal.id],
    };
    return existing.map((item, i) => i === existingIdx ? updated : item);
  }

  // Create new entity
  const entity = {
    id: nextEntityId(),
    nodeId: signal.nodeId,
    confidence: signal.confidence,
    perceivedClass: impliedClass,
    classifiedType: null,     // set by dendritic return
    firstSeenTurn: turn,
    lastUpdatedTurn: turn,
    signalIds: [signal.id],
    isDismissed: false,
    isResolved: false,
    // For mimic: self_like entities look reassuring — that's the deception
    displayLabel: entityDisplayLabel(impliedClass, null, signal.confidence),
  };

  return [...existing, entity];
}

// ── Routing decisions ─────────────────────────────────────────────────────────

export function applyDismissSignal(perceivedState, signal) {
  const nodeId = signal.nodeId;
  const current = perceivedState.nodes[nodeId] ?? makeCleanNode();

  // Downgrade threat level
  const newThreatLevel = Math.max(THREAT_LEVELS.NONE, current.threatLevel - 1);
  const updatedNode = {
    ...current,
    threatLevel: newThreatLevel,
    status: newThreatLevel === THREAT_LEVELS.NONE ? NODE_STATUSES.CLEAN : current.status,
    dismissedSignalIds: [...(current.dismissedSignalIds ?? []), signal.id],
  };

  return {
    ...perceivedState,
    nodes: { ...perceivedState.nodes, [nodeId]: updatedNode },
  };
}

export function applyHoldSignal(perceivedState, signal) {
  const nodeId = signal.nodeId;
  const current = perceivedState.nodes[nodeId] ?? makeCleanNode();
  const updatedNode = {
    ...current,
    status: current.status === NODE_STATUSES.CLEAN ? NODE_STATUSES.WATCHING : current.status,
    quarantinedSignalIds: [...(current.quarantinedSignalIds ?? []), signal.id],
  };
  return {
    ...perceivedState,
    nodes: { ...perceivedState.nodes, [nodeId]: updatedNode },
  };
}

export function applyRoutingDecision(perceivedState, signal, decision) {
  if (decision === 'dismiss') return applyDismissSignal(perceivedState, signal);
  if (decision === 'hold') return applyHoldSignal(perceivedState, signal);
  // Legacy support
  if (decision === 'suppress') return applyDismissSignal(perceivedState, signal);
  if (decision === 'quarantine') return applyHoldSignal(perceivedState, signal);
  return perceivedState;
}

// ── Dendritic return ──────────────────────────────────────────────────────────

export function applyDendriticReturn(perceivedState, nodeId, foundThreat, threatType) {
  const current = perceivedState.nodes[nodeId] ?? makeCleanNode();

  const updatedNode = {
    ...current,
    scoutConfirmed: true,
    status: foundThreat ? NODE_STATUSES.CONFIRMED : NODE_STATUSES.RESOLVED,
    threatLevel: foundThreat ? THREAT_LEVELS.CONFIRMED : THREAT_LEVELS.NONE,
  };

  // Resolve all foreign entities at this node with the scout's findings
  const existingEntities = perceivedState.foreignEntitiesByNode[nodeId] ?? [];
  const resolvedEntities = existingEntities.map(e => {
    if (e.isDismissed) return e;
    return {
      ...e,
      confidence: 'high',
      perceivedClass: foundThreat ? ENTITY_CLASS.CLASSIFIED : ENTITY_CLASS.BENIGN,
      classifiedType: foundThreat ? threatType : null,
      isResolved: !foundThreat,
      displayLabel: entityDisplayLabel(
        foundThreat ? ENTITY_CLASS.CLASSIFIED : ENTITY_CLASS.BENIGN,
        foundThreat ? threatType : null,
        'high'
      ),
    };
  });

  // If found threat but no prior entity, add one now
  if (foundThreat && resolvedEntities.length === 0) {
    resolvedEntities.push({
      id: nextEntityId(),
      nodeId,
      confidence: 'high',
      perceivedClass: ENTITY_CLASS.CLASSIFIED,
      classifiedType: threatType,
      firstSeenTurn: 0,
      lastUpdatedTurn: 0,
      signalIds: [],
      isDismissed: false,
      isResolved: false,
      displayLabel: entityDisplayLabel(ENTITY_CLASS.CLASSIFIED, threatType, 'high'),
    });
  }

  return {
    ...perceivedState,
    nodes: { ...perceivedState.nodes, [nodeId]: updatedNode },
    foreignEntitiesByNode: {
      ...perceivedState.foreignEntitiesByNode,
      [nodeId]: resolvedEntities,
    },
  };
}

// ── Cell deployment → perceived state ────────────────────────────────────────

export function applyResponderDeployed(perceivedState, nodeId) {
  const current = perceivedState.nodes[nodeId] ?? makeCleanNode();
  return {
    ...perceivedState,
    nodes: {
      ...perceivedState.nodes,
      [nodeId]: {
        ...current,
        status: NODE_STATUSES.RESPONDING,
        responseLevel: Math.min(3, (current.responseLevel ?? 0) + 1),
      },
    },
  };
}

export function applyNeutrophilDeployed(perceivedState, nodeId) {
  const current = perceivedState.nodes[nodeId] ?? makeCleanNode();
  return {
    ...perceivedState,
    nodes: {
      ...perceivedState.nodes,
      [nodeId]: {
        ...current,
        status: current.status === NODE_STATUSES.CLEAN ? NODE_STATUSES.WATCHING : current.status,
        responseLevel: Math.max(1, current.responseLevel ?? 0),
      },
    },
  };
}

// ── Entity dismissal ──────────────────────────────────────────────────────────

export function dismissEntity(perceivedState, nodeId, entityId) {
  const entities = perceivedState.foreignEntitiesByNode[nodeId] ?? [];
  const updated = entities.map(e => e.id === entityId ? { ...e, isDismissed: true } : e);
  return {
    ...perceivedState,
    foreignEntitiesByNode: { ...perceivedState.foreignEntitiesByNode, [nodeId]: updated },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function signalTypeToEntityClass(signalType) {
  const map = {
    anomaly_detected: ENTITY_CLASS.UNKNOWN,
    threat_confirmed: ENTITY_CLASS.PATHOGEN,
    threat_expanding: ENTITY_CLASS.PATHOGEN,
    collateral_damage: ENTITY_CLASS.INFLAMMATORY,
    patrol_clear: ENTITY_CLASS.SELF_LIKE,  // mimic hides behind these
    false_alarm: null,                     // don't add entity for explicit false alarms
    resolution: null,
  };
  return map[signalType] ?? null;
}

function signalTypeToThreatLevel(signalType, currentLevel) {
  const escalation = {
    patrol_clear: THREAT_LEVELS.NONE,
    anomaly_detected: Math.max(currentLevel, THREAT_LEVELS.SUSPECTED),
    threat_confirmed: Math.max(currentLevel, THREAT_LEVELS.CONFIRMED),
    threat_expanding: THREAT_LEVELS.CRITICAL,
    collateral_damage: currentLevel,
    false_alarm: THREAT_LEVELS.NONE,
    resolution: THREAT_LEVELS.NONE,
  };
  return escalation[signalType] ?? currentLevel;
}

function threatLevelToStatus(threatLevel, current) {
  if (current.scoutConfirmed) return NODE_STATUSES.CONFIRMED;
  if (current.responseLevel > 0) return NODE_STATUSES.RESPONDING;
  switch (threatLevel) {
    case THREAT_LEVELS.NONE: return NODE_STATUSES.CLEAN;
    case THREAT_LEVELS.SUSPECTED: return NODE_STATUSES.SUSPECTED;
    case THREAT_LEVELS.CONFIRMED: return NODE_STATUSES.CONFIRMED;
    case THREAT_LEVELS.CRITICAL: return NODE_STATUSES.CONFIRMED;
    default: return NODE_STATUSES.CLEAN;
  }
}

function higherConfidence(a, b) {
  const order = { low: 0, medium: 1, high: 2 };
  return (order[a] ?? 0) >= (order[b] ?? 0) ? a : b;
}

export function entityDisplayLabel(perceivedClass, classifiedType, confidence) {
  if (perceivedClass === ENTITY_CLASS.CLASSIFIED && classifiedType) {
    const typeNames = {
      bacterial: 'Bacterial pathogen',
      viral: 'Viral infection',
      cancer: 'Malignant growth',
      autoimmune: 'Self-reactive cascade',
      mimic: 'Molecular mimic',
    };
    return typeNames[classifiedType] ?? `Pathogen (${classifiedType})`;
  }
  const classLabels = {
    [ENTITY_CLASS.UNKNOWN]: 'Unknown signature',
    [ENTITY_CLASS.PATHOGEN]: 'Unclassified pathogen',
    [ENTITY_CLASS.SELF_LIKE]: 'Normal tissue',
    [ENTITY_CLASS.BENIGN]: 'Benign variation',
    [ENTITY_CLASS.INFLAMMATORY]: 'Inflammatory activity',
    [ENTITY_CLASS.CLASSIFIED]: 'Pathogen (classified)',
  };
  return classLabels[perceivedClass] ?? 'Unknown';
}

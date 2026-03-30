// Perceived state — the player's working model of the body.
// Tracks foreign entity signatures detected at each node.
// "Coherence" is now called "health" throughout.

export const THREAT_LEVELS = {
  NONE: 0,
  SUSPECTED: 1,
  CONFIRMED: 2,
  CRITICAL: 3,
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

  const updatedNode = {
    ...current,
    threatLevel: newThreatLevel,
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

// Rank used to determine if an entity should be upgraded
function classRank(cls) {
  const ranks = {
    [ENTITY_CLASS.UNKNOWN]: 1,
    [ENTITY_CLASS.INFLAMMATORY]: 1,
    [ENTITY_CLASS.PATHOGEN]: 2,
    [ENTITY_CLASS.CLASSIFIED]: 3,
    [ENTITY_CLASS.BENIGN]: 3,
    [ENTITY_CLASS.SELF_LIKE]: 0,
  };
  return ranks[cls] ?? 0;
}

function applySignalToEntities(existing, signal) {
  const turn = signal.arrivedOnTurn;
  const impliedClass = signalTypeToEntityClass(signal.type);
  if (!impliedClass || impliedClass === ENTITY_CLASS.SELF_LIKE) return existing;

  const impliedRank = classRank(impliedClass);

  // Find any active (non-dismissed, non-resolved) entity to potentially upgrade
  const existingIdx = existing.findIndex(e => !e.isDismissed && !e.isResolved);

  if (existingIdx >= 0) {
    const e = existing[existingIdx];
    const currentRank = classRank(e.perceivedClass);
    const isUpgrade = impliedRank > currentRank;
    const updated = {
      ...e,
      ...(isUpgrade ? { perceivedClass: impliedClass, levelSince: turn } : {}),
      lastUpdatedTurn: turn,
      signalIds: [...e.signalIds, signal.id],
    };
    return existing.map((item, i) => i === existingIdx ? updated : item);
  }

  // Create new entity
  return [...existing, {
    id: nextEntityId(),
    nodeId: signal.nodeId,
    perceivedClass: impliedClass,
    classifiedType: null,
    firstSeenTurn: turn,
    levelSince: turn,
    lastUpdatedTurn: turn,
    signalIds: [signal.id],
    isDismissed: false,
    isResolved: false,
    displayLabel: entityDisplayLabel(impliedClass, null, null),
  }];
}

// ── Dendritic return ──────────────────────────────────────────────────────────

export function applyDendriticReturn(perceivedState, nodeId, foundThreat, threatType, turn = 0) {
  const current = perceivedState.nodes[nodeId] ?? makeCleanNode();

  const updatedNode = {
    ...current,
    scoutConfirmed: true,
    threatLevel: foundThreat ? THREAT_LEVELS.CONFIRMED : THREAT_LEVELS.NONE,
  };

  const newClass = foundThreat ? ENTITY_CLASS.CLASSIFIED : ENTITY_CLASS.BENIGN;

  // Resolve all active entities with the scout's findings
  const existingEntities = perceivedState.foreignEntitiesByNode[nodeId] ?? [];
  const resolvedEntities = existingEntities.map(e => {
    if (e.isDismissed) return e;
    return {
      ...e,
      perceivedClass: newClass,
      classifiedType: foundThreat ? threatType : null,
      levelSince: turn,
      lastUpdatedTurn: turn,
      isResolved: !foundThreat,
      displayLabel: entityDisplayLabel(newClass, foundThreat ? threatType : null, null),
    };
  });

  // If found threat but no prior entity, create one
  if (foundThreat && resolvedEntities.length === 0) {
    resolvedEntities.push({
      id: nextEntityId(),
      nodeId,
      perceivedClass: ENTITY_CLASS.CLASSIFIED,
      classifiedType: threatType,
      firstSeenTurn: turn,
      levelSince: turn,
      lastUpdatedTurn: turn,
      signalIds: [],
      isDismissed: false,
      isResolved: false,
      displayLabel: entityDisplayLabel(ENTITY_CLASS.CLASSIFIED, threatType, null),
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

export function entityDisplayLabel(perceivedClass, classifiedType) {
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

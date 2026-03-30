// Perceived state — the player's working model of the body.
// Detection outcomes update this directly; there are no intermediate signal objects.

export const THREAT_LEVELS = {
  NONE: 0,
  SUSPECTED: 1,
  CONFIRMED: 2,
  CRITICAL: 3,
};

// Foreign entity classes — what the player thinks is at a node
export const ENTITY_CLASS = {
  UNKNOWN: 'unknown',           // anomalous, unclassified
  PATHOGEN: 'pathogen',         // confirmed threat, type unknown
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
    foreignEntitiesByNode: {},
    overallAssessment: 'monitoring',
  };
}

function makeCleanNode() {
  return {
    threatLevel: THREAT_LEVELS.NONE,
    responseLevel: 0,
    scoutConfirmed: false,
    lastSeenTurn: null,
  };
}

// ── Detection outcome → perceived state ───────────────────────────────────────
// Called directly from the turn handler after each detection roll.
// `outcome` is a DETECTION_OUTCOMES value (string); `reportedType` is null or a
// pathogen signal type string (what the cell thinks it is — may be wrong for WRONG_ID).

export function applyDetectionOutcome(perceivedState, nodeId, outcome, reportedType, turn) {
  const current = perceivedState.nodes[nodeId] ?? makeCleanNode();

  let newThreatLevel = current.threatLevel;
  let entityClass = null;
  let classifiedType = null;

  switch (outcome) {
    case 'anomaly':
    case 'false_alarm':
      newThreatLevel = Math.max(current.threatLevel, THREAT_LEVELS.SUSPECTED);
      entityClass = ENTITY_CLASS.UNKNOWN;
      break;
    case 'threat_unclassified':
      newThreatLevel = Math.max(current.threatLevel, THREAT_LEVELS.CONFIRMED);
      entityClass = ENTITY_CLASS.PATHOGEN;
      break;
    case 'correct_id':
    case 'wrong_id':
      newThreatLevel = Math.max(current.threatLevel, THREAT_LEVELS.CONFIRMED);
      entityClass = ENTITY_CLASS.CLASSIFIED;
      classifiedType = reportedType;
      break;
    case 'clear':
      newThreatLevel = THREAT_LEVELS.NONE;
      break;
    default:
      return perceivedState;
  }

  const updatedNode = { ...current, threatLevel: newThreatLevel, lastSeenTurn: turn };

  let entities = perceivedState.foreignEntitiesByNode[nodeId] ?? [];
  if (outcome === 'clear') {
    entities = entities.map(e => e.isDismissed ? e : { ...e, isResolved: true });
  } else if (entityClass) {
    entities = updateOrCreateEntity(entities, nodeId, entityClass, classifiedType, turn);
  }

  return {
    ...perceivedState,
    nodes: { ...perceivedState.nodes, [nodeId]: updatedNode },
    foreignEntitiesByNode: { ...perceivedState.foreignEntitiesByNode, [nodeId]: entities },
  };
}

// Called when a patrol/macrophage at an inflamed node sees no threat.
// Only adds an INFLAMMATORY entity if no active threat entity already exists.
export function applyCollateralDamageObservation(perceivedState, nodeId, turn) {
  const current = perceivedState.nodes[nodeId] ?? makeCleanNode();
  const entities = perceivedState.foreignEntitiesByNode[nodeId] ?? [];

  const hasActiveThreat = entities.some(e =>
    !e.isDismissed && !e.isResolved &&
    (e.perceivedClass === ENTITY_CLASS.PATHOGEN || e.perceivedClass === ENTITY_CLASS.CLASSIFIED)
  );
  if (hasActiveThreat) return perceivedState;

  const updatedEntities = updateOrCreateEntity(entities, nodeId, ENTITY_CLASS.INFLAMMATORY, null, turn);
  return {
    ...perceivedState,
    nodes: { ...perceivedState.nodes, [nodeId]: { ...current, lastSeenTurn: turn } },
    foreignEntitiesByNode: { ...perceivedState.foreignEntitiesByNode, [nodeId]: updatedEntities },
  };
}

// ── Dendritic return ──────────────────────────────────────────────────────────

export function applyDendriticReturn(perceivedState, nodeId, foundThreat, threatType, turn = 0) {
  const current = perceivedState.nodes[nodeId] ?? makeCleanNode();

  const updatedNode = {
    ...current,
    scoutConfirmed: true,
    threatLevel: foundThreat ? THREAT_LEVELS.CONFIRMED : THREAT_LEVELS.NONE,
    lastSeenTurn: turn,
  };

  const newClass = foundThreat ? ENTITY_CLASS.CLASSIFIED : ENTITY_CLASS.BENIGN;

  const existingEntities = perceivedState.foreignEntitiesByNode[nodeId] ?? [];
  let resolvedEntities = existingEntities.map(e => {
    if (e.isDismissed) return e;
    return {
      ...e,
      perceivedClass: newClass,
      classifiedType: foundThreat ? threatType : null,
      levelSince: turn,
      lastUpdatedTurn: turn,
      isResolved: !foundThreat,
      displayLabel: entityDisplayLabel(newClass, foundThreat ? threatType : null),
    };
  });

  if (foundThreat && resolvedEntities.length === 0) {
    resolvedEntities = [{
      id: nextEntityId(),
      nodeId,
      perceivedClass: ENTITY_CLASS.CLASSIFIED,
      classifiedType: threatType,
      firstSeenTurn: turn,
      levelSince: turn,
      lastUpdatedTurn: turn,
      isDismissed: false,
      isResolved: false,
      displayLabel: entityDisplayLabel(ENTITY_CLASS.CLASSIFIED, threatType),
    }];
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
      [nodeId]: { ...current, responseLevel: Math.min(3, (current.responseLevel ?? 0) + 1) },
    },
  };
}

export function applyNeutrophilDeployed(perceivedState, nodeId) {
  const current = perceivedState.nodes[nodeId] ?? makeCleanNode();
  return {
    ...perceivedState,
    nodes: {
      ...perceivedState.nodes,
      [nodeId]: { ...current, responseLevel: Math.max(1, current.responseLevel ?? 0) },
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

// Rank used to determine if an entity should be upgraded
function classRank(cls) {
  return { unknown: 1, inflammatory: 1, pathogen: 2, classified: 3, benign: 3, self_like: 0 }[cls] ?? 0;
}

function updateOrCreateEntity(existing, nodeId, impliedClass, classifiedType, turn) {
  if (!impliedClass || impliedClass === ENTITY_CLASS.SELF_LIKE) return existing;

  const impliedRank = classRank(impliedClass);
  const existingIdx = existing.findIndex(e => !e.isDismissed && !e.isResolved);

  if (existingIdx >= 0) {
    const e = existing[existingIdx];
    const isUpgrade = impliedRank > classRank(e.perceivedClass);
    const updated = {
      ...e,
      ...(isUpgrade ? {
        perceivedClass: impliedClass,
        classifiedType: classifiedType ?? e.classifiedType,
        levelSince: turn,
        displayLabel: entityDisplayLabel(impliedClass, classifiedType ?? e.classifiedType),
      } : {}),
      lastUpdatedTurn: turn,
    };
    return existing.map((item, i) => i === existingIdx ? updated : item);
  }

  return [...existing, {
    id: nextEntityId(),
    nodeId,
    perceivedClass: impliedClass,
    classifiedType: classifiedType ?? null,
    firstSeenTurn: turn,
    levelSince: turn,
    lastUpdatedTurn: turn,
    isDismissed: false,
    isResolved: false,
    displayLabel: entityDisplayLabel(impliedClass, classifiedType ?? null),
  }];
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
  return {
    [ENTITY_CLASS.UNKNOWN]: 'Unknown signature',
    [ENTITY_CLASS.PATHOGEN]: 'Unclassified pathogen',
    [ENTITY_CLASS.SELF_LIKE]: 'Normal tissue',
    [ENTITY_CLASS.BENIGN]: 'Benign variation',
    [ENTITY_CLASS.INFLAMMATORY]: 'Inflammatory activity',
    [ENTITY_CLASS.CLASSIFIED]: 'Pathogen (classified)',
  }[perceivedClass] ?? 'Unknown';
}

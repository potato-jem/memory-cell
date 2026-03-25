// Perceived state — the player's working model of the body.
// Updated by signal arrivals and routing decisions.
// Never contains ground truth data directly.

export const THREAT_LEVELS = {
  NONE: 0,
  SUSPECTED: 1,
  CONFIRMED: 2,
  CRITICAL: 3,
};

export const NODE_STATUSES = {
  CLEAN: 'clean',
  WATCHING: 'watching',        // signals received but inconclusive
  INVESTIGATING: 'investigating', // dendritic cell en route
  SUSPECTED: 'suspected',      // threat suspected
  CONFIRMED: 'confirmed',      // threat confirmed
  RESPONDING: 'responding',    // responder deployed
  RESOLVED: 'resolved',        // threat cleared (from player perspective)
};

/**
 * Initialise perceived state for all nodes.
 */
export function initPerceivedState(nodeIds) {
  const nodes = {};
  for (const nodeId of nodeIds) {
    nodes[nodeId] = makeCleanNode();
  }

  return {
    nodes,
    signalsByNode: {},   // { [nodeId]: signalId[] }
    overallAssessment: 'monitoring',
  };
}

function makeCleanNode() {
  return {
    status: NODE_STATUSES.CLEAN,
    threatLevel: THREAT_LEVELS.NONE,
    responseLevel: 0,         // 0 = none, 1 = patrol, 2 = responder
    scoutConfirmed: false,    // true if dendritic cell has returned from here
    signalsReceived: [],      // signal IDs received from this node
    lastSignalTurn: null,
    playerNotes: '',          // free-form (future feature hook)
    quarantinedSignalIds: [], // signals player put in quarantine from this node
  };
}

/**
 * Update perceived state when a new signal arrives.
 * Returns updated perceived state.
 */
export function applySignalToPerceivedState(perceivedState, signal) {
  const nodeId = signal.nodeId;
  const current = perceivedState.nodes[nodeId] ?? makeCleanNode();

  // Update threat level based on signal type
  const newThreatLevel = signalTypeToThreatLevel(signal.type, current.threatLevel);
  const newStatus = threatLevelToStatus(newThreatLevel, current);

  const updatedNode = {
    ...current,
    threatLevel: newThreatLevel,
    status: newStatus,
    signalsReceived: [...current.signalsReceived, signal.id],
    lastSignalTurn: signal.arrivedOnTurn,
  };

  return {
    ...perceivedState,
    nodes: {
      ...perceivedState.nodes,
      [nodeId]: updatedNode,
    },
    signalsByNode: {
      ...perceivedState.signalsByNode,
      [nodeId]: [...(perceivedState.signalsByNode[nodeId] ?? []), signal.id],
    },
  };
}

/**
 * Update perceived state when the player makes a routing decision.
 */
export function applyRoutingDecision(perceivedState, signal, decision) {
  const nodeId = signal.nodeId;
  const current = perceivedState.nodes[nodeId] ?? makeCleanNode();

  let updatedNode = { ...current };

  switch (decision) {
    case 'forward':
      // Forwarding escalates our working model
      updatedNode.threatLevel = Math.min(
        THREAT_LEVELS.CONFIRMED,
        current.threatLevel + 1
      );
      updatedNode.status = threatLevelToStatus(updatedNode.threatLevel, updatedNode);
      break;

    case 'amplify':
      // Amplify marks as critical concern
      updatedNode.threatLevel = THREAT_LEVELS.CRITICAL;
      updatedNode.status = NODE_STATUSES.CONFIRMED;
      break;

    case 'suppress':
      // Suppress downgrades our concern
      updatedNode.threatLevel = Math.max(
        THREAT_LEVELS.NONE,
        current.threatLevel - 1
      );
      if (updatedNode.threatLevel === THREAT_LEVELS.NONE) {
        updatedNode.status = NODE_STATUSES.CLEAN;
      }
      break;

    case 'quarantine':
      // Quarantine: note signal but defer assessment
      updatedNode.quarantinedSignalIds = [
        ...updatedNode.quarantinedSignalIds,
        signal.id,
      ];
      if (updatedNode.status === NODE_STATUSES.CLEAN) {
        updatedNode.status = NODE_STATUSES.WATCHING;
      }
      break;

    default:
      break;
  }

  return {
    ...perceivedState,
    nodes: {
      ...perceivedState.nodes,
      [nodeId]: updatedNode,
    },
  };
}

/**
 * Update perceived state when a dendritic cell returns from a node.
 */
export function applyDendriticReturn(perceivedState, nodeId, foundThreat, signalType) {
  const current = perceivedState.nodes[nodeId] ?? makeCleanNode();

  const updatedNode = {
    ...current,
    scoutConfirmed: true,
    status: foundThreat ? NODE_STATUSES.CONFIRMED : NODE_STATUSES.RESOLVED,
    threatLevel: foundThreat ? THREAT_LEVELS.CONFIRMED : THREAT_LEVELS.NONE,
  };

  return {
    ...perceivedState,
    nodes: {
      ...perceivedState.nodes,
      [nodeId]: updatedNode,
    },
  };
}

/**
 * Update perceived state when a responder is deployed.
 */
export function applyResponderDeployed(perceivedState, nodeId) {
  const current = perceivedState.nodes[nodeId] ?? makeCleanNode();

  const updatedNode = {
    ...current,
    status: NODE_STATUSES.RESPONDING,
    responseLevel: Math.min(3, (current.responseLevel ?? 0) + 1),
  };

  return {
    ...perceivedState,
    nodes: {
      ...perceivedState.nodes,
      [nodeId]: updatedNode,
    },
  };
}

/**
 * Update perceived state when neutrophil patrol is deployed.
 */
export function applyNeutrophilDeployed(perceivedState, nodeId) {
  const current = perceivedState.nodes[nodeId] ?? makeCleanNode();

  const updatedNode = {
    ...current,
    status: current.status === NODE_STATUSES.CLEAN
      ? NODE_STATUSES.WATCHING
      : current.status,
    responseLevel: Math.max(1, current.responseLevel ?? 0),
  };

  return {
    ...perceivedState,
    nodes: {
      ...perceivedState.nodes,
      [nodeId]: updatedNode,
    },
  };
}

function signalTypeToThreatLevel(signalType, currentLevel) {
  const escalation = {
    patrol_clear: THREAT_LEVELS.NONE,
    anomaly_detected: Math.max(currentLevel, THREAT_LEVELS.SUSPECTED),
    threat_confirmed: Math.max(currentLevel, THREAT_LEVELS.CONFIRMED),
    threat_expanding: THREAT_LEVELS.CRITICAL,
    collateral_damage: currentLevel,  // doesn't change threat assessment
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

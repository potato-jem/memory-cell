/**
 * simulation/strategies.js
 *
 * Built-in strategy implementations for comparative balance testing.
 *
 * A strategy is a function: (gameState) => action
 * Called each step until it returns { type: 'END_TURN' }.
 * The engine enforces a per-turn action limit so misbehaving strategies
 * cannot loop forever.
 *
 * Strategies here are intentionally simple baselines, not good players.
 *
 * Exported strategies:
 *   randomStrategy       — picks uniformly from all legal actions each call
 *   greedyThreatStrategy — deploys responders to highest-threat node, then ends turn
 *   conservativeStrategy — maintains patrol coverage; avoids fever; preserves tokens
 */

import { ACTION_TYPES } from '../src/state/actions.js';
import { CELL_CONFIG } from '../src/data/cellConfig.js';
import { NODE_IDS, NODES } from '../src/data/nodes.js';
import { nodeHasClassifiedPathogen } from '../src/engine/cells.js';

// ── Legal action enumeration ──────────────────────────────────────────────────

/**
 * Returns all currently valid non-END_TURN actions given the game state.
 * Used by strategies that want to enumerate possibilities.
 */
function getLegalDeployActions(state) {
  const { deployedCells, attentionTokens, groundTruth } = state;
  const nodeStates = groundTruth?.nodeStates ?? {};
  const actions = [];

  for (const [cellId, cell] of Object.entries(deployedCells)) {
    if (cell.phase !== 'ready' && cell.phase !== 'arrived') continue;

    for (const nodeId of NODE_IDS) {
      // Skip if already at this node
      if (cell.phase === 'arrived' && cell.nodeId === nodeId) continue;

      // Killer T requires a classified pathogen at destination
      if (CELL_CONFIG[cell.type]?.requiresClassified) {
        if (!nodeHasClassifiedPathogen(nodeId, nodeStates)) continue;
      }

      actions.push({ type: ACTION_TYPES.DEPLOY_FROM_ROSTER, cellId, nodeId });
    }
  }

  return actions;
}

function getLegalTrainActions(state) {
  const { attentionTokens } = state;
  const actions = [];

  for (const [cellType, cfg] of Object.entries(CELL_CONFIG)) {
    if ((cfg.deployCost ?? 1) <= attentionTokens) {
      actions.push({ type: ACTION_TYPES.TRAIN_CELL, cellType });
    }
  }

  return actions;
}

function getLegalRecallActions(state) {
  return Object.entries(state.deployedCells)
    .filter(([, c]) => c.phase === 'outbound' || c.phase === 'arrived')
    .map(([cellId]) => ({ type: ACTION_TYPES.RECALL_UNIT, cellId }));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getReadyCells(state) {
  return Object.values(state.deployedCells).filter(c => c.phase === 'ready');
}

function getArrivedCells(state) {
  return Object.values(state.deployedCells).filter(c => c.phase === 'arrived');
}

/**
 * Highest-priority node with a detected pathogen, using perceived values.
 * Works correctly whether the state is masked (perceived) or omniscient (full GT).
 *
 * Priority: classified > misclassified > threat > unknown
 * Within classified/misclassified: sorts by estimatedLoad (lastKnownLoad) desc,
 * falling back to actualLoad if present (omniscient mode).
 */
function getHighestThreatNode(state) {
  const nodeStates = state.groundTruth?.nodeStates ?? {};

  // Detection level → numeric priority (higher = more urgent to respond to)
  const LEVEL_PRIORITY = { classified: 4, misclassified: 3, threat: 2, unknown: 1, none: 0 };

  let best = null;
  let bestScore = -1;

  for (const [nodeId, ns] of Object.entries(nodeStates)) {
    for (const p of (ns.pathogens ?? [])) {
      const level = p.detected_level ?? 'none';
      if (level === 'none') continue;

      const priority = LEVEL_PRIORITY[level] ?? 0;
      // Use estimatedLoad (masked) or actualLoad (omniscient), normalised to 0-1
      const load = (p.estimatedLoad ?? p.actualLoad ?? 50) / 100;
      const score = priority + load; // priority dominates; load breaks ties

      if (score > bestScore) {
        bestScore = score;
        best = nodeId;
      }
    }
  }

  return best;
}

/** All nodes that have any active pathogen. */
function getInfectedNodes(state) {
  const nodeStates = state.groundTruth?.nodeStates ?? {};
  return Object.entries(nodeStates)
    .filter(([, ns]) => (ns.pathogens ?? []).length > 0)
    .map(([id]) => id);
}

/**
 * Best ready cell that can clear pathogenType, using PATHOGEN_CLEARERS (sorted by
 * clearanceRate desc). Respects requiresClassified — skips killer_t unless
 * detectedLevel is 'classified'.
 */
function getBestReadyCellForType(state, pathogenType, detectedLevel) {
  const clearers = PATHOGEN_CLEARERS[pathogenType] ?? [];
  for (const { cellType, clearanceRate } of clearers) {
    if (clearanceRate <= 0) continue;
    if (CELL_CONFIG[cellType]?.requiresClassified && detectedLevel !== 'classified') continue;
    const cell = Object.values(state.deployedCells).find(
      c => c.phase === 'ready' && c.type === cellType
    );
    if (cell) return cell;
  }
  return null;
}

/**
 * Train action for the best cell that can clear pathogenType, if tokens allow.
 * Picks the highest-clearanceRate type the player can currently afford.
 */
function getTrainActionForType(state, pathogenType, detectedLevel) {
  const clearers = PATHOGEN_CLEARERS[pathogenType] ?? [];
  for (const { cellType, clearanceRate } of clearers) {
    if (clearanceRate <= 0) continue;
    if (CELL_CONFIG[cellType]?.requiresClassified && detectedLevel !== 'classified') continue;
    const cost = CELL_CONFIG[cellType]?.deployCost ?? 1;
    if (state.attentionTokens >= cost) {
      return { type: ACTION_TYPES.TRAIN_CELL, cellType };
    }
  }
  return null;
}

/** Best recon cell available in the ready pool. */
function getBestReconCell(state) {
  const candidates = Object.values(state.deployedCells).filter(c => {
    if (c.phase !== 'ready') return false;
    return CELL_CONFIG[c.type]?.isRecon;
  });
  // Prefer macrophage over neutrophil (higher detection rolls) by deployCost as proxy
  return candidates.sort((a, b) =>
    (CELL_CONFIG[b.type]?.deployCost ?? 0) - (CELL_CONFIG[a.type]?.deployCost ?? 0)
  )[0] ?? null;
}

// ── Strategy 1: Random ────────────────────────────────────────────────────────

/**
 * Chooses uniformly from all legal actions each step.
 * END_TURN is always in the action pool, so the game will eventually advance.
 * No state is kept between calls; each call is fully stateless.
 */
export function randomStrategy(gameState) {
  const pool = [
    { type: ACTION_TYPES.END_TURN },
    ...getLegalDeployActions(gameState),
    ...getLegalTrainActions(gameState),
    // Deliberately exclude RECALL and TOGGLE_FEVER to keep the action space clean
    // (random recalls + re-deploys create a lot of noise without informational value)
  ];

  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Strategy 2: Greedy threat ─────────────────────────────────────────────────

/**
 * Respond to known threats as aggressively as possible; scout when blind.
 *
 * Works on perceived state (masked) — only acts on detected pathogens.
 * Priority order each turn:
 *   1. Deploy best attack cell to highest-priority detected threat
 *   2. Deploy recon to a threat node that still needs scouting
 *   3. Deploy recon to the most stale unvisited node (proactive scouting)
 *   4. Train a neutrophil if tokens available and nothing else to do
 *   5. End turn
 */
export function greedyThreatStrategy(gameState) {
  const nodeStates = gameState.groundTruth?.nodeStates ?? {};
  const threatNode = getHighestThreatNode(gameState);

  // 1. Deploy type-matched cell to the top classified threat; train if none ready
  if (threatNode) {
    const ns = nodeStates[threatNode];
    const classifiedP = (ns?.pathogens ?? []).find(
      p => (p.detected_level === 'classified' || p.detected_level === 'misclassified') && p.perceived_type
    );
    if (classifiedP) {
      const cell = getBestReadyCellForType(gameState, classifiedP.perceived_type, classifiedP.detected_level);
      if (cell) {
        return { type: ACTION_TYPES.DEPLOY_FROM_ROSTER, cellId: cell.id, nodeId: threatNode };
      }
      const trainAction = getTrainActionForType(gameState, classifiedP.perceived_type, classifiedP.detected_level);
      if (trainAction) return trainAction;
    }
  }

  // 2. Send recon to a threat node where pathogens are still unclassified
  const unconfimedThreat = Object.entries(nodeStates).find(([, ns]) =>
    (ns.pathogens ?? []).some(p =>
      p.detected_level === 'unknown' || p.detected_level === 'threat'
    )
  )?.[0] ?? null;

  if (unconfimedThreat) {
    const recon = getBestReconCell(gameState);
    if (recon) {
      return { type: ACTION_TYPES.DEPLOY_FROM_ROSTER, cellId: recon.id, nodeId: unconfimedThreat };
    }
  }

  // 3. Proactive scouting — send a patrol to the most stale node
  const recon = getBestReconCell(gameState);
  if (recon) {
    const staleNode = getMostStaleNodeGreedy(gameState);
    if (staleNode) {
      return { type: ACTION_TYPES.DEPLOY_FROM_ROSTER, cellId: recon.id, nodeId: staleNode };
    }
  }

  // 4. Train a neutrophil only when no threats are detected and roster has fewer than 2.
  const hasDetectedThreat = Object.values(nodeStates).some(ns =>
    (ns.pathogens ?? []).some(p => p.detected_level !== 'none')
  );
  const neutrophilCount = Object.values(gameState.deployedCells)
    .filter(c => c.type === 'neutrophil').length;
  if (!hasDetectedThreat && neutrophilCount < 2 && gameState.attentionTokens >= 1) {
    const trainAction = getLegalTrainActions(gameState).find(a => a.cellType === 'neutrophil');
    if (trainAction) return trainAction;
  }

  return { type: ACTION_TYPES.END_TURN };
}

function getMostStaleNodeGreedy(state) {
  const nodeStates = state.groundTruth?.nodeStates ?? {};
  return NODE_IDS
    .map(id => ({ id, staleness: nodeStates[id]?.turnsSinceLastVisible ?? 999 }))
    .sort((a, b) => b.staleness - a.staleness)[0]?.id ?? null;
}

// ── Strategy 3: Conservative ──────────────────────────────────────────────────

/**
 * Prioritises surveillance over direct response. Principles:
 *   - Always keeps a recon cell in the field if possible.
 *   - Deploys patrols and macrophages to unvisited / high-inflammation nodes.
 *   - Deploys attack cells only when a pathogen is classified (not just suspected).
 *   - Never uses fever (avoids stress accumulation).
 *   - Trains low-cost cells to maintain roster depth; avoids expensive cells early.
 *
 * Per-turn state: uses a closure to track which nodes were recently targeted,
 * preventing repeated redundant deployments in the same turn.
 */
export function makeConservativeStrategy() {
  const deployedThisTurn = new Set();
  let lastTurnSeen = -1;
  let trainedThisTurn = false;

  return function conservativeStrategy(gameState) {
    if (gameState.turn !== lastTurnSeen) {
      deployedThisTurn.clear();
      trainedThisTurn = false;
      lastTurnSeen = gameState.turn;
    }

    const nodeStates = gameState.groundTruth?.nodeStates ?? {};

    // ── 1. Deploy recon to the most stale / unvisited node ─────────────────
    const reconCell = Object.values(gameState.deployedCells).find(c =>
      c.phase === 'ready' && CELL_CONFIG[c.type]?.isRecon
    );

    if (reconCell) {
      const target = getMostStaleNode(gameState, deployedThisTurn);
      if (target) {
        deployedThisTurn.add(target);
        return { type: ACTION_TYPES.DEPLOY_FROM_ROSTER, cellId: reconCell.id, nodeId: target };
      }
    }

    // ── 2. Deploy type-matched cell against classified pathogens ───────────
    const classifiedTarget = getClassifiedThreatNode(gameState, deployedThisTurn);
    if (classifiedTarget) {
      const ns = nodeStates[classifiedTarget];
      const classifiedP = (ns?.pathogens ?? []).find(
        p => (p.detected_level === 'classified' || p.detected_level === 'misclassified') && p.perceived_type
      );
      if (classifiedP) {
        const cell = getBestReadyCellForType(gameState, classifiedP.perceived_type, classifiedP.detected_level);
        if (cell) {
          deployedThisTurn.add(classifiedTarget);
          return { type: ACTION_TYPES.DEPLOY_FROM_ROSTER, cellId: cell.id, nodeId: classifiedTarget };
        }
        if (!trainedThisTurn) {
          const trainAction = getTrainActionForType(gameState, classifiedP.perceived_type, classifiedP.detected_level);
          if (trainAction) { trainedThisTurn = true; return trainAction; }
        }
      }
    }

    // ── 3. Train cheap recon if tokens available and no recon in pool ──────
    const hasReadyRecon = Object.values(gameState.deployedCells).some(c =>
      c.phase === 'ready' && CELL_CONFIG[c.type]?.isRecon
    );

    if (!hasReadyRecon && !trainedThisTurn && gameState.attentionTokens >= 1) {
      const cheapRecon = getLegalTrainActions(gameState).find(a =>
        CELL_CONFIG[a.cellType]?.isRecon && (CELL_CONFIG[a.cellType]?.deployCost ?? 1) === 1
      );
      if (cheapRecon) { trainedThisTurn = true; return cheapRecon; }
    }

    // ── 4. Nothing useful to do — end turn ─────────────────────────────────
    return { type: ACTION_TYPES.END_TURN };
  };
}

// Nodes sorted by how long since last visible (most stale first)
function getMostStaleNode(state, skipNodes) {
  const nodeStates = state.groundTruth?.nodeStates ?? {};

  const candidates = NODE_IDS
    .filter(id => !skipNodes.has(id))
    .map(id => ({ id, staleness: nodeStates[id]?.turnsSinceLastVisible ?? 999 }))
    .sort((a, b) => b.staleness - a.staleness);

  return candidates[0]?.id ?? null;
}

// Nodes where any pathogen is classified (fully identified)
function getClassifiedThreatNode(state, skipNodes) {
  const nodeStates = state.groundTruth?.nodeStates ?? {};

  for (const [nodeId, ns] of Object.entries(nodeStates)) {
    if (skipNodes.has(nodeId)) continue;
    if ((ns.pathogens ?? []).some(p => p.detected_level === 'classified')) {
      return nodeId;
    }
  }
  return null;
}

// ── Strategy 4: Type-aware ─────────────────────────────────────────────────────

/**
 * Builds a reverse map from pathogenType → cell types that can clear it,
 * sorted by clearanceRate descending. Derived entirely from CELL_CONFIG so it
 * stays in sync with any balance changes to clearablePathogens.
 */
const PATHOGEN_CLEARERS = (() => {
  const map = {};
  for (const [cellType, cfg] of Object.entries(CELL_CONFIG)) {
    for (const pathogenType of Object.keys(cfg.clearablePathogens ?? {})) {
      if (!map[pathogenType]) map[pathogenType] = [];
      map[pathogenType].push({ cellType, clearanceRate: cfg.clearanceRate ?? 0 });
    }
  }
  for (const key of Object.keys(map)) {
    map[key].sort((a, b) => b.clearanceRate - a.clearanceRate);
  }
  return map;
})();

/**
 * Responds to each threat with the cell type that can actually clear it.
 *
 * Priority each turn:
 *   1. Deploy the highest-clearance-rate cell that can clear the classified pathogen
 *      at the highest-load classified threat node. Trains one if none ready.
 *   2. Send recon to an unclassified threat node to get classification.
 *   3. Proactive scouting — send recon to the most stale node.
 *   4. Train a cheap recon cell if none are ready.
 *   5. End turn.
 *
 * Uses perceived_type from masked state — only acts on classified/misclassified
 * pathogens for deployment decisions. Falls back on recon for anything unclassified.
 */
export function makeTypeAwareStrategy() {
  const deployedThisTurn = new Set();
  let lastTurnSeen = -1;
  let trainedThisTurn = false;

  return function typeAwareStrategy(gameState) {
    if (gameState.turn !== lastTurnSeen) {
      deployedThisTurn.clear();
      trainedThisTurn = false;
      lastTurnSeen = gameState.turn;
    }

    const nodeStates = gameState.groundTruth?.nodeStates ?? {};

    // ── 1. Deploy the right attacker for classified threats ────────────────
    // Find all nodes with a classified pathogen that has a known type, sorted
    // by estimatedLoad (or actualLoad in omniscient mode) descending.
    const classifiedThreats = [];
    for (const [nodeId, ns] of Object.entries(nodeStates)) {
      if (deployedThisTurn.has(nodeId)) continue;
      for (const p of (ns.pathogens ?? [])) {
        if ((p.detected_level === 'classified' || p.detected_level === 'misclassified') && p.perceived_type) {
          const load = p.estimatedLoad ?? p.actualLoad ?? 50;
          classifiedThreats.push({ nodeId, pathogenType: p.perceived_type, load, detected_level: p.detected_level });
        }
      }
    }
    classifiedThreats.sort((a, b) => b.load - a.load);

    for (const { nodeId, pathogenType, detected_level } of classifiedThreats) {
      const clearers = PATHOGEN_CLEARERS[pathogenType] ?? [];

      // Find the best ready cell that can clear this type
      let bestCell = null;
      let bestRate = -1;
      for (const { cellType, clearanceRate } of clearers) {
        if (clearanceRate <= 0) continue;
        // requiresClassified cells need detected_level === 'classified' specifically
        if (CELL_CONFIG[cellType]?.requiresClassified && detected_level !== 'classified') continue;
        const ready = Object.values(gameState.deployedCells).find(
          c => c.phase === 'ready' && c.type === cellType
        );
        if (ready && clearanceRate > bestRate) {
          bestCell = ready;
          bestRate = clearanceRate;
        }
      }

      if (bestCell) {
        deployedThisTurn.add(nodeId);
        return { type: ACTION_TYPES.DEPLOY_FROM_ROSTER, cellId: bestCell.id, nodeId };
      }

      // No ready cell — train the best one we can afford (once per turn)
      if (!trainedThisTurn) {
        for (const { cellType, clearanceRate } of clearers) {
          if (clearanceRate <= 0) continue;
          if (CELL_CONFIG[cellType]?.requiresClassified && detected_level !== 'classified') continue;
          const cost = CELL_CONFIG[cellType]?.deployCost ?? 1;
          if (gameState.attentionTokens >= cost) {
            trainedThisTurn = true;
            return { type: ACTION_TYPES.TRAIN_CELL, cellType };
          }
        }
      }
    }

    // ── 2. Send recon to unclassified threat nodes ─────────────────────────
    const reconCell = Object.values(gameState.deployedCells).find(
      c => c.phase === 'ready' && CELL_CONFIG[c.type]?.isRecon
    );

    if (reconCell) {
      const unclassifiedNode = Object.entries(nodeStates).find(([nodeId, ns]) =>
        !deployedThisTurn.has(nodeId) &&
        (ns.pathogens ?? []).some(p => p.detected_level === 'unknown' || p.detected_level === 'threat')
      )?.[0] ?? null;

      if (unclassifiedNode) {
        deployedThisTurn.add(unclassifiedNode);
        return { type: ACTION_TYPES.DEPLOY_FROM_ROSTER, cellId: reconCell.id, nodeId: unclassifiedNode };
      }

      // ── 3. Proactive scouting ─────────────────────────────────────────────
      const staleNode = getMostStaleNode(gameState, deployedThisTurn);
      if (staleNode) {
        deployedThisTurn.add(staleNode);
        return { type: ACTION_TYPES.DEPLOY_FROM_ROSTER, cellId: reconCell.id, nodeId: staleNode };
      }
    }

    // ── 4. Train a cheap recon cell if none ready ──────────────────────────
    const hasReadyRecon = Object.values(gameState.deployedCells).some(
      c => c.phase === 'ready' && CELL_CONFIG[c.type]?.isRecon
    );
    if (!hasReadyRecon && !trainedThisTurn && gameState.attentionTokens >= 1) {
      const cheapRecon = getLegalTrainActions(gameState).find(a => CELL_CONFIG[a.cellType]?.isRecon);
      if (cheapRecon) {
        trainedThisTurn = true;
        return cheapRecon;
      }
    }

    return { type: ACTION_TYPES.END_TURN };
  };
}

// ── Registry ──────────────────────────────────────────────────────────────────

export const STRATEGIES = {
  random:       () => randomStrategy,
  greedy:       () => greedyThreatStrategy,
  conservative: () => makeConservativeStrategy(),
  // 'omniscient' is not a strategy name — use --omniscient flag with any strategy.
  // It controls whether engine.js passes masked or full state to the strategy.
};

export function getStrategy(name) {
  const factory = STRATEGIES[name];
  if (!factory) {
    throw new Error(`Unknown strategy "${name}". Available: ${Object.keys(STRATEGIES).join(', ')}`);
  }
  // Return the factory itself — callers invoke factory() to get a fresh strategy instance.
  // Stateless strategies (random, greedy) return the same function each time.
  // Stateful strategies (conservative) create a new closure per call.
  return factory;
}

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

/** Highest-load node that has an active (non-zero) pathogen. */
function getHighestThreatNode(state) {
  const nodeStates = state.groundTruth?.nodeStates ?? {};
  let best = null;
  let bestLoad = -1;

  for (const [nodeId, ns] of Object.entries(nodeStates)) {
    for (const p of (ns.pathogens ?? [])) {
      if ((p.actualLoad ?? 0) > bestLoad) {
        bestLoad = p.actualLoad;
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

/** Best attack cell type available in the ready pool, by clearance rate descending. */
function getBestAttackCell(state) {
  const candidates = Object.values(state.deployedCells).filter(c => {
    if (c.phase !== 'ready') return false;
    return CELL_CONFIG[c.type]?.isAttack;
  });

  if (!candidates.length) return null;
  return candidates.sort((a, b) =>
    (CELL_CONFIG[b.type]?.clearanceRate ?? 0) - (CELL_CONFIG[a.type]?.clearanceRate ?? 0)
  )[0];
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
 * Each turn: deploy the best available attack cell to the highest-threat node.
 * If an attack cell is at HQ (ready) and there is a known threat, send it.
 * Trains cheap patrol cells when tokens are available and no attack cell is ready.
 * Does not use fever. Does not recall or reposition arrived cells.
 * Ends turn as soon as no useful deployment can be made.
 */
export function greedyThreatStrategy(gameState) {
  const threatNode = getHighestThreatNode(gameState);

  // Deploy best available attack cell to the threat node
  if (threatNode) {
    const attacker = getBestAttackCell(gameState);
    if (attacker) {
      // Killer T gating: skip if no classified pathogen at target
      if (CELL_CONFIG[attacker.type]?.requiresClassified &&
          !nodeHasClassifiedPathogen(threatNode, gameState.groundTruth.nodeStates)) {
        // Fall through to recon deployment
      } else {
        return { type: ACTION_TYPES.DEPLOY_FROM_ROSTER, cellId: attacker.id, nodeId: threatNode };
      }
    }
  }

  // Send a recon cell to the threat node if we have no intelligence yet
  if (threatNode) {
    const recon = getBestReconCell(gameState);
    if (recon) {
      return { type: ACTION_TYPES.DEPLOY_FROM_ROSTER, cellId: recon.id, nodeId: threatNode };
    }
  }

  // Train a neutrophil (cheap patrol) if we have spare tokens and nothing to do
  if (gameState.attentionTokens >= 1) {
    const trainAction = getLegalTrainActions(gameState).find(a => a.cellType === 'neutrophil');
    if (trainAction) return trainAction;
  }

  return { type: ACTION_TYPES.END_TURN };
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
  // Per-turn visited-target guard: reset each time END_TURN is returned
  const deployedThisTurn = new Set();
  let lastTurnSeen = -1;

  return function conservativeStrategy(gameState) {
    // Reset per-turn state when we're on a new turn
    if (gameState.turn !== lastTurnSeen) {
      deployedThisTurn.clear();
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

    // ── 2. Deploy attack cells only against classified pathogens ───────────
    const attacker = Object.values(gameState.deployedCells).find(c =>
      c.phase === 'ready' && CELL_CONFIG[c.type]?.isAttack
    );

    if (attacker) {
      const classifiedTarget = getClassifiedThreatNode(gameState, deployedThisTurn);
      if (classifiedTarget) {
        // Skip killer_t if the target doesn't have a classified pathogen
        if (CELL_CONFIG[attacker.type]?.requiresClassified &&
            !nodeHasClassifiedPathogen(classifiedTarget, nodeStates)) {
          // Don't deploy
        } else {
          deployedThisTurn.add(classifiedTarget);
          return { type: ACTION_TYPES.DEPLOY_FROM_ROSTER, cellId: attacker.id, nodeId: classifiedTarget };
        }
      }
    }

    // ── 3. Train cheap recon if tokens available and no recon in pool ──────
    const hasReadyRecon = Object.values(gameState.deployedCells).some(c =>
      c.phase === 'ready' && CELL_CONFIG[c.type]?.isRecon
    );

    if (!hasReadyRecon && gameState.attentionTokens >= 1) {
      const cheapRecon = getLegalTrainActions(gameState).find(a =>
        CELL_CONFIG[a.cellType]?.isRecon && (CELL_CONFIG[a.cellType]?.deployCost ?? 1) === 1
      );
      if (cheapRecon) return cheapRecon;
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

// ── Registry ──────────────────────────────────────────────────────────────────

export const STRATEGIES = {
  random:       () => randomStrategy,
  greedy:       () => greedyThreatStrategy,
  conservative: () => makeConservativeStrategy(),
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

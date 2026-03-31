/**
 * simulation/engine.js
 *
 * Core headless game runner.
 * Imports game logic directly from src/ — no React, no browser, no side effects.
 *
 * Public API:
 *   runGame(options) => RunResult
 *
 * options:
 *   runConfig   — optional game config (default: DEFAULT_RUN_CONFIG)
 *   strategy    — (gameState) => action  — called each step until END_TURN
 *   rng         — () => [0,1)  — seeded PRNG for reproducibility
 *   maxTurns    — hard ceiling to prevent infinite games (default: 500)
 *
 * RunResult:
 *   outcome           — 'loss' | 'timeout'
 *   turns             — number of complete turns played
 *   finalState        — final game state snapshot
 *   turnLog           — TurnEntry[]
 *   namedEvents       — NamedEvent[]
 *   actionFrequency   — { [actionType]: count }
 *
 * TurnEntry:
 *   turn              — turn number after END_TURN resolved
 *   preActionCount    — number of pre-turn actions taken
 *   stateSummary      — StateSummary (post-turn snapshot)
 *   namedEvents       — NamedEvent[] that occurred this turn
 *
 * StateSummary:
 *   turn, systemicStress, systemicIntegrity, fever, tokenCapacity, tokensInUse
 *   infectedNodes     — nodeIds with any active pathogen
 *   cellsByPhase      — { training, ready, outbound, arrived, returning } counts
 *
 * NamedEvent:
 *   type              — 'pathogen_spawned' | 'pathogen_cleared' | 'integrity_hit'
 *                       | 'stress_spike' | 'node_walled_off' | 'node_suppressed'
 *   turn, nodeId, detail
 */

import { initGameState, GAME_PHASES } from '../src/state/gameState.js';
import { gameReducer, ACTION_TYPES } from '../src/state/actions.js';
import { DEFAULT_RUN_CONFIG } from '../src/data/runConfig.js';

const MAX_ACTIONS_PER_TURN = 100;

// ── Public API ────────────────────────────────────────────────────────────────

export function runGame({
  runConfig = DEFAULT_RUN_CONFIG,
  strategy,
  rng,
  maxTurns = 500,
} = {}) {
  if (!strategy) throw new Error('runGame requires a strategy function');
  if (!rng) throw new Error('runGame requires an rng function for reproducibility');

  // Monkey-patch Math.random for the duration of this game.
  // Restored in the finally block regardless of outcome.
  const savedRandom = Math.random;
  Math.random = rng;

  try {
    let state = initGameState(runConfig);
    const turnLog = [];
    const allNamedEvents = [];
    const actionFrequency = {};

    while (state.phase === GAME_PHASES.PLAYING && state.turn < maxTurns) {
      const stateBeforeTurn = state;

      // ── Pre-turn phase: strategy issues actions until END_TURN ─────────────
      let preActionCount = 0;
      while (state.phase === GAME_PHASES.PLAYING && preActionCount < MAX_ACTIONS_PER_TURN) {
        const action = strategy(state);
        if (!action || action.type === ACTION_TYPES.END_TURN) break;

        // Track action frequency
        actionFrequency[action.type] = (actionFrequency[action.type] ?? 0) + 1;

        const next = gameReducer(state, action);
        // If the reducer returned the same state (e.g. invalid action), break to avoid loops
        if (next === state) break;
        state = next;
        preActionCount++;
      }

      // ── End turn ───────────────────────────────────────────────────────────
      actionFrequency[ACTION_TYPES.END_TURN] = (actionFrequency[ACTION_TYPES.END_TURN] ?? 0) + 1;
      const stateBeforeEndTurn = state;
      state = gameReducer(state, { type: ACTION_TYPES.END_TURN });

      // ── Detect named events by diffing states ──────────────────────────────
      const turnEvents = extractNamedEvents(stateBeforeEndTurn, state, state.turn);
      allNamedEvents.push(...turnEvents);

      // ── Record turn log entry ──────────────────────────────────────────────
      turnLog.push({
        turn: state.turn,
        preActionCount,
        stateSummary: summarizeState(state),
        namedEvents: turnEvents,
      });
    }

    return {
      outcome: state.phase === GAME_PHASES.LOST ? 'loss' : 'timeout',
      turns: state.turn,
      finalState: state,
      turnLog,
      namedEvents: allNamedEvents,
      actionFrequency,
    };
  } finally {
    Math.random = savedRandom;
  }
}

// ── State summarizer ──────────────────────────────────────────────────────────

export function summarizeState(state) {
  const nodeStates = state.groundTruth?.nodeStates ?? {};
  const cells = Object.values(state.deployedCells ?? {});

  const infectedNodes = Object.entries(nodeStates)
    .filter(([, ns]) => ns.pathogens?.length > 0)
    .map(([id]) => id);

  const cellsByPhase = { training: 0, ready: 0, outbound: 0, arrived: 0, returning: 0 };
  for (const cell of cells) {
    if (cell.phase in cellsByPhase) cellsByPhase[cell.phase]++;
  }

  return {
    turn: state.turn,
    systemicStress: Math.round(state.systemicStress ?? 0),
    systemicIntegrity: Math.round(state.systemicIntegrity ?? 100),
    fever: state.fever?.active ?? false,
    tokenCapacity: state.tokenCapacity ?? 0,
    tokensInUse: state.tokensInUse ?? 0,
    infectedNodes,
    cellsByPhase,
  };
}

// ── Named event extraction ────────────────────────────────────────────────────

function extractNamedEvents(before, after, turn) {
  const events = [];

  const beforeNodes = before.groundTruth?.nodeStates ?? {};
  const afterNodes = after.groundTruth?.nodeStates ?? {};

  for (const nodeId of Object.keys(afterNodes)) {
    const bNode = beforeNodes[nodeId] ?? { pathogens: [], isWalledOff: false, immuneSuppressed: false };
    const aNode = afterNodes[nodeId];

    const bUids = new Set((bNode.pathogens ?? []).map(p => p.uid));
    const aUids = new Set((aNode.pathogens ?? []).map(p => p.uid));

    // New pathogens (spawned or spread)
    for (const p of (aNode.pathogens ?? [])) {
      if (!bUids.has(p.uid)) {
        events.push({ type: 'pathogen_spawned', turn, nodeId, detail: { pathogenType: p.type, load: p.actualLoad } });
      }
    }

    // Cleared pathogens
    for (const p of (bNode.pathogens ?? [])) {
      if (!aUids.has(p.uid)) {
        events.push({ type: 'pathogen_cleared', turn, nodeId, detail: { pathogenType: p.type } });
      }
    }

    // Node newly walled off
    if (!bNode.isWalledOff && aNode.isWalledOff) {
      events.push({ type: 'node_walled_off', turn, nodeId, detail: null });
    }

    // Node newly immune-suppressed
    if (!bNode.immuneSuppressed && aNode.immuneSuppressed) {
      events.push({ type: 'node_suppressed', turn, nodeId, detail: null });
    }
  }

  // Integrity hit
  const bIntegrity = before.systemicIntegrity ?? 100;
  const aIntegrity = after.systemicIntegrity ?? 100;
  if (aIntegrity < bIntegrity) {
    events.push({ type: 'integrity_hit', turn, nodeId: null, detail: { lost: Math.round(bIntegrity - aIntegrity), current: Math.round(aIntegrity) } });
  }

  // Stress spike crossing 80
  const bStress = before.systemicStress ?? 0;
  const aStress = after.systemicStress ?? 0;
  if (bStress < 80 && aStress >= 80) {
    events.push({ type: 'stress_spike', turn, nodeId: null, detail: { stress: Math.round(aStress) } });
  }

  return events;
}

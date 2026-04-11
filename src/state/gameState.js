// Game state shape and initialisation.
// Turn-based endless run. Detection state lives on pathogen instances in groundTruth.

import { initGroundTruth } from '../engine/groundTruth.js';
import { makeReadyCell, computeTokensInUse } from '../engine/cells.js';
import { INITIAL_TOKEN_CAPACITY, TICKS_PER_TURN } from '../data/gameConfig.js';
import { DEFAULT_RUN_CONFIG } from '../data/runConfig.js';
import { CELL_CONFIG } from '../data/cellConfig.js';
import { makeRunModifiers, applyModifierPatch } from '../data/runModifiers.js';
import { BONUS_OBJECTIVE_LIBRARY } from '../data/bonusObjectiveLibrary.js';

/**
 * Per-type runtime cell state — behavioural state that emerges from gameplay
 * (specialization scores, specialist lock-in), distinct from run modifier upgrades/scars.
 * Lives at state.cellTypeState and is updated each turn by the engine.
 */
export function makeCellTypeState() {
  return {
    b_cell: {
      // Clearance multiplier per pathogen type. Starts at 1.0 (neutral).
      specialization: Object.fromEntries(
        Object.keys(CELL_CONFIG.b_cell.clearablePathogens).map(k => [k, 1.0])
      ),
    },
    killer_t: {
      // Locked pathogen type after first successful clear. null = not yet specialised.
      specializedType: null,
    },
  };
}

export { TICKS_PER_TURN };

export const GAME_PHASES = {
  PLAYING: 'playing',
  LOST:    'lost',
  WON:     'won',
};

export const LOSS_REASONS = {
  SYSTEMIC_COLLAPSE: 'systemic_collapse',
};

/**
 * Initialise fresh game state for a sub-run.
 * @param {Object} runConfig   — optional override (default: DEFAULT_RUN_CONFIG)
 * @param {Object} metaContext — optional meta state context:
 *   {
 *     persistentModifiers:     runModifiers patch applied at init
 *     pendingNextRunModifiers: one-off patch for this run only
 *     persistentTokenCapBonus: permanent token capacity bonus
 *     activeBonusObjectives:   string[] — objective ids active this run
 *   }
 */
export function initGameState(runConfig = DEFAULT_RUN_CONFIG, metaContext = null) {
  // Build starting roster: use runConfig.startingUnits if provided (e.g. from start screen),
  // otherwise fall back to CELL_CONFIG[type].startingCount defaults.
  const startingUnits = runConfig.startingUnits ??
    Object.entries(CELL_CONFIG)
      .filter(([, cfg]) => cfg.startingCount > 0)
      .map(([type, cfg]) => ({ type, count: cfg.startingCount }));

  const deployedCells = {};
  for (const { type, count } of startingUnits) {
    for (let i = 0; i < count; i++) {
      const cell = makeReadyCell(type);
      deployedCells[cell.id] = cell;
    }
  }

  // Build runModifiers: start fresh, then layer in persistent meta modifiers
  let runModifiers = makeRunModifiers();
  if (metaContext?.persistentModifiers) {
    runModifiers = applyModifierPatch(runModifiers, metaContext.persistentModifiers);
  }
  if (metaContext?.pendingNextRunModifiers) {
    runModifiers = applyModifierPatch(runModifiers, metaContext.pendingNextRunModifiers);
  }

  // Token capacity: base + permanent meta bonus
  const metaTokenBonus = metaContext?.persistentTokenCapBonus ?? 0;
  const tokenCapacity = INITIAL_TOKEN_CAPACITY + metaTokenBonus;
  const tokensInUse = computeTokensInUse(deployedCells);

  // Bonus objectives for this run
  const activeBonusObjectives = metaContext?.activeBonusObjectives ?? [];
  const bonusObjectiveTracking = initBonusObjectiveTracking(activeBonusObjectives);

  return {
    runConfig,

    // Ground truth — the hidden simulation
    groundTruth: initGroundTruth(),

    // Cell deployment
    deployedCells,

    // Time
    tick: 0,
    turn: 0,

    // Token capacity (cell manufacturing slots)
    tokenCapacity,
    tokensInUse,
    attentionTokens: tokenCapacity - tokensInUse,

    // Systemic values — the new health model
    systemicStress: 0,
    systemicIntegrity: 100,
    systemicStressHistory: [{ turn: 0, stress: 0, integrity: 100 }],

    // Fever — binary player-controlled state
    fever: { active: false },

    // Scars — permanent negative modifiers from serious damage
    scars: [],

    // Runtime modifiers — accumulate upgrades, scars, decisions
    runModifiers,

    // Per-type runtime cell state — specialization scores and specialist lock-in.
    cellTypeState: makeCellTypeState(),

    // Win tracking
    totalPathogensSpawned: 0,
    totalPathogensCleared: 0,

    // Modifier choices awaiting player resolution (in-run: upgrades and scars)
    pendingModifierChoices: [],

    // Record of all modifiers chosen during this run
    modifierHistory: [],

    // Bonus objectives
    activeBonusObjectives,
    bonusObjectiveTracking,

    // Player preferences
    globalAutoReturn: true,

    // Debug
    godMode: false,
    preGodModeTokenCapacity: tokenCapacity,

    // Phase
    phase: GAME_PHASES.PLAYING,
    lossReason: null,
    postMortem: null,
    selectedNodeId: null,
  };
}

function initBonusObjectiveTracking(objectiveIds) {
  const tracking = {};
  for (const id of objectiveIds) {
    const obj = BONUS_OBJECTIVE_LIBRARY.find(o => o.id === id);
    if (obj) tracking[id] = obj.initTracking();
  }
  return tracking;
}

// Meta state — persists across sub-runs within a lifetime.
//
// Lives outside gameState; managed by metaReducer in metaActions.js.
// Serialised to localStorage under a separate key by metaPersistence.js.
//
// Shape:
//   metaRunId               — unique id for this lifetime
//   lifeStageIndex          — current life stage (index into LIFE_STAGES)
//   runIndexInStage         — runs completed within current stage (0-based)
//   subRunIndex             — total sub-runs completed this lifetime
//   subRunHistory           — record of each completed sub-run
//   completedModifierIds    — modifier ids chosen this lifetime (for one-time eligibility)
//   completedBonusObjIds    — bonus objective ids completed this lifetime
//   persistentModifiers     — accumulated runModifiers patch applied to every future run
//   persistentTokenCapBonus — token capacity added permanently (via immediateEffect)
//   unlockedCellTypes       — cell types unlocked by life events
//   unlockedPathogenTypes   — pathogen types unlocked by life events
//   pendingBetweenRunChoices— queue of { type, label, options } for BetweenRunScreen
//   pendingNextRunModifiers — one-off modifier patch for next run only (cleared after use)
//   activeBonusObjectives   — ids of objectives active for the current run

import { makeRunModifiers } from '../data/runModifiers.js';

let _idCounter = 0;

function generateId() {
  return `meta_${Date.now()}_${++_idCounter}`;
}

export function initMetaState() {
  return {
    metaRunId:               generateId(),
    lifeStageIndex:          0,
    runIndexInStage:         0,
    subRunIndex:             0,
    subRunHistory:           [],
    completedModifierIds:    [],
    completedBonusObjIds:    [],
    persistentModifiers:     makeRunModifiers(),
    persistentTokenCapBonus: 0,
    unlockedCellTypes:       [],
    unlockedPathogenTypes:   [],
    pendingBetweenRunChoices: [],
    pendingNextRunModifiers: null,
    activeBonusObjectives:   [],
  };
}

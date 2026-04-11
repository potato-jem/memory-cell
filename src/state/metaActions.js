// Meta reducer — manages state that persists across sub-runs.
//
// Actions:
//   END_RUN                    — called when a sub-run is won; evaluates bonus objectives,
//                                generates between-run choices, advances stage/run indices
//   CHOOSE_BETWEEN_RUN_MODIFIER— player picks an option from pendingBetweenRunChoices[0]
//   SELECT_BONUS_OBJECTIVES    — store which objectives are active for the next run
//                                (also clears pendingNextRunModifiers after they've been consumed)
//   NEW_LIFETIME               — reset everything; start a fresh meta-run

import { LIFE_STAGES, isLastRunInStage, isLastLifeStage } from '../data/lifeStageConfig.js';
import { BONUS_OBJECTIVE_LIBRARY } from '../data/bonusObjectiveLibrary.js';
import { MODIFIER_LIBRARY } from '../data/modifierLibrary.js';
import { selectMetaOptions, computeOptionPatch } from '../data/modifierSelector.js';
import { applyModifierPatch, makeRunModifiers } from '../data/runModifiers.js';
import { initMetaState } from './metaState.js';

export const META_ACTION_TYPES = {
  END_RUN:                     'END_RUN',
  CHOOSE_BETWEEN_RUN_MODIFIER: 'CHOOSE_BETWEEN_RUN_MODIFIER',
  SELECT_BONUS_OBJECTIVES:     'SELECT_BONUS_OBJECTIVES',
  NEW_LIFETIME:                'NEW_LIFETIME',
};

export function metaReducer(metaState, action) {
  switch (action.type) {
    case META_ACTION_TYPES.END_RUN:
      return handleEndRun(metaState, action.finalGameState);
    case META_ACTION_TYPES.CHOOSE_BETWEEN_RUN_MODIFIER:
      return handleChooseBetweenRunModifier(metaState, action.optionIndex);
    case META_ACTION_TYPES.SELECT_BONUS_OBJECTIVES:
      return {
        ...metaState,
        activeBonusObjectives:  action.objectiveIds,
        pendingNextRunModifiers: null,  // consumed at run start
      };
    case META_ACTION_TYPES.NEW_LIFETIME:
      return initMetaState();
    default:
      return metaState;
  }
}

// ── END_RUN ────────────────────────────────────────────────────────────────────

function handleEndRun(metaState, finalGameState) {
  // 1. Evaluate bonus objectives
  const bonusChoices = [];
  const newlyCompletedObjIds = [];

  for (const objId of (metaState.activeBonusObjectives ?? [])) {
    const obj = BONUS_OBJECTIVE_LIBRARY.find(o => o.id === objId);
    if (!obj) continue;
    const tracking = finalGameState.bonusObjectiveTracking?.[objId] ?? {};
    if (!obj.isComplete(tracking, finalGameState)) continue;

    newlyCompletedObjIds.push(objId);
    const options = selectMetaOptions('bonusObjectiveReward', metaState, finalGameState.runModifiers, 3);
    if (options.length > 0) {
      bonusChoices.push({
        type:    'bonusObjectiveReward',
        label:   obj.name,
        options,
      });
    }
  }

  // 2. Determine reward tier: major at end of stage, mini otherwise
  const lastInStage  = isLastRunInStage(metaState.lifeStageIndex, metaState.runIndexInStage);
  const rewardType   = lastInStage ? 'majorReward' : 'miniReward';
  const rewardLabel  = lastInStage
    ? `${LIFE_STAGES[metaState.lifeStageIndex]?.name ?? 'Stage'} complete`
    : 'Run complete';

  const rewardOptions = selectMetaOptions(rewardType, metaState, finalGameState.runModifiers, 3);
  const rewardChoice  = { type: rewardType, label: rewardLabel, options: rewardOptions };

  // 3. Advance indices
  const newRunIndexInStage = lastInStage ? 0 : metaState.runIndexInStage + 1;
  const newLifeStageIndex  = lastInStage
    ? metaState.lifeStageIndex + 1
    : metaState.lifeStageIndex;

  // 4. Record run
  const runRecord = {
    subRunIndex:               metaState.subRunIndex,
    lifeStageIndex:            metaState.lifeStageIndex,
    outcome:                   'won',
    turn:                      finalGameState.turn,
    bonusObjectivesCompleted:  newlyCompletedObjIds,
  };

  return {
    ...metaState,
    lifeStageIndex:          newLifeStageIndex,
    runIndexInStage:         newRunIndexInStage,
    subRunIndex:             metaState.subRunIndex + 1,
    subRunHistory:           [...metaState.subRunHistory, runRecord],
    completedBonusObjIds:    [...metaState.completedBonusObjIds, ...newlyCompletedObjIds],
    pendingBetweenRunChoices: [...bonusChoices, rewardChoice],
    activeBonusObjectives:   [],
  };
}

// ── CHOOSE_BETWEEN_RUN_MODIFIER ────────────────────────────────────────────────

function handleChooseBetweenRunModifier(metaState, optionIndex) {
  const pending = metaState.pendingBetweenRunChoices;
  if (!pending?.length) return metaState;

  const choice = pending[0];
  const option = choice.options[optionIndex ?? 0];
  if (!option) return metaState;

  // Look up the modifier definition to get persistence flag
  const modifierDef = MODIFIER_LIBRARY.find(m => m.id === option.modifierId);
  const isPersistent = modifierDef?.persistent ?? false;

  // Recompute patch against current persistent modifiers (correct stacking)
  const patch = computeOptionPatch(option, metaState.persistentModifiers);

  let newPersistentModifiers     = metaState.persistentModifiers;
  let newPendingNextRun          = metaState.pendingNextRunModifiers ?? makeRunModifiers();
  let newPersistentTokenCapBonus = metaState.persistentTokenCapBonus ?? 0;
  let newUnlockedCellTypes       = metaState.unlockedCellTypes ?? [];
  let newUnlockedPathogenTypes   = metaState.unlockedPathogenTypes ?? [];

  if (isPersistent) {
    newPersistentModifiers = applyModifierPatch(newPersistentModifiers, patch);
  } else {
    newPendingNextRun = applyModifierPatch(newPendingNextRun, patch);
  }

  // Handle immediateEffect
  if (option.immediateEffect) {
    const fx = option.immediateEffect;
    if (fx.tokenCapacityBonus) {
      newPersistentTokenCapBonus = newPersistentTokenCapBonus +
        (isPersistent ? fx.tokenCapacityBonus : 0);
      // Non-persistent token bonus: stored as pendingNextRun systemic field instead
      if (!isPersistent && fx.tokenCapacityBonus) {
        newPendingNextRun = applyModifierPatch(newPendingNextRun, {
          systemic: { oneRunTokenCapBonus: (newPendingNextRun?.systemic?.oneRunTokenCapBonus ?? 0) + fx.tokenCapacityBonus }
        });
      }
    }
    if (fx.unlockCellTypes?.length) {
      newUnlockedCellTypes = [...new Set([...newUnlockedCellTypes, ...fx.unlockCellTypes])];
    }
    if (fx.unlockPathogenTypes?.length) {
      newUnlockedPathogenTypes = [...new Set([...newUnlockedPathogenTypes, ...fx.unlockPathogenTypes])];
    }
  }

  return {
    ...metaState,
    persistentModifiers:      newPersistentModifiers,
    pendingNextRunModifiers:  newPendingNextRun,
    persistentTokenCapBonus:  newPersistentTokenCapBonus,
    unlockedCellTypes:        newUnlockedCellTypes,
    unlockedPathogenTypes:    newUnlockedPathogenTypes,
    pendingBetweenRunChoices: pending.slice(1),
    completedModifierIds:     [...(metaState.completedModifierIds ?? []), option.modifierId],
  };
}

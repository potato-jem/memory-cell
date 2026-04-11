// Life stage configuration — defines the meta-run arc.
//
// All code references stages by index (lifeStageIndex: number).
// Names and details are looked up via LIFE_STAGES[lifeStageIndex].
//
// Tweak LIFE_STAGES freely for playtesting — everything derives from this array.

export const LIFE_STAGES = [
  {
    name:         'Youth',
    runsInStage:  3,
    flavourText:  'Your immune system is still learning. Every encounter leaves a mark.',
  },
  {
    name:         'Adult',
    runsInStage:  3,
    flavourText:  'Peak immune function. The threats are getting smarter.',
  },
  {
    name:         'Elderly',
    runsInStage:  3,
    flavourText:  'A lifetime of battles. The immune system carries the weight of every scar.',
  },
];

/** Total number of runs across the full meta-run. */
export function getTotalRuns() {
  return LIFE_STAGES.reduce((s, l) => s + l.runsInStage, 0);
}

/** True if the given run (0-indexed within stage) is the final run of that stage. */
export function isLastRunInStage(lifeStageIndex, runIndexInStage) {
  const stage = LIFE_STAGES[lifeStageIndex];
  if (!stage) return false;
  return runIndexInStage >= stage.runsInStage - 1;
}

/** True if this is the last life stage. */
export function isLastLifeStage(lifeStageIndex) {
  return lifeStageIndex >= LIFE_STAGES.length - 1;
}

/** True if a full meta-run has been completed. */
export function isMetaComplete(lifeStageIndex, runIndexInStage) {
  return isLastLifeStage(lifeStageIndex) && isLastRunInStage(lifeStageIndex, runIndexInStage);
}

// MetaHUD — compact in-run overlay showing life stage, run progress, and bonus objectives.
// Rendered in the game header area.
//
// The bonus objective pips are clickable — onObjectivesClick opens the BonusObjectivesPanel.

import { LIFE_STAGES } from '../data/lifeStageConfig.js';
import { BONUS_OBJECTIVE_LIBRARY } from '../data/bonusObjectiveLibrary.js';

export default function MetaHUD({ metaState, bonusObjectiveTracking, activeBonusObjectives, onObjectivesClick }) {
  if (!metaState) return null;

  const stage = LIFE_STAGES[metaState.lifeStageIndex];
  if (!stage) return null;

  const runInStage  = metaState.runIndexInStage + 1;   // 1-based for display
  const runsInStage = stage.runsInStage;
  const totalRuns   = LIFE_STAGES.reduce((s, l) => s + l.runsInStage, 0);

  const hasObjectives = (activeBonusObjectives?.length ?? 0) > 0;

  return (
    <div className="flex items-center gap-3 shrink-0">
      {/* Stage + run counter */}
      <div className="hidden md:flex flex-col items-end leading-none">
        <span className="text-xs font-mono text-gray-400 uppercase tracking-widest">
          {stage.name}
        </span>
        <span className="text-xs text-gray-600 font-mono">
          run {metaState.subRunIndex + 1}/{totalRuns}
        </span>
      </div>

      {/* Stage pip row */}
      <div className="hidden md:flex gap-0.5">
        {Array.from({ length: runsInStage }).map((_, i) => (
          <div
            key={i}
            className={`w-2 h-2 rounded-full ${
              i < metaState.runIndexInStage
                ? 'bg-green-600'
                : i === metaState.runIndexInStage
                  ? 'bg-green-400'
                  : 'bg-gray-700'
            }`}
          />
        ))}
      </div>

      {/* Bonus objective pips — clickable to open objectives panel */}
      {hasObjectives && (
        <button
          onClick={onObjectivesClick}
          className="flex gap-1 items-center hover:opacity-80 transition-opacity"
          title="View bonus objectives"
        >
          {activeBonusObjectives.map(id => {
            const obj = BONUS_OBJECTIVE_LIBRARY.find(o => o.id === id);
            if (!obj) return null;
            const tracking = bonusObjectiveTracking?.[id] ?? {};
            const failed = obj.failedEarly(tracking, { phase: 'playing', ...tracking });
            return (
              <div
                key={id}
                className={`w-2 h-2 rounded-full ${failed ? 'bg-red-700' : 'bg-yellow-500'}`}
              />
            );
          })}
        </button>
      )}
    </div>
  );
}

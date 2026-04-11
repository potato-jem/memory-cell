// BetweenRunScreen — shown after a won sub-run.
//
// Flow: run stats → bonus objective rewards (one choice per completed objective)
//       → mini or major reward choice → Start Next Run / Lifetime Complete
//
// Props:
//   metaState      — current meta state (has pendingBetweenRunChoices)
//   lastRunState   — final game state of the run just completed
//   metaDispatch   — to dispatch CHOOSE_BETWEEN_RUN_MODIFIER
//   onStartNextRun — callback when all choices resolved and player clicks Next Run
//   isMetaComplete — true if this was the last run of the last stage

import { LIFE_STAGES } from '../data/lifeStageConfig.js';
import { META_ACTION_TYPES } from '../state/metaActions.js';
import { BONUS_OBJECTIVE_LIBRARY } from '../data/bonusObjectiveLibrary.js';

const RARITY_STYLES = {
  common: { badge: 'bg-gray-700 text-gray-300',     border: 'border-gray-600 hover:border-gray-400' },
  rare:   { badge: 'bg-blue-900 text-blue-300',      border: 'border-blue-700 hover:border-blue-400' },
  epic:   { badge: 'bg-purple-900 text-purple-300',  border: 'border-purple-700 hover:border-purple-400' },
};

function getRarityStyles(rarity) {
  return RARITY_STYLES[rarity] ?? RARITY_STYLES.common;
}

// ── Stat display ───────────────────────────────────────────────────────────────

function RunStats({ lastRunState, metaState }) {
  const stage = LIFE_STAGES[metaState.lifeStageIndex - 1] // index advanced after END_RUN
    ?? LIFE_STAGES[metaState.lifeStageIndex]               // fallback
    ?? LIFE_STAGES[0];

  // The run that just completed — look back one in history
  const lastRecord = metaState.subRunHistory[metaState.subRunHistory.length - 1];

  return (
    <div className="border border-green-900 rounded-lg bg-gray-900 overflow-hidden">
      <div className="px-5 py-3 border-b border-green-900 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-widest text-green-400">
            Run Complete
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {stage?.name} · Run {metaState.subRunIndex} of {LIFE_STAGES.reduce((s, l) => s + l.runsInStage, 0)}
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-mono font-bold text-green-300">
            {lastRunState?.turn ?? lastRecord?.turn ?? '—'}
          </div>
          <div className="text-xs text-gray-500">turns</div>
        </div>
      </div>
      <div className="grid grid-cols-3 divide-x divide-gray-800 text-center py-3">
        <div>
          <div className="text-base font-mono font-bold text-gray-200">
            {lastRunState?.totalPathogensCleared ?? '—'}
          </div>
          <div className="text-xs text-gray-600">cleared</div>
        </div>
        <div>
          <div className="text-base font-mono font-bold text-gray-200">
            {Math.round(lastRunState?.systemicIntegrity ?? 100)}
          </div>
          <div className="text-xs text-gray-600">integrity</div>
        </div>
        <div>
          <div className={`text-base font-mono font-bold ${(lastRunState?.scars?.length ?? 0) > 0 ? 'text-orange-400' : 'text-gray-200'}`}>
            {lastRunState?.scars?.length ?? 0}
          </div>
          <div className="text-xs text-gray-600">scars</div>
        </div>
      </div>
    </div>
  );
}

// ── Bonus objective summary ────────────────────────────────────────────────────

function BonusObjectiveResults({ metaState, lastRunState }) {
  const active = metaState.activeBonusObjectives ?? [];
  // Restore active objectives from the run that just ended — they're cleared in END_RUN
  // so we get them from the lastRunState instead
  const objectiveIds = lastRunState?.activeBonusObjectives ?? active;

  if (!objectiveIds.length) return null;

  return (
    <div className="border border-gray-800 rounded-lg bg-gray-900 overflow-hidden">
      <div className="px-4 py-2 border-b border-gray-800">
        <span className="text-xs text-gray-500 uppercase tracking-widest">Bonus Objectives</span>
      </div>
      <div className="divide-y divide-gray-800">
        {objectiveIds.map(id => {
          const obj = BONUS_OBJECTIVE_LIBRARY.find(o => o.id === id);
          if (!obj) return null;
          const tracking = lastRunState?.bonusObjectiveTracking?.[id] ?? {};
          const completed = obj.isComplete(tracking, lastRunState ?? {});
          return (
            <div key={id} className="flex items-center gap-3 px-4 py-2.5">
              <span className={`text-sm ${completed ? 'text-green-400' : 'text-gray-600'}`}>
                {completed ? '✓' : '✗'}
              </span>
              <div className="flex-1">
                <div className={`text-sm font-medium ${completed ? 'text-gray-200' : 'text-gray-600'}`}>
                  {obj.name}
                </div>
                <div className={`text-xs ${completed ? 'text-gray-500' : 'text-gray-700'}`}>
                  {obj.description}
                </div>
              </div>
              {completed && (
                <span className="text-xs text-green-600 uppercase tracking-wide">reward ↓</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Modifier choice panel ──────────────────────────────────────────────────────

function ModifierChoicePanel({ choice, onChoose }) {
  const isBonus    = choice.type === 'bonusObjectiveReward';
  const isMajor    = choice.type === 'majorReward';

  const headerColor = isBonus ? 'border-yellow-900' : isMajor ? 'border-purple-900' : 'border-blue-900';
  const labelColor  = isBonus ? 'text-yellow-400'   : isMajor ? 'text-purple-400'   : 'text-blue-400';

  return (
    <div className={`border rounded-lg bg-gray-900 overflow-hidden ${headerColor.replace('border-', 'border ')}`}>
      <div className={`px-5 py-3 border-b ${headerColor}`}>
        <h3 className={`text-xs font-semibold uppercase tracking-widest ${labelColor}`}>
          {isBonus ? 'Bonus Reward' : isMajor ? 'Stage Reward' : 'Run Reward'}
        </h3>
        <p className="text-gray-300 text-sm mt-0.5">{choice.label} — choose one</p>
      </div>
      <div className="p-4 flex flex-col gap-3">
        {choice.options.map((option, idx) => {
          const styles = getRarityStyles(option.rarity);
          return (
            <button
              key={option.modifierId + idx}
              onClick={() => onChoose(idx)}
              className={`w-full text-left border rounded p-3 transition-colors bg-gray-950 ${styles.border}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-white text-sm font-medium">{option.name}</span>
                <span className={`text-xs px-2 py-0.5 rounded ${styles.badge}`}>
                  {option.rarity}
                </span>
              </div>
              <p className="text-gray-400 text-xs leading-snug">{option.description}</p>
              {option.effectLabel && (
                <p className="text-xs font-bold mt-1" style={{ color: option.effectColor ?? '#94a3b8' }}>
                  {option.effectLabel}
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Stage progress ─────────────────────────────────────────────────────────────

function StageProgress({ metaState }) {
  return (
    <div className="flex items-center gap-2">
      {LIFE_STAGES.map((stage, idx) => {
        const isCurrent = idx === metaState.lifeStageIndex;
        const isPast    = idx < metaState.lifeStageIndex;
        return (
          <div key={idx} className="flex-1 text-center">
            <div className={`text-xs font-mono uppercase tracking-widest mb-1 ${
              isCurrent ? 'text-gray-300' : isPast ? 'text-green-600' : 'text-gray-700'
            }`}>
              {stage.name}
            </div>
            <div className="flex gap-0.5 justify-center">
              {Array.from({ length: stage.runsInStage }).map((_, runIdx) => {
                const globalRunStart = LIFE_STAGES.slice(0, idx).reduce((s, l) => s + l.runsInStage, 0);
                const globalRun = globalRunStart + runIdx;
                const done = globalRun < metaState.subRunIndex;
                return (
                  <div
                    key={runIdx}
                    className={`h-1.5 flex-1 rounded-full ${
                      done ? 'bg-green-600' : isCurrent && runIdx < metaState.runIndexInStage ? 'bg-green-900' : 'bg-gray-800'
                    }`}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function BetweenRunScreen({ metaState, lastRunState, metaDispatch, onStartNextRun, isMetaComplete }) {
  const pending = metaState.pendingBetweenRunChoices ?? [];
  const hasPending = pending.length > 0;

  const handleChoose = (optionIndex) => {
    metaDispatch({ type: META_ACTION_TYPES.CHOOSE_BETWEEN_RUN_MODIFIER, optionIndex });
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-950 text-gray-300 p-4">
      <div className="w-full max-w-lg space-y-4">

        {/* Stage progress bar */}
        <StageProgress metaState={metaState} />

        {/* Run stats */}
        <RunStats lastRunState={lastRunState} metaState={metaState} />

        {/* Bonus objective results */}
        <BonusObjectiveResults metaState={metaState} lastRunState={lastRunState} />

        {/* Pending choice or CTA */}
        {hasPending ? (
          <ModifierChoicePanel choice={pending[0]} onChoose={handleChoose} />
        ) : (
          <button
            onClick={onStartNextRun}
            className={`w-full py-3.5 font-mono font-bold uppercase tracking-widest border rounded-lg transition-colors text-sm cta-breathe ${
              isMetaComplete
                ? 'bg-yellow-900 hover:bg-yellow-800 text-yellow-200 border-yellow-700'
                : 'bg-green-900 hover:bg-green-800 text-green-200 border-green-700'
            }`}
          >
            {isMetaComplete ? 'Lifetime Complete — Start New Lifetime' : 'Start Next Run →'}
          </button>
        )}

        {/* Pending count indicator */}
        {hasPending && pending.length > 1 && (
          <p className="text-center text-xs text-gray-700">
            {pending.length - 1} more choice{pending.length > 2 ? 's' : ''} after this
          </p>
        )}

      </div>
    </div>
  );
}

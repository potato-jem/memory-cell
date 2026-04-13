// BonusObjectivesPanel — in-run panel showing bonus objective progress.
//
// Shown when the player clicks the objective status indicators in MetaHUD.
// Each objective shows: status indicator, name, description, and (if not failed)
// the pre-selected reward card they'll earn for completing it.
//
// Props:
//   activeBonusObjectives   — string[] of active objective ids
//   bonusObjectiveTracking  — { [id]: tracking } from game state
//   bonusObjectiveRewards   — { [id]: option } pre-selected rewards
//   onClose                 — callback to dismiss panel

import { BONUS_OBJECTIVE_LIBRARY } from '../data/bonusObjectiveLibrary.js';
import ModifierCard from './ModifierCard.jsx';

export default function BonusObjectivesPanel({
  activeBonusObjectives,
  bonusObjectiveTracking,
  bonusObjectiveRewards,
  onClose,
}) {
  const objectives = (activeBonusObjectives ?? [])
    .map(id => BONUS_OBJECTIVE_LIBRARY.find(o => o.id === id))
    .filter(Boolean);

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-start justify-end p-4 pt-14"
      onClick={onClose}
    >
      <div
        className="bg-gray-950 border border-gray-800 rounded-lg shadow-2xl w-full max-w-sm overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800">
          <span className="text-xs font-semibold uppercase tracking-widest text-gray-500">Bonus Objectives</span>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-400 text-xl leading-none w-6 h-6 flex items-center justify-center">
            ×
          </button>
        </div>

        {/* Objectives */}
        {objectives.length === 0 ? (
          <div className="px-4 py-6 text-center text-gray-700 text-sm">No active objectives this run</div>
        ) : (
          <div className="divide-y divide-gray-900">
            {objectives.map(obj => {
              const tracking = bonusObjectiveTracking?.[obj.id] ?? {};
              // Use a minimal partial state to check failedEarly
              const failed = obj.failedEarly(tracking, { phase: 'playing', ...tracking });
              const reward = bonusObjectiveRewards?.[obj.id];

              return (
                <div key={obj.id} className="p-4 space-y-2.5">
                  {/* Status + name */}
                  <div className="flex items-center gap-2.5">
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${failed ? 'bg-red-700' : 'bg-yellow-500'}`} />
                    <span className={`text-sm font-medium ${failed ? 'text-gray-600' : 'text-gray-200'}`}>
                      {obj.name}
                    </span>
                    {failed && (
                      <span className="ml-auto text-xs text-red-800 uppercase tracking-wide">failed</span>
                    )}
                  </div>

                  {/* Description */}
                  <p className={`text-xs pl-5 ${failed ? 'text-gray-700' : 'text-gray-500'}`}>
                    {obj.description}
                  </p>

                  {/* Pre-selected reward */}
                  {reward && !failed && (
                    <div className="pl-5">
                      <div className="text-xs text-gray-700 uppercase tracking-wide mb-1.5">
                        Reward if completed
                      </div>
                      <ModifierCard option={reward} />
                    </div>
                  )}
                  {!reward && !failed && (
                    <p className="text-xs pl-5 text-gray-700 italic">No reward preview available</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

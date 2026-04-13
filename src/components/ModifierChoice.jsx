// ModifierChoice — modal overlay for upgrade and scar choice events.
//
// Shown when state.pendingModifierChoices.length > 0.
// Presents the first pending choice; player must pick before continuing.
// Dispatches CHOOSE_MODIFIER with the selected option index.

import { ACTION_TYPES } from '../state/actions.js';
import ModifierCard from './ModifierCard.jsx';

// ── Main component ─────────────────────────────────────────────────────────────

export default function ModifierChoice({ pendingModifierChoices, dispatch }) {
  if (!pendingModifierChoices?.length) return null;

  const choice = pendingModifierChoices[0];
  const isUpgrade = choice.category === 'upgrade';
  const remaining = pendingModifierChoices.length;

  const handleChoose = (optionIndex) => {
    dispatch({ type: ACTION_TYPES.CHOOSE_MODIFIER, optionIndex });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-40 p-4">
      <div className="bg-gray-950 border border-gray-700 max-w-xl w-full rounded shadow-2xl">

        {/* Header */}
        <div className={`px-5 py-4 border-b ${isUpgrade ? 'border-green-900' : 'border-red-900'}`}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className={`text-sm font-semibold uppercase tracking-widest mb-0.5 ${isUpgrade ? 'text-green-400' : 'text-red-400'}`}>
                {isUpgrade ? 'Upgrade' : 'Scar'}
              </h2>
              <p className="text-gray-300 text-sm">
                {isUpgrade
                  ? 'Pathogen cleared — choose a lasting benefit'
                  : 'Tissue integrity threshold crossed — choose which consequence to accept'}
              </p>
            </div>
            {remaining > 1 && (
              <span className="text-xs text-gray-500 ml-4 shrink-0">{remaining} choices pending</span>
            )}
          </div>

          {/* Trigger context */}
          {choice.pathogenType && (
            <p className="text-xs text-gray-500 mt-1">
              Cleared: <span className="text-gray-400">{choice.pathogenType}</span>
              {choice.nodeId && <> at <span className="text-gray-400">{choice.nodeId}</span></>}
            </p>
          )}
          {choice.category === 'scar' && choice.nodeId && (
            <p className="text-xs text-gray-500 mt-1">
              Site: <span className="text-gray-400">{choice.nodeId}</span>
              {choice.threshold != null && <> — integrity at <span className="text-gray-400">{choice.threshold}%</span></>}
            </p>
          )}
          {choice.category === 'scar' && !choice.nodeId && (
            <p className="text-xs text-gray-500 mt-1">Systemic integrity threshold crossed</p>
          )}
        </div>

        {/* Options */}
        <div className="p-4 flex flex-col gap-3">
          {choice.options.map((option, idx) => (
            <ModifierCard
              key={option.modifierId + idx}
              option={option}
              onClick={() => handleChoose(idx)}
            />
          ))}
        </div>

      </div>
    </div>
  );
}

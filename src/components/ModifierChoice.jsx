// ModifierChoice — modal overlay for upgrade and scar choice events.
//
// Shown when state.pendingModifierChoices.length > 0.
// Presents the first pending choice; player must pick before continuing.
// Dispatches CHOOSE_MODIFIER with the selected option index.

import { ACTION_TYPES } from '../state/actions.js';

// ── Rarity colour mappings ─────────────────────────────────────────────────────

const UPGRADE_RARITY_STYLES = {
  common: { badge: 'bg-gray-700 text-gray-300',  border: 'border-gray-600 hover:border-gray-400', label: 'Common' },
  rare:   { badge: 'bg-blue-900 text-blue-300',   border: 'border-blue-700 hover:border-blue-400', label: 'Rare'   },
  epic:   { badge: 'bg-purple-900 text-purple-300', border: 'border-purple-700 hover:border-purple-400', label: 'Epic' },
};

const SCAR_RARITY_STYLES = {
  minor:    { badge: 'bg-yellow-900 text-yellow-300',  border: 'border-yellow-700 hover:border-yellow-500', label: 'Minor'    },
  moderate: { badge: 'bg-orange-900 text-orange-300',  border: 'border-orange-700 hover:border-orange-500', label: 'Moderate' },
  severe:   { badge: 'bg-red-900 text-red-300',        border: 'border-red-800 hover:border-red-500',       label: 'Severe'   },
};

function getRarityStyles(category, rarity) {
  if (category === 'scar') return SCAR_RARITY_STYLES[rarity] ?? SCAR_RARITY_STYLES.minor;
  return UPGRADE_RARITY_STYLES[rarity] ?? UPGRADE_RARITY_STYLES.common;
}

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
          {choice.options.map((option, idx) => {
            const styles = getRarityStyles(option.category, option.rarity);
            return (
              <button
                key={option.modifierId + idx}
                onClick={() => handleChoose(idx)}
                className={`w-full text-left border rounded p-3 transition-colors bg-gray-900 ${styles.border}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-white text-sm font-medium">{option.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${styles.badge}`}>
                    {styles.label}
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
    </div>
  );
}

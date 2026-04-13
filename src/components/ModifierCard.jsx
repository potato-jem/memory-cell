// ModifierCard — shared card for all modifier display contexts.
//
// Design: effect label is the primary visual element (large, colored).
// Impact chips show which cell/pathogen/node is affected (colored with type colors).
// Name + rarity are secondary. Description/flavor text is de-emphasized.
//
// Props:
//   option   — modifier option object: { name, category, rarity, effectLabel, effectColor,
//              description, context: { clearingCellType, clearedPathogenType, nodeId } }
//   onClick  — if provided, wraps in a button
//   compact  — if true, renders as a single compact row (for modifier list/screen)

import { CELL_CONFIG } from '../data/cellConfig.js';
import { PATHOGEN_DISPLAY_NAMES, PATHOGEN_RING_COLORS } from '../data/pathogens.js';

// ── Rarity styles ─────────────────────────────────────────────────────────────

const UPGRADE_RARITY = {
  common: { badge: 'bg-gray-700 text-gray-400',     border: 'border-gray-600 hover:border-gray-400', label: 'Common' },
  rare:   { badge: 'bg-blue-900 text-blue-300',      border: 'border-blue-700 hover:border-blue-400', label: 'Rare'   },
  epic:   { badge: 'bg-purple-900 text-purple-300',  border: 'border-purple-700 hover:border-purple-400', label: 'Epic' },
};

const SCAR_RARITY = {
  minor:    { badge: 'bg-yellow-900 text-yellow-400', border: 'border-yellow-700 hover:border-yellow-500', label: 'Minor'    },
  moderate: { badge: 'bg-orange-900 text-orange-300', border: 'border-orange-700 hover:border-orange-500', label: 'Moderate' },
  severe:   { badge: 'bg-red-900 text-red-300',       border: 'border-red-800   hover:border-red-500',     label: 'Severe'   },
};

function getRarityStyle(category, rarity) {
  if (category === 'scar') return SCAR_RARITY[rarity] ?? SCAR_RARITY.minor;
  return UPGRADE_RARITY[rarity] ?? UPGRADE_RARITY.common;
}

// ── Impact chips ──────────────────────────────────────────────────────────────
// Shows WHAT the modifier affects — not the trigger context.
//
// Scope is derived from effectScope (explicit) > effectColorKey (fallback):
//   'cell'         → one chip: the affected cell type
//   'pathogen'     → one chip: the affected pathogen type
//   'cell_pathogen'→ two chips: both
//   'node'         → one chip: the node id
//   'global'       → one chip: "Global"
//   effectColorKey='systemic' + nodeId in context → 'node' (node scars)

function deriveScope(option) {
  if (option.effectScope) return option.effectScope;
  const key = option.effectColorKey;
  if (key === 'cell')     return 'cell';
  if (key === 'pathogen') return 'pathogen';
  if (key === 'systemic' && option.context?.nodeId) return 'node';
  return 'global';
}

function CellChip({ cellType }) {
  const cfg = CELL_CONFIG[cellType];
  const color = cfg?.color ?? '#94a3b8';
  return (
    <span
      className="text-xs px-1.5 py-0.5 rounded font-medium border leading-none"
      style={{ color, borderColor: color + '50', backgroundColor: color + '15' }}
    >
      {cfg?.displayName ?? cellType}
    </span>
  );
}

function PathogenChip({ pathogenType }) {
  const color = PATHOGEN_RING_COLORS[pathogenType] ?? '#94a3b8';
  return (
    <span
      className="text-xs px-1.5 py-0.5 rounded font-medium border leading-none"
      style={{ color, borderColor: color + '50', backgroundColor: color + '15' }}
    >
      {PATHOGEN_DISPLAY_NAMES[pathogenType] ?? pathogenType}
    </span>
  );
}

function ImpactChips({ option }) {
  const scope = deriveScope(option);
  const ctx = option.context;
  const chips = [];

  if ((scope === 'cell' || scope === 'cell_pathogen') && ctx?.clearingCellType) {
    chips.push(<CellChip key="cell" cellType={ctx.clearingCellType} />);
  }
  if ((scope === 'pathogen' || scope === 'cell_pathogen') && ctx?.clearedPathogenType) {
    chips.push(<PathogenChip key="pathogen" pathogenType={ctx.clearedPathogenType} />);
  }
  if (scope === 'node' && ctx?.nodeId) {
    chips.push(
      <span key="node" className="text-xs px-1.5 py-0.5 rounded font-medium border leading-none text-gray-500 border-gray-700 bg-gray-900">
        {ctx.nodeId}
      </span>
    );
  }
  if (scope === 'global' || chips.length === 0) {
    chips.push(
      <span key="global" className="text-xs px-1.5 py-0.5 rounded font-medium border leading-none text-gray-600 border-gray-800 bg-gray-900">
        Global
      </span>
    );
  }

  return <div className="flex gap-1 flex-wrap mt-1.5">{chips}</div>;
}

// ── Full card ─────────────────────────────────────────────────────────────────

function FullCard({ option, clickable }) {
  const style = getRarityStyle(option.category, option.rarity);
  const isScar = option.category === 'scar';
  const defaultColor = isScar ? '#f87171' : '#4ade80';
  const effectColor = option.effectColor ?? defaultColor;

  return (
    <div className={`w-full text-left border rounded p-3 bg-gray-900 ${style.border} ${clickable ? 'transition-colors' : ''}`}>
      {/* Effect — most prominent */}
      {option.effectLabel && (
        <div className="text-sm font-bold leading-snug" style={{ color: effectColor }}>
          {option.effectLabel}
        </div>
      )}

      {/* Impact chips */}
      <ImpactChips option={option} />

      {/* Name + rarity */}
      <div className="flex items-center justify-between mt-2">
        <span className="text-gray-400 text-xs font-medium">{option.name}</span>
        <span className={`text-xs px-2 py-0.5 rounded ${style.badge}`}>{style.label}</span>
      </div>

      {/* Flavor text */}
      {option.description && (
        <p className="text-gray-700 text-xs leading-snug mt-0.5">{option.description}</p>
      )}
    </div>
  );
}

// ── Compact row (for modifier screen list) ─────────────────────────────────────

function CompactRow({ option, onClick, expanded, onToggle }) {
  const style = getRarityStyle(option.category, option.rarity);
  const isScar = option.category === 'scar';
  const defaultColor = isScar ? '#f87171' : '#4ade80';
  const effectColor = option.effectColor ?? defaultColor;

  return (
    <div>
      <div
        className={`flex items-center gap-3 px-3 py-2 border-b border-gray-800 last:border-0 ${onToggle ? 'cursor-pointer hover:bg-gray-900' : ''}`}
        onClick={onToggle}
      >
        <span className="text-xs font-bold font-mono shrink-0" style={{ color: effectColor, minWidth: '9rem' }}>
          {option.effectLabel ?? option.name}
        </span>
        <div className="flex gap-1 flex-wrap flex-1 min-w-0">
          <ImpactChips option={option} />
        </div>
        <span className="text-xs text-gray-600 truncate hidden sm:block max-w-[8rem]">{option.name}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${style.badge}`}>{style.label}</span>
        {onToggle && (
          <span className="text-gray-700 text-xs shrink-0">{expanded ? '▴' : '▾'}</span>
        )}
      </div>
      {expanded && (
        <div className="px-3 py-2 bg-gray-950 border-b border-gray-800">
          <FullCard option={option} />
        </div>
      )}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * @param {Object}   option   — the option / history entry to display
 * @param {Function} onClick  — if provided, wraps full card in a button
 * @param {boolean}  compact  — render as compact list row (for ModifierScreen)
 * @param {boolean}  expanded — (compact mode) expand to show full card below row
 * @param {Function} onToggle — (compact mode) toggle expand/collapse
 */
export default function ModifierCard({ option, onClick, compact = false, expanded = false, onToggle }) {
  if (compact) {
    return <CompactRow option={option} onClick={onClick} expanded={expanded} onToggle={onToggle} />;
  }

  if (onClick) {
    return (
      <button className="w-full" onClick={onClick}>
        <FullCard option={option} clickable />
      </button>
    );
  }

  return <FullCard option={option} />;
}

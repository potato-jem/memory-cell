// ModifierScreen — overlay showing all modifiers acquired during this run + persistent meta modifiers.
//
// Can be opened at any time (during run, between runs) from the header.
// Modifiers grouped by scope toggle: All | Cells | Nodes | Pathogens | Systemic
// Compact list by default; click a row to expand the full card.
//
// Props:
//   modifierHistory     — state.modifierHistory (in-run upgrades + scars)
//   metaModifierHistory — metaState.metaModifierHistory (persistent between-run picks)
//   onClose             — callback to dismiss overlay

import { useState } from 'react';
import ModifierCard from './ModifierCard.jsx';

const TABS = ['all', 'cell', 'node', 'pathogen', 'systemic'];
const TAB_LABELS = { all: 'All', cell: 'Cells', node: 'Nodes', pathogen: 'Pathogens', systemic: 'Systemic' };

/** Determine which scope tab an entry belongs to based on its context. */
function getScope(entry) {
  if (entry.context?.nodeId) return 'node';
  if (entry.context?.clearingCellType) return 'cell';
  if (entry.context?.clearedPathogenType) return 'pathogen';
  return 'systemic';
}

export default function ModifierScreen({ modifierHistory, metaModifierHistory, onClose }) {
  const [tab, setTab]         = useState('all');
  const [expandedIdx, setExpandedIdx] = useState(null);

  const runEntries  = (modifierHistory ?? []).map(e => ({ ...e, _source: 'run' }));
  const metaEntries = (metaModifierHistory ?? []).map(e => ({ ...e, _source: 'meta' }));
  const allEntries  = [...runEntries, ...metaEntries];

  const filtered = tab === 'all' ? allEntries : allEntries.filter(e => getScope(e) === tab);

  const upgrades = filtered.filter(e => e.category === 'upgrade');
  const scars    = filtered.filter(e => e.category === 'scar');

  function handleToggle(globalIdx) {
    setExpandedIdx(prev => prev === globalIdx ? null : globalIdx);
  }

  // Track global index across sections for expand state
  let idx = 0;

  function renderSection(entries, label, labelClass) {
    if (!entries.length) return null;
    return (
      <section key={label}>
        <div className={`text-xs uppercase tracking-widest px-3 pt-3 pb-1 font-semibold ${labelClass}`}>
          {label}
        </div>
        <div className="border border-gray-800 rounded overflow-hidden mx-3 mb-3">
          {entries.map((entry) => {
            const globalIdx = idx++;
            return (
              <ModifierCard
                key={globalIdx}
                option={entry}
                compact
                expanded={expandedIdx === globalIdx}
                onToggle={() => handleToggle(globalIdx)}
              />
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-950 border border-gray-700 max-w-2xl w-full max-h-[85vh] flex flex-col rounded shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800 shrink-0">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-300">Active Modifiers</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 text-xl leading-none w-7 h-7 flex items-center justify-center"
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-800 shrink-0">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setExpandedIdx(null); }}
              className={`flex-1 py-2 text-xs font-mono uppercase tracking-wider transition-colors ${
                tab === t
                  ? 'text-gray-200 border-b-2 border-gray-400 -mb-px'
                  : 'text-gray-600 hover:text-gray-400'
              }`}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 py-1">
          {allEntries.length === 0 && (
            <p className="text-center text-gray-700 text-sm py-10">No modifiers acquired yet.</p>
          )}

          {filtered.length === 0 && allEntries.length > 0 && (
            <p className="text-center text-gray-700 text-sm py-10">
              No {TAB_LABELS[tab].toLowerCase()} modifiers this run.
            </p>
          )}

          {(() => {
            idx = 0; // reset for render
            return (
              <>
                {renderSection(upgrades, 'Upgrades', 'text-green-800')}
                {renderSection(scars,    'Scars',    'text-red-900')}
              </>
            );
          })()}

          {metaEntries.length > 0 && tab === 'all' && (
            <p className="text-xs text-gray-800 text-center pb-3">
              ↑ Persistent modifiers marked — active across all future runs
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

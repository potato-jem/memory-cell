// SituationSelector — shown on game start and after post-mortem.
// Lists available situations with descriptions and memory bank status.

import { UNINVITED_GUEST } from '../data/situations/uninvitedGuest.js';
import { SILENT_INVADER } from '../data/situations/silentInvader.js';
import { SHADOW_GROWTH } from '../data/situations/shadowGrowth.js';
import { FRIENDLY_FIRE } from '../data/situations/friendlyFire.js';
import { IMPERSONATOR } from '../data/situations/impersonator.js';
import { THREAT_TYPE_DISPLAY_NAMES, getMemoryBankSummary } from '../engine/memory.js';
import { THREAT_TYPES } from '../data/signals.js';

const ALL_SITUATIONS = [
  UNINVITED_GUEST,
  SILENT_INVADER,
  SHADOW_GROWTH,
  FRIENDLY_FIRE,
  IMPERSONATOR,
];

const THREAT_COLORS = {
  [THREAT_TYPES.BACTERIAL]: 'text-orange-400 border-orange-800',
  [THREAT_TYPES.VIRAL]: 'text-blue-400 border-blue-800',
  [THREAT_TYPES.CANCER]: 'text-purple-400 border-purple-800',
  [THREAT_TYPES.AUTOIMMUNE]: 'text-red-400 border-red-800',
  [THREAT_TYPES.MIMIC]: 'text-yellow-400 border-yellow-800',
};

const THREAT_BG = {
  [THREAT_TYPES.BACTERIAL]: 'bg-orange-950',
  [THREAT_TYPES.VIRAL]: 'bg-blue-950',
  [THREAT_TYPES.CANCER]: 'bg-purple-950',
  [THREAT_TYPES.AUTOIMMUNE]: 'bg-red-950',
  [THREAT_TYPES.MIMIC]: 'bg-yellow-950',
};

const DIFFICULTY = {
  [THREAT_TYPES.BACTERIAL]: 'Standard',
  [THREAT_TYPES.VIRAL]: 'Standard',
  [THREAT_TYPES.CANCER]: 'Hard',
  [THREAT_TYPES.AUTOIMMUNE]: 'Hard',
  [THREAT_TYPES.MIMIC]: 'Advanced',
};

export default function SituationSelector({ memoryBank, onSelect, onSelectConcurrent }) {
  const memorySummary = getMemoryBankSummary(memoryBank ?? {});

  // Concurrent mode: pair two non-conflicting situations
  const concurrentPairs = [
    { primary: UNINVITED_GUEST, secondary: SILENT_INVADER, label: 'Gut + Throat' },
    { primary: SHADOW_GROWTH, secondary: SILENT_INVADER, label: 'Cancer + Viral' },
  ];

  return (
    <div className="fixed inset-0 bg-gray-950 flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="px-8 pt-12 pb-6">
        <div className="text-xs text-gray-600 uppercase tracking-widest mb-2">Memory Cell</div>
        <h1 className="text-2xl font-mono text-gray-200 mb-2">Select Situation</h1>
        <p className="text-sm text-gray-600 max-w-lg">
          Choose a situation to investigate. Each represents a distinct threat type with its own signal language.
        </p>
      </div>

      {/* Memory bank */}
      {memorySummary.length > 0 && (
        <div className="px-8 pb-6">
          <div className="border border-gray-800 p-4 max-w-lg">
            <div className="text-xs text-gray-600 uppercase tracking-wider mb-2">
              Immunological Memory
            </div>
            <div className="space-y-1">
              {memorySummary.map(mem => (
                <div key={mem.type} className="flex items-center gap-3 text-xs">
                  <div className="w-2 h-2 rounded-full bg-purple-600" />
                  <span className="text-gray-400">{mem.displayName}</span>
                  <span className="text-gray-600">{mem.strength} memory</span>
                  <span className="text-gray-700">× {mem.encounterCount}</span>
                  <span className="text-purple-700 ml-auto">signal clarity +</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Single situation cards */}
      <div className="px-8 pb-6">
        <div className="text-xs text-gray-600 uppercase tracking-wider mb-3">Single Situations</div>
        <div className="grid grid-cols-1 gap-3 max-w-2xl">
          {ALL_SITUATIONS.map(sit => {
            const threatType = sit.pathogen.type;
            const colorClass = THREAT_COLORS[threatType] ?? 'text-gray-400 border-gray-700';
            const bgClass = THREAT_BG[threatType] ?? 'bg-gray-900';
            const hasMemory = memorySummary.some(m => m.type === threatType);
            const difficulty = DIFFICULTY[threatType] ?? 'Standard';

            return (
              <button
                key={sit.id}
                onClick={() => onSelect(sit)}
                className={`text-left border p-4 hover:opacity-90 transition-opacity ${colorClass} ${bgClass}`}
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <div className={`text-sm font-mono ${colorClass.split(' ')[0]}`}>{sit.name}</div>
                    <div className="text-xs text-gray-600 mt-0.5">
                      {THREAT_TYPE_DISPLAY_NAMES[threatType] ?? threatType}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={`text-xs font-mono px-1 border rounded ${colorClass}`}>
                      {difficulty}
                    </span>
                    {hasMemory && (
                      <span className="text-xs text-purple-600">MEMORY ACTIVE</span>
                    )}
                  </div>
                </div>
                <p className="text-xs text-gray-500 leading-relaxed italic">
                  &ldquo;{sit.description}&rdquo;
                </p>
                <div className="mt-2 flex gap-4 text-xs text-gray-700">
                  <span>{sit.turnLimit} turn limit</span>
                  <span>{Math.round(sit.signalAccuracyRate * 100)}% signal accuracy</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Concurrent mode */}
      <div className="px-8 pb-12">
        <div className="text-xs text-gray-600 uppercase tracking-wider mb-3">Concurrent Mode — Two Simultaneous</div>
        <div className="grid grid-cols-1 gap-3 max-w-2xl">
          {concurrentPairs.map((pair, i) => (
            <button
              key={i}
              onClick={() => onSelectConcurrent(pair.primary, pair.secondary)}
              className="text-left border border-gray-700 bg-gray-900 p-4 hover:bg-gray-800 transition-colors"
            >
              <div className="text-sm font-mono text-gray-400 mb-1">
                Concurrent: {pair.label}
              </div>
              <div className="flex gap-3 text-xs text-gray-600">
                <span>{pair.primary.name}</span>
                <span>+</span>
                <span>{pair.secondary.name}</span>
              </div>
              <p className="text-xs text-gray-700 mt-1">
                Shared token pool. Signals from both situations in one queue.
              </p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

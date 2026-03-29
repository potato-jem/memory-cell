// PostMortem — shown on loss. Overlays main UI.
// Shows: failure mode, stress/integrity trajectory, site status at end, scars.

import { NODES } from '../data/nodes.js';
import { PATHOGEN_DISPLAY_NAMES } from '../data/pathogens.js';
import { getMemoryBankSummary } from '../engine/memory.js';

const FAILURE_MODE_DESCRIPTIONS = {
  systemic_collapse: {
    heading: 'Systemic Collapse',
    subtext: 'Sustained pressure overwhelmed the body\'s defences. Integrity failed.',
    color: 'text-red-400',
    border: 'border-red-900',
    bg: 'bg-red-950',
  },
  systemic_overload: {
    heading: 'Systemic Overload',
    subtext: 'Stress spiked to critical levels and could not be brought down in time.',
    color: 'text-orange-400',
    border: 'border-orange-900',
    bg: 'bg-orange-950',
  },
  sustained_pressure: {
    heading: 'Sustained Pressure',
    subtext: 'Prolonged infections ground the body down. Integrity eroded over many turns.',
    color: 'text-yellow-400',
    border: 'border-yellow-900',
    bg: 'bg-yellow-950',
  },
  progressive_degradation: {
    heading: 'Progressive Degradation',
    subtext: 'Tissue damage accumulated across multiple sites until recovery was impossible.',
    color: 'text-gray-400',
    border: 'border-gray-700',
    bg: 'bg-gray-900',
  },
  unknown: {
    heading: 'Run Complete',
    subtext: 'The situation resolved.',
    color: 'text-gray-400',
    border: 'border-gray-800',
    bg: 'bg-gray-900',
  },
};

export default function PostMortem({ postMortem, onRestart }) {
  if (!postMortem) return null;

  const modeKey = postMortem.failureMode ?? 'unknown';
  const modeInfo = FAILURE_MODE_DESCRIPTIONS[modeKey] ?? FAILURE_MODE_DESCRIPTIONS.unknown;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-85 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-950 border border-gray-800 max-w-3xl w-full max-h-screen overflow-y-auto rounded">

        {/* Header */}
        <div className={`p-6 border-b ${modeInfo.border} ${modeInfo.bg}`}>
          <div className="text-xs text-gray-600 uppercase tracking-widest mb-2">
            Run Ended — Turn {postMortem.turnsPlayed}
          </div>
          <h2 className={`text-2xl font-mono ${modeInfo.color} mb-2`}>
            {modeInfo.heading}
          </h2>
          <p className="text-sm text-gray-400 leading-relaxed">{modeInfo.subtext}</p>
        </div>

        <div className="p-6 space-y-6">

          {/* Stress / integrity trajectory */}
          <section>
            <h3 className="text-xs text-gray-600 uppercase tracking-wider mb-3">
              Stress &amp; Integrity Over Time
            </h3>
            <StressGraph history={postMortem.systemicStressHistory} />
          </section>

          {/* Site status at end */}
          <section>
            <h3 className="text-xs text-gray-600 uppercase tracking-wider mb-3">
              Final Site Status
            </h3>
            <SiteGrid
              nodeStates={postMortem.finalNodeStates}
              spreadHistory={postMortem.spreadHistory}
            />
          </section>

          {/* Scars */}
          {postMortem.scars?.length > 0 && (
            <section>
              <h3 className="text-xs text-gray-600 uppercase tracking-wider mb-3">
                Permanent Damage ({postMortem.scars.length})
              </h3>
              <div className="space-y-1">
                {postMortem.scars.map(scar => (
                  <div key={scar.id} className="text-xs text-red-700 font-mono border border-red-950 px-2 py-1 bg-red-950 bg-opacity-30">
                    {scar.description}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Memory bank */}
          {postMortem.memoryBank && (
            <section>
              <h3 className="text-xs text-gray-600 uppercase tracking-wider mb-3">
                Immunological Memory (carries forward)
              </h3>
              <MemoryBankSummary memoryBank={postMortem.memoryBank} />
            </section>
          )}

        </div>

        {/* Restart */}
        <div className="p-6 border-t border-gray-800 flex justify-center">
          <button
            onClick={onRestart}
            className="px-8 py-2 bg-gray-900 hover:bg-gray-800 text-gray-300 text-sm font-mono border border-gray-700 transition-colors"
          >
            New Run
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Stress / integrity graph ──────────────────────────────────────────────────

function StressGraph({ history }) {
  if (!history || history.length < 2) return (
    <div className="text-xs text-gray-700 italic">Not enough data.</div>
  );

  const width = 500;
  const height = 90;
  const pad = { top: 8, right: 8, bottom: 20, left: 30 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const maxTurn = history[history.length - 1].turn;
  const xScale = t => pad.left + (maxTurn > 0 ? (t / maxTurn) * plotW : 0);
  const yScale = v => pad.top + (1 - v / 100) * plotH;

  const stressPoints  = history.map(h => `${xScale(h.turn)},${yScale(h.stress)}`).join(' ');
  const integrityPoints = history.map(h => `${xScale(h.turn)},${yScale(h.integrity)}`).join(' ');

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} className="font-mono">
        {/* Danger zone */}
        <rect x={pad.left} y={yScale(100)} width={plotW} height={yScale(80) - yScale(100)}
          fill="#450a0a" opacity="0.25" />

        {/* Grid lines */}
        {[0, 50, 80, 100].map(v => (
          <g key={v}>
            <line x1={pad.left} y1={yScale(v)} x2={width - pad.right} y2={yScale(v)}
              stroke="#1e293b" strokeWidth="1" />
            <text x={pad.left - 4} y={yScale(v) + 3} textAnchor="end" fontSize="7" fill="#4b5563">{v}</text>
          </g>
        ))}

        {/* Integrity line (green→red) */}
        <polyline points={integrityPoints} fill="none" stroke="#4ade80" strokeWidth="1.5" opacity="0.7" />

        {/* Stress line (orange) */}
        <polyline points={stressPoints} fill="none" stroke="#fb923c" strokeWidth="1.5" opacity="0.7" />

        {/* Legend */}
        <rect x={pad.left + 4} y={pad.top + 2} width={8} height={2} fill="#4ade80" />
        <text x={pad.left + 15} y={pad.top + 6} fontSize="7" fill="#4b5563">Integrity</text>
        <rect x={pad.left + 60} y={pad.top + 2} width={8} height={2} fill="#fb923c" />
        <text x={pad.left + 71} y={pad.top + 6} fontSize="7" fill="#4b5563">Stress</text>

        {/* X axis labels */}
        {history
          .filter((_, i) => i % Math.max(1, Math.floor(history.length / 8)) === 0)
          .map(h => (
            <text key={h.turn} x={xScale(h.turn)} y={height - 4}
              textAnchor="middle" fontSize="7" fill="#4b5563">
              T{h.turn}
            </text>
          ))}
      </svg>
    </div>
  );
}

// ── Site grid ─────────────────────────────────────────────────────────────────

function SiteGrid({ nodeStates, spreadHistory }) {
  if (!nodeStates) return <div className="text-xs text-gray-700 italic">No data.</div>;

  return (
    <div className="grid grid-cols-2 gap-1">
      {Object.entries(NODES).map(([nodeId, node]) => {
        const ns = nodeStates[nodeId] ?? {};
        const pathogens = ns.pathogens ?? {};
        const hasPathogen = Object.keys(pathogens).length > 0;
        const inflammation = ns.inflammation ?? 0;
        const integrity = ns.tissueIntegrity ?? 100;
        const wasSpreadTarget = spreadHistory?.some(s => s.to === nodeId);

        return (
          <div key={nodeId} className={`text-xs p-2 border rounded ${
            hasPathogen ? 'border-red-900 bg-red-950' :
            inflammation > 40 ? 'border-orange-900 bg-orange-950' :
            'border-gray-800 bg-gray-900'
          }`}>
            <div className="flex justify-between items-start mb-1">
              <span className={`font-mono ${hasPathogen ? 'text-red-400' : 'text-gray-500'}`}>
                {node.label}
              </span>
              {wasSpreadTarget && <span className="text-yellow-800 text-xs">← spread</span>}
            </div>

            {hasPathogen ? (
              <div className="space-y-0.5">
                {Object.entries(pathogens).map(([type, inst]) => {
                  const load = inst.infectionLoad ?? inst.cellularCompromise ?? inst.parasiticBurden ?? inst.corruptionLevel ?? 0;
                  return (
                    <div key={type} className="text-red-600">
                      {PATHOGEN_DISPLAY_NAMES[type] ?? type}: {Math.round(load)}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-gray-700">Clear</div>
            )}

            {inflammation > 20 && (
              <div className="text-orange-700 mt-0.5">Inflam: {Math.round(inflammation)}</div>
            )}
            {integrity < 90 && (
              <div className={`mt-0.5 ${integrity < 40 ? 'text-red-700' : 'text-gray-600'}`}>
                Integrity: {Math.round(integrity)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Memory bank summary ───────────────────────────────────────────────────────

function MemoryBankSummary({ memoryBank }) {
  const entries = getMemoryBankSummary(memoryBank ?? {});
  if (entries.length === 0) {
    return <div className="text-xs text-gray-700 italic">No encounters recorded.</div>;
  }
  return (
    <div className="space-y-1">
      {entries.map(entry => (
        <div key={entry.type} className="flex items-center gap-3 text-xs">
          <span className="font-mono text-purple-400 w-36 shrink-0">{entry.displayName}</span>
          <span className={`font-mono ${
            entry.strength === 'Strong' ? 'text-green-600' :
            entry.strength === 'Moderate' ? 'text-yellow-600' : 'text-gray-600'
          }`}>{entry.strength}</span>
          <span className="text-gray-700">{entry.encounterCount}× seen</span>
        </div>
      ))}
    </div>
  );
}

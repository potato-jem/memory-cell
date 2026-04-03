// PostMortem — shown on loss/win. Overlays main UI.
// Shows: failure mode, stress/integrity trajectory, site status at end, scars.

import { NODES } from '../data/nodes.js';
import { PATHOGEN_DISPLAY_NAMES, getPrimaryLoad } from '../data/pathogens.js';

const FAILURE_MODE_DESCRIPTIONS = {
  pathogens_cleared: {
    heading: 'Immune Response Complete',
    subtext: 'All pathogens have been cleared. The body is stable.',
    color: 'text-green-400',
    border: 'border-green-900',
    bg: 'bg-green-950',
    accentBg: 'bg-green-900',
  },
  systemic_collapse: {
    heading: 'Systemic Collapse',
    subtext: 'Sustained pressure overwhelmed the body\'s defences. Integrity failed.',
    color: 'text-red-400',
    border: 'border-red-900',
    bg: 'bg-red-950',
    accentBg: 'bg-red-900',
  },
  systemic_overload: {
    heading: 'Systemic Overload',
    subtext: 'Stress spiked to critical levels and could not be brought down in time.',
    color: 'text-orange-400',
    border: 'border-orange-900',
    bg: 'bg-orange-950',
    accentBg: 'bg-orange-900',
  },
  sustained_pressure: {
    heading: 'Sustained Pressure',
    subtext: 'Prolonged infections ground the body down. Integrity eroded over many turns.',
    color: 'text-yellow-400',
    border: 'border-yellow-900',
    bg: 'bg-yellow-950',
    accentBg: 'bg-yellow-900',
  },
  progressive_degradation: {
    heading: 'Progressive Degradation',
    subtext: 'Tissue damage accumulated across multiple sites until recovery was impossible.',
    color: 'text-gray-400',
    border: 'border-gray-700',
    bg: 'bg-gray-900',
    accentBg: 'bg-gray-800',
  },
  unknown: {
    heading: 'Run Complete',
    subtext: 'The situation resolved.',
    color: 'text-gray-400',
    border: 'border-gray-800',
    bg: 'bg-gray-900',
    accentBg: 'bg-gray-800',
  },
};

export default function PostMortem({ postMortem, onRestart }) {
  if (!postMortem) return null;

  const modeKey = postMortem.failureMode ?? 'unknown';
  const modeInfo = FAILURE_MODE_DESCRIPTIONS[modeKey] ?? FAILURE_MODE_DESCRIPTIONS.unknown;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-950 border border-gray-800 max-w-3xl w-full max-h-screen overflow-y-auto rounded-lg shadow-2xl">

        {/* Header */}
        <div className={`p-7 border-b ${modeInfo.border} ${modeInfo.bg}`}>
          <div className="text-xs text-gray-600 uppercase tracking-widest mb-3">
            {postMortem.outcome === 'pathogens_cleared' ? 'Victory' : 'Run Ended'}
            {' — '}
            Turn {postMortem.turnsPlayed}
          </div>
          <h2 className={`text-3xl font-mono font-bold ${modeInfo.color} mb-3 leading-tight`}>
            {modeInfo.heading}
          </h2>
          <p className="text-sm text-gray-400 leading-relaxed">{modeInfo.subtext}</p>
        </div>

        <div className="p-6 space-y-8">

          {/* Stress / integrity trajectory */}
          <section>
            <h3 className="text-xs text-gray-600 uppercase tracking-widest mb-4">
              Stress &amp; Integrity Over Time
            </h3>
            <StressGraph history={postMortem.systemicStressHistory} />
          </section>

          {/* Site status at end */}
          <section>
            <h3 className="text-xs text-gray-600 uppercase tracking-widest mb-4">
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
              <h3 className="text-xs text-gray-600 uppercase tracking-widest mb-4">
                Permanent Damage ({postMortem.scars.length})
              </h3>
              <div className="space-y-2">
                {postMortem.scars.map(scar => (
                  <div
                    key={scar.id}
                    className="text-sm text-red-600 font-mono border border-red-950 px-3 py-2 bg-red-950 bg-opacity-30 rounded"
                  >
                    {scar.description}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Restart */}
        <div className="p-6 border-t border-gray-800 flex justify-center">
          <button
            onClick={onRestart}
            className="px-10 py-2.5 bg-gray-900 hover:bg-gray-800 text-gray-300 text-sm font-mono border border-gray-700 rounded transition-colors"
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

  const width  = 580;
  const height = 120;
  const pad    = { top: 12, right: 16, bottom: 24, left: 36 };
  const plotW  = width - pad.left - pad.right;
  const plotH  = height - pad.top - pad.bottom;

  const maxTurn = history[history.length - 1].turn;
  const xScale  = t => pad.left + (maxTurn > 0 ? (t / maxTurn) * plotW : 0);
  const yScale  = v => pad.top + (1 - v / 100) * plotH;

  const stressPoints    = history.map(h => `${xScale(h.turn)},${yScale(h.stress)}`).join(' ');
  const integrityPoints = history.map(h => `${xScale(h.turn)},${yScale(h.integrity)}`).join(' ');

  // Stress area fill
  const stressArea = [
    `M ${xScale(history[0].turn)} ${yScale(history[0].stress)}`,
    ...history.slice(1).map(h => `L ${xScale(h.turn)} ${yScale(h.stress)}`),
    `L ${xScale(history[history.length - 1].turn)} ${yScale(0)}`,
    `L ${xScale(history[0].turn)} ${yScale(0)}`,
    'Z',
  ].join(' ');

  return (
    <div className="overflow-x-auto rounded bg-gray-900 border border-gray-800 p-2">
      <svg width={width} height={height} className="font-mono">
        {/* Danger zone */}
        <rect
          x={pad.left} y={yScale(100)} width={plotW} height={yScale(80) - yScale(100)}
          fill="#450a0a" opacity="0.3"
        />

        {/* Grid lines */}
        {[0, 25, 50, 80, 100].map(v => (
          <g key={v}>
            <line
              x1={pad.left} y1={yScale(v)} x2={width - pad.right} y2={yScale(v)}
              stroke="#1e293b" strokeWidth="1"
            />
            <text
              x={pad.left - 6} y={yScale(v) + 4}
              textAnchor="end" fontSize="8" fill="#374151"
            >
              {v}
            </text>
          </g>
        ))}

        {/* Stress area fill */}
        <path d={stressArea} fill="#fb923c" opacity="0.07" />

        {/* Integrity line */}
        <polyline
          points={integrityPoints}
          fill="none"
          stroke="#4ade80"
          strokeWidth="2"
          opacity="0.8"
          strokeLinejoin="round"
        />

        {/* Stress line */}
        <polyline
          points={stressPoints}
          fill="none"
          stroke="#fb923c"
          strokeWidth="2"
          opacity="0.8"
          strokeLinejoin="round"
        />

        {/* Legend */}
        <rect x={pad.left + 4} y={pad.top + 3} width={12} height={2.5} fill="#4ade80" rx="1" />
        <text x={pad.left + 20} y={pad.top + 8} fontSize="8" fill="#4b5563">Integrity</text>
        <rect x={pad.left + 72} y={pad.top + 3} width={12} height={2.5} fill="#fb923c" rx="1" />
        <text x={pad.left + 88} y={pad.top + 8} fontSize="8" fill="#4b5563">Stress</text>

        {/* X axis labels */}
        {history
          .filter((_, i) => i % Math.max(1, Math.floor(history.length / 8)) === 0)
          .map(h => (
            <text
              key={h.turn}
              x={xScale(h.turn)} y={height - 6}
              textAnchor="middle" fontSize="8" fill="#374151"
            >
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
    <div className="grid grid-cols-3 gap-2">
      {Object.entries(NODES).map(([nodeId, node]) => {
        const ns = nodeStates[nodeId] ?? {};
        const pathogens = ns.pathogens ?? [];
        const hasPathogen = pathogens.length > 0;
        const inflammation = ns.inflammation ?? 0;
        const integrity = ns.tissueIntegrity ?? 100;
        const wasSpreadTarget = spreadHistory?.some(s => s.to === nodeId);

        const cardBorder = hasPathogen ? 'border-red-900 bg-red-950 bg-opacity-40'
          : inflammation > 40 ? 'border-orange-900 bg-orange-950 bg-opacity-30'
          : 'border-gray-800 bg-gray-900';

        return (
          <div key={nodeId} className={`text-xs p-3 border rounded-lg ${cardBorder}`}>
            <div className="flex justify-between items-start mb-2">
              <span className={`font-mono font-bold text-sm ${hasPathogen ? 'text-red-400' : 'text-gray-400'}`}>
                {node.label}
              </span>
              {wasSpreadTarget && (
                <span className="text-yellow-700 text-xs ml-1 shrink-0">← spread</span>
              )}
            </div>

            {hasPathogen ? (
              <div className="space-y-1">
                {pathogens.map(inst => {
                  const load = getPrimaryLoad(inst);
                  return (
                    <div key={inst.uid ?? inst.type} className="flex justify-between gap-2">
                      <span className="text-red-500 truncate">
                        {PATHOGEN_DISPLAY_NAMES[inst.type] ?? inst.type}
                      </span>
                      <span className="text-red-700 font-mono shrink-0">{Math.round(load)}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-gray-700">Clear</div>
            )}

            {/* Mini bars for inflammation + integrity */}
            <div className="mt-2 space-y-1">
              {inflammation > 10 && (
                <div>
                  <div className="flex justify-between text-gray-700 mb-0.5" style={{ fontSize: '10px' }}>
                    <span>Inflam</span>
                    <span>{Math.round(inflammation)}</span>
                  </div>
                  <div className="h-1 w-full bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${inflammation > 70 ? 'bg-red-600' : inflammation > 40 ? 'bg-orange-500' : 'bg-yellow-600'}`}
                      style={{ width: `${inflammation}%` }}
                    />
                  </div>
                </div>
              )}
              {integrity < 95 && (
                <div>
                  <div className="flex justify-between text-gray-700 mb-0.5" style={{ fontSize: '10px' }}>
                    <span>Integ</span>
                    <span className={integrity < 40 ? 'text-red-700' : ''}>{Math.round(integrity)}</span>
                  </div>
                  <div className="h-1 w-full bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${integrity < 40 ? 'bg-red-600' : integrity < 70 ? 'bg-orange-500' : 'bg-green-600'}`}
                      style={{ width: `${integrity}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// PostMortem — shown on win or loss. Overlays main UI.
// Shows: outcome, coherence graph, ground truth comparison, signal accuracy, key decisions.

import { NODES } from '../data/nodes.js';
import { GAME_PHASES } from '../state/gameState.js';

const FAILURE_MODE_DESCRIPTIONS = {
  win: {
    heading: 'Threat Eliminated',
    subtext: 'The infection was cleared before coherence collapsed. The body holds.',
    color: 'text-green-400',
    border: 'border-green-800',
    bg: 'bg-green-950',
  },
  missed_threat: {
    heading: 'Threat Undetected',
    subtext: 'The infection spread while your signals went unheeded. You didn\'t know it was there — or chose not to act.',
    color: 'text-red-400',
    border: 'border-red-900',
    bg: 'bg-red-950',
  },
  over_response: {
    heading: 'Collateral Collapse',
    subtext: 'Your response caused more damage than the threat. The system turned against itself.',
    color: 'text-orange-400',
    border: 'border-orange-900',
    bg: 'bg-orange-950',
  },
  slow_response: {
    heading: 'Too Slow',
    subtext: 'You knew but couldn\'t act fast enough. Time ran out while the infection expanded.',
    color: 'text-yellow-400',
    border: 'border-yellow-900',
    bg: 'bg-yellow-950',
  },
  routing_overload: {
    heading: 'Signal Overload',
    subtext: 'Excessive routing flooded the spleen. The coordination system collapsed under its own pressure.',
    color: 'text-purple-400',
    border: 'border-purple-900',
    bg: 'bg-purple-950',
  },
  coherence_collapse: {
    heading: 'Coherence Collapse',
    subtext: 'The gap between what was happening and what you believed grew too large to bridge.',
    color: 'text-red-400',
    border: 'border-red-900',
    bg: 'bg-red-950',
  },
  turn_limit: {
    heading: 'Time Expired',
    subtext: 'The infection persisted until the body\'s resources were exhausted.',
    color: 'text-yellow-400',
    border: 'border-yellow-900',
    bg: 'bg-yellow-950',
  },
  unknown: {
    heading: 'Run Complete',
    subtext: 'The situation resolved.',
    color: 'text-gray-400',
    border: 'border-gray-800',
    bg: 'bg-gray-900',
  },
};

export default function PostMortem({ postMortem, phase, onRestart }) {
  const outcome = postMortem.failureMode === 'win' ? 'win' : postMortem.outcome;
  const modeKey = postMortem.failureMode ?? outcome;
  const modeInfo = FAILURE_MODE_DESCRIPTIONS[modeKey] ?? FAILURE_MODE_DESCRIPTIONS.unknown;
  const isWin = phase === GAME_PHASES.WON;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-85 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-950 border border-gray-800 max-w-3xl w-full max-h-screen overflow-y-auto rounded">
        {/* Header */}
        <div className={`p-6 border-b ${modeInfo.border} ${modeInfo.bg}`}>
          <div className="text-xs text-gray-600 uppercase tracking-widest mb-2">
            {isWin ? 'Situation Resolved' : 'Situation Lost'} — Turn {postMortem.turnsPlayed}
          </div>
          <h2 className={`text-2xl font-mono ${modeInfo.color} mb-2`}>
            {modeInfo.heading}
          </h2>
          <p className="text-sm text-gray-400 leading-relaxed">{modeInfo.subtext}</p>
        </div>

        <div className="p-6 space-y-6">
          {/* Coherence trajectory */}
          <section>
            <h3 className="text-xs text-gray-600 uppercase tracking-wider mb-3">
              Coherence Trajectory
            </h3>
            <CoherenceGraph history={postMortem.coherenceHistory} />
          </section>

          {/* Ground truth comparison */}
          <section>
            <h3 className="text-xs text-gray-600 uppercase tracking-wider mb-3">
              What Was Actually Happening
            </h3>
            <GroundTruthGrid
              nodeStates={postMortem.finalGroundTruth.nodeStates}
              pathogenState={postMortem.finalGroundTruth.pathogenState}
              spreadHistory={postMortem.finalGroundTruth.spreadHistory}
            />
          </section>

          {/* Signal accuracy */}
          <section>
            <h3 className="text-xs text-gray-600 uppercase tracking-wider mb-3">
              Signal Accuracy
            </h3>
            <SignalAccuracySummary signals={postMortem.annotatedSignals} />
          </section>

          {/* Key decision points */}
          {postMortem.keyDecisions?.length > 0 && (
            <section>
              <h3 className="text-xs text-gray-600 uppercase tracking-wider mb-3">
                Key Decision Points
              </h3>
              <div className="space-y-3">
                {postMortem.keyDecisions.map((decision, i) => (
                  <DecisionCard key={i} decision={decision} />
                ))}
              </div>
            </section>
          )}

          {/* Final coherence breakdown */}
          {postMortem.finalCoherenceBreakdown?.length > 0 && (
            <section>
              <h3 className="text-xs text-gray-600 uppercase tracking-wider mb-3">
                Final Coherence Breakdown
              </h3>
              <div className="space-y-1">
                {postMortem.finalCoherenceBreakdown.map((item, i) => (
                  <div key={i} className="flex items-center gap-3 text-xs">
                    <span className={`font-mono w-28 shrink-0 ${
                      item.type === 'undetected_threat' ? 'text-red-500' :
                      item.type === 'over_response' ? 'text-orange-500' :
                      item.type === 'collateral_damage' ? 'text-purple-500' :
                      'text-gray-500'
                    }`}>
                      {item.type.replace(/_/g, ' ').toUpperCase()}
                    </span>
                    <span className="text-gray-500">{item.nodeLabel}</span>
                    <span className="text-gray-700 flex-1 truncate">{item.detail}</span>
                    <span className="text-gray-600 shrink-0">-{item.score.toFixed(1)}</span>
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
            className="px-8 py-2 bg-gray-900 hover:bg-gray-800 text-gray-300 text-sm font-mono border border-gray-700 transition-colors"
          >
            New Situation
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

function CoherenceGraph({ history }) {
  if (!history || history.length < 2) return null;

  const width = 500;
  const height = 80;
  const padding = { top: 8, right: 8, bottom: 20, left: 30 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const maxTurn = history[history.length - 1].turn;
  const xScale = (turn) => padding.left + (turn / maxTurn) * plotW;
  const yScale = (score) => padding.top + (1 - score / 100) * plotH;

  const points = history
    .map(h => `${xScale(h.turn)},${yScale(h.score)}`)
    .join(' ');

  // Color zones
  const dangerY = yScale(30);
  const warningY = yScale(60);

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} className="font-mono">
        {/* Background zones */}
        <rect x={padding.left} y={dangerY} width={plotW} height={plotH - (dangerY - padding.top)} fill="#450a0a" opacity="0.3" />
        <rect x={padding.left} y={warningY} width={plotW} height={dangerY - warningY} fill="#422006" opacity="0.3" />
        <rect x={padding.left} y={padding.top} width={plotW} height={warningY - padding.top} fill="#052e16" opacity="0.3" />

        {/* Grid lines */}
        {[0, 30, 60, 100].map(v => (
          <g key={v}>
            <line
              x1={padding.left} y1={yScale(v)}
              x2={width - padding.right} y2={yScale(v)}
              stroke="#1e293b" strokeWidth="1"
            />
            <text x={padding.left - 4} y={yScale(v) + 3} textAnchor="end" fontSize="7" fill="#4b5563">
              {v}
            </text>
          </g>
        ))}

        {/* Line */}
        <polyline
          points={points}
          fill="none"
          stroke="#60a5fa"
          strokeWidth="1.5"
        />

        {/* Points */}
        {history.map((h, i) => (
          <circle
            key={i}
            cx={xScale(h.turn)}
            cy={yScale(h.score)}
            r={2}
            fill={h.score > 60 ? '#4ade80' : h.score > 30 ? '#facc15' : '#f87171'}
          />
        ))}

        {/* X axis labels */}
        {history
          .filter((_, i) => i % Math.max(1, Math.floor(history.length / 8)) === 0)
          .map(h => (
            <text
              key={h.turn}
              x={xScale(h.turn)}
              y={height - 4}
              textAnchor="middle"
              fontSize="7"
              fill="#4b5563"
            >
              T{h.turn}
            </text>
          ))}
      </svg>
    </div>
  );
}

function GroundTruthGrid({ nodeStates, pathogenState, spreadHistory }) {
  const entries = Object.entries(NODES).map(([nodeId, node]) => ({
    node,
    gtState: nodeStates[nodeId] ?? {},
    pathogen: pathogenState[nodeId],
    wasSpreadTarget: spreadHistory?.some(s => s.to === nodeId),
  }));

  return (
    <div className="grid grid-cols-2 gap-1">
      {entries.map(({ node, gtState, pathogen, wasSpreadTarget }) => {
        const hasPathogen = pathogen && pathogen.strength > 0;
        const inflammation = gtState.inflammation ?? 0;

        return (
          <div
            key={node.id}
            className={`text-xs p-2 border rounded ${
              hasPathogen
                ? 'border-red-900 bg-red-950'
                : inflammation > 40
                ? 'border-orange-900 bg-orange-950'
                : 'border-gray-800 bg-gray-900'
            }`}
          >
            <div className="flex justify-between items-start">
              <span className={`font-mono ${hasPathogen ? 'text-red-400' : 'text-gray-500'}`}>
                {node.label}
              </span>
              {node.isHQ && <span className="text-purple-600 text-xs">HQ</span>}
            </div>
            {hasPathogen && (
              <div className="text-red-600 mt-0.5">
                Pathogen: {Math.round(pathogen.strength)} strength
              </div>
            )}
            {!hasPathogen && (
              <div className="text-gray-700 mt-0.5">Clear</div>
            )}
            {inflammation > 20 && (
              <div className="text-orange-700 mt-0.5">
                Inflammation: {Math.round(inflammation)}%
              </div>
            )}
            {wasSpreadTarget && (
              <div className="text-yellow-800 mt-0.5">← Spread here</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SignalAccuracySummary({ signals }) {
  if (!signals || signals.length === 0) {
    return <div className="text-xs text-gray-700 italic">No signals in history.</div>;
  }

  const accurate = signals.filter(s => s.retrospectiveLabel === 'accurate').length;
  const falseAlarms = signals.filter(s => s.retrospectiveLabel === 'false_alarm').length;
  const inaccurate = signals.filter(s => s.retrospectiveLabel === 'inaccurate').length;
  const total = signals.length;

  return (
    <div className="space-y-2">
      {/* Summary bars */}
      <div className="flex gap-4 text-xs">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 bg-green-600 rounded-sm" />
          <span className="text-gray-400">Accurate: {accurate} ({Math.round(accurate/total*100)}%)</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 bg-yellow-600 rounded-sm" />
          <span className="text-gray-400">False alarms: {falseAlarms}</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 bg-red-600 rounded-sm" />
          <span className="text-gray-400">Silent threats: {inaccurate}</span>
        </div>
      </div>

      {/* Recent signals annotated */}
      <div className="space-y-0.5 max-h-32 overflow-y-auto">
        {[...signals].reverse().slice(0, 20).map(signal => (
          <div key={signal.id} className="flex items-center gap-2 text-xs">
            <span className="text-gray-700 font-mono w-8 shrink-0">T{signal.arrivedOnTurn}</span>
            <span className="text-gray-600 w-16 shrink-0 truncate">{signal.nodeId}</span>
            <span className="flex-1 text-gray-700 truncate">{signal.text}</span>
            <span className={`shrink-0 font-mono ${
              signal.retrospectiveLabel === 'accurate' ? 'text-green-700' :
              signal.retrospectiveLabel === 'false_alarm' ? 'text-yellow-700' :
              'text-red-700'
            }`}>
              {signal.retrospectiveLabel === 'accurate' ? '✓' :
               signal.retrospectiveLabel === 'false_alarm' ? '⚠' : '✕'}
            </span>
            {signal.routingDecision && (
              <span className="text-gray-700 shrink-0">→ {signal.routingDecision}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function DecisionCard({ decision }) {
  const deltaColor = decision.coherenceDelta < -10
    ? 'text-red-500'
    : decision.coherenceDelta < 0
    ? 'text-yellow-500'
    : decision.coherenceDelta > 5
    ? 'text-green-500'
    : 'text-gray-500';

  return (
    <div className={`border border-gray-800 p-3 rounded ${decision.wasSignificant ? 'border-gray-700' : ''}`}>
      <div className="flex justify-between items-start mb-1">
        <span className="text-xs font-mono text-gray-400">{decision.label}</span>
        <span className="text-xs text-gray-600">Turns {decision.turns[0]}–{decision.turns[1]}</span>
      </div>
      <p className="text-xs text-gray-500 leading-relaxed">{decision.description}</p>
      {decision.wasSignificant && (
        <div className={`mt-1 text-xs font-mono ${deltaColor}`}>
          Coherence change: {decision.coherenceDelta > 0 ? '+' : ''}{decision.coherenceDelta}%
        </div>
      )}
    </div>
  );
}

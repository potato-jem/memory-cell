// SignalConsole — the primary interaction surface.
// Layer 2: situation tags in concurrent mode, memory bonus indicator.

import { ROUTING_COSTS, ROUTING_DECISIONS } from '../data/signals.js';

const CONFIDENCE_COLORS = {
  low: 'text-gray-500 border-gray-700',
  medium: 'text-yellow-600 border-yellow-900',
  high: 'text-orange-400 border-orange-900',
};

const SIGNAL_TYPE_LABELS = {
  patrol_clear: { label: 'CLEAR', color: 'text-gray-600' },
  anomaly_detected: { label: 'ANOMALY', color: 'text-yellow-500' },
  threat_confirmed: { label: 'THREAT', color: 'text-orange-400' },
  threat_expanding: { label: 'EXPANDING', color: 'text-red-400' },
  collateral_damage: { label: 'COLLATERAL', color: 'text-purple-400' },
  false_alarm: { label: 'FALSE ALARM', color: 'text-green-600' },
  resolution: { label: 'RESOLUTION', color: 'text-green-400' },
};

const SOURCE_LABELS = {
  neutrophil: 'NΦ',
  macrophage: 'MΦ',
  dendritic: 'DC',
};

const ROUTING_BUTTON_STYLES = {
  [ROUTING_DECISIONS.FORWARD]: 'border-blue-800 text-blue-400 hover:bg-blue-900',
  [ROUTING_DECISIONS.AMPLIFY]: 'border-orange-800 text-orange-400 hover:bg-orange-900',
  [ROUTING_DECISIONS.SUPPRESS]: 'border-gray-700 text-gray-500 hover:bg-gray-800',
  [ROUTING_DECISIONS.QUARANTINE]: 'border-yellow-800 text-yellow-600 hover:bg-yellow-900',
};

const DECISION_LABELS = {
  [ROUTING_DECISIONS.FORWARD]: 'FWD',
  [ROUTING_DECISIONS.AMPLIFY]: 'AMP',
  [ROUTING_DECISIONS.SUPPRESS]: 'SUP',
  [ROUTING_DECISIONS.QUARANTINE]: 'QRN',
};

const DECISION_COLORS_HISTORY = {
  [ROUTING_DECISIONS.FORWARD]: 'text-blue-500',
  [ROUTING_DECISIONS.AMPLIFY]: 'text-orange-400',
  [ROUTING_DECISIONS.SUPPRESS]: 'text-gray-600',
  [ROUTING_DECISIONS.QUARANTINE]: 'text-yellow-600',
};

export default function SignalConsole({
  activeSignals,
  signalHistory,
  silenceNotices,
  attentionTokens,
  onRouteSignal,
  onEndTurn,
  isPlaying,
  isConcurrent,
}) {
  const pendingSignals = activeSignals.filter(s => !s.routed);
  const routedThisTurn = activeSignals.filter(s => s.routed);

  return (
    <div className="flex flex-col h-full">
      {/* Console header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 shrink-0">
        <span className="text-xs text-gray-600 uppercase tracking-wider">Signal Console</span>
        <div className="flex items-center gap-3">
          {pendingSignals.length > 0 && (
            <span className="text-xs text-yellow-600">
              {pendingSignals.length} pending
            </span>
          )}
          <span className="text-xs text-gray-700">
            {attentionTokens} tokens remaining
          </span>
        </div>
      </div>

      {/* Active signal queue */}
      <div className="flex-1 overflow-y-auto">
        {/* Pending signals */}
        {pendingSignals.length > 0 && (
          <div className="p-2 space-y-2">
            {pendingSignals.map(signal => (
              <SignalCard
                key={signal.id}
                signal={signal}
                attentionTokens={attentionTokens}
                onRoute={onRouteSignal}
              />
            ))}
          </div>
        )}

        {/* Silence notices */}
        {silenceNotices.length > 0 && (
          <div className="px-4 py-1 space-y-1">
            {silenceNotices.map((notice, i) => (
              <div key={i} className="text-xs text-gray-700 italic border-l-2 border-gray-800 pl-2">
                {notice.message}
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {pendingSignals.length === 0 && (
          <div className="p-4 text-xs text-gray-700 italic">
            No pending signals this turn. End turn to advance.
          </div>
        )}

        {/* Divider */}
        <div className="border-t border-gray-800 mx-4 my-2" />

        {/* Signal history */}
        <div className="px-2 pb-4 space-y-1">
          <div className="px-2 py-1 text-xs text-gray-700 uppercase tracking-wider">History</div>

          {/* Show most recent first */}
          {[...signalHistory].reverse().map(signal => (
            <HistoryEntry key={signal.id} signal={signal} />
          ))}

          {signalHistory.length === 0 && (
            <div className="px-2 text-xs text-gray-800 italic">
              No signals received yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SignalCard({ signal, attentionTokens, onRoute }) {
  const typeInfo = SIGNAL_TYPE_LABELS[signal.type] ?? { label: 'SIGNAL', color: 'text-gray-400' };
  const confStyle = CONFIDENCE_COLORS[signal.confidence] ?? CONFIDENCE_COLORS.low;
  const isAged = signal.delay > 1;
  const isDendriticReturn = signal.isDendriticReturn;

  return (
    <div className={`border rounded p-3 space-y-2 ${
      isDendriticReturn
        ? 'border-purple-800 bg-purple-950'
        : isAged
        ? 'border-gray-800 bg-gray-900 opacity-70'
        : 'border-gray-700 bg-gray-900'
    }`}>
      {/* Signal header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Source badge */}
          <span className={`text-xs font-mono px-1 border rounded ${
            isDendriticReturn ? 'border-purple-700 text-purple-400' : 'border-gray-700 text-gray-500'
          }`}>
            {SOURCE_LABELS[signal.source] ?? signal.source}
          </span>

          {/* Node */}
          <span className="text-xs text-gray-400 font-mono">{signal.nodeId}</span>

          {/* Type */}
          <span className={`text-xs font-mono font-bold ${typeInfo.color}`}>
            {typeInfo.label}
          </span>

          {/* Dendritic return label */}
          {isDendriticReturn && (
            <span className="text-xs text-purple-400 font-mono">[SCOUT RETURN]</span>
          )}

          {/* Situation tag (concurrent mode) */}
          {signal.situationId && signal.situationId !== 'primary' && (
            <span className="text-xs text-yellow-700 font-mono border border-yellow-900 px-0.5">
              {signal.situationId.slice(0, 8)}
            </span>
          )}

          {/* Memory bonus indicator */}
          {signal.hasMemoryBonus && (
            <span className="text-xs text-purple-600 font-mono" title={signal.memoryBonusNote}>
              ✦ mem
            </span>
          )}
        </div>

        {/* Confidence + delay */}
        <div className="flex flex-col items-end shrink-0 gap-0.5">
          <span className={`text-xs font-mono px-1 border rounded ${confStyle}`}>
            {signal.confidence.toUpperCase()}
          </span>
          {isAged && (
            <span className="text-xs text-gray-700">+{signal.delay - 1} turns old</span>
          )}
        </div>
      </div>

      {/* Signal text */}
      <p className="text-xs text-gray-400 leading-relaxed">{signal.text}</p>

      {/* Routing buttons */}
      <div className="flex gap-1.5 flex-wrap">
        {Object.values(ROUTING_DECISIONS).map(decision => {
          const cost = ROUTING_COSTS[decision];
          const canAfford = attentionTokens >= cost;
          return (
            <button
              key={decision}
              onClick={() => onRoute(signal.id, decision)}
              disabled={!canAfford}
              className={`px-2 py-0.5 text-xs font-mono border transition-colors ${
                canAfford
                  ? ROUTING_BUTTON_STYLES[decision]
                  : 'border-gray-800 text-gray-800 cursor-not-allowed'
              }`}
            >
              {DECISION_LABELS[decision]} ({cost}t)
            </button>
          );
        })}
      </div>
    </div>
  );
}

function HistoryEntry({ signal }) {
  const typeInfo = SIGNAL_TYPE_LABELS[signal.type] ?? { label: 'SIGNAL', color: 'text-gray-600' };
  const decisionStyle = signal.routingDecision
    ? DECISION_COLORS_HISTORY[signal.routingDecision] ?? 'text-gray-600'
    : 'text-gray-700';

  return (
    <div className="flex items-baseline gap-2 px-2 py-0.5 hover:bg-gray-900 rounded">
      <span className="text-xs text-gray-800 font-mono shrink-0">
        T{signal.arrivedOnTurn}
      </span>
      <span className="text-xs font-mono shrink-0 text-gray-600">
        {signal.nodeId.slice(0, 6)}
      </span>
      <span className={`text-xs font-mono shrink-0 ${typeInfo.color} opacity-60`}>
        {typeInfo.label}
      </span>
      <span className="text-xs text-gray-600 truncate flex-1">{signal.text}</span>
      {signal.routingDecision ? (
        <span className={`text-xs font-mono shrink-0 ${decisionStyle}`}>
          → {DECISION_LABELS[signal.routingDecision]}
        </span>
      ) : (
        <span className="text-xs text-gray-800 shrink-0">—</span>
      )}
    </div>
  );
}

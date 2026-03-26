// NodeDetail — shown when a node is selected.
// Displays: signals for this node, foreign signatures, friendly cells, deploy actions.

import { NODES } from '../data/nodes.js';
import { NODE_STATUSES, ENTITY_CLASS, entityDisplayLabel } from '../state/perceivedState.js';
import { DEPLOY_COSTS, CELL_TYPES } from '../engine/cells.js';

const SIGNAL_TYPE_CONFIG = {
  patrol_clear:     { label: 'CLEAR',      color: 'text-gray-500', icon: '○' },
  anomaly_detected: { label: 'ANOMALY',    color: 'text-yellow-500', icon: '?' },
  threat_confirmed: { label: 'THREAT',     color: 'text-orange-400', icon: '!' },
  threat_expanding: { label: 'EXPANDING',  color: 'text-red-400', icon: '!!' },
  collateral_damage:{ label: 'COLLATERAL', color: 'text-purple-400', icon: '~' },
  false_alarm:      { label: 'CLEAR',      color: 'text-gray-500', icon: '○' },
  resolution:       { label: 'RESOLVED',   color: 'text-green-500', icon: '✓' },
};

const CONF_COLORS = {
  low:    'text-gray-500',
  medium: 'text-yellow-600',
  high:   'text-orange-400',
};

const ENTITY_STYLES = {
  [ENTITY_CLASS.UNKNOWN]:      { color: 'text-yellow-500', bg: 'bg-yellow-950 border-yellow-900', icon: '?' },
  [ENTITY_CLASS.PATHOGEN]:     { color: 'text-red-400',    bg: 'bg-red-950 border-red-900',       icon: '!' },
  [ENTITY_CLASS.SELF_LIKE]:    { color: 'text-gray-400',   bg: 'bg-gray-900 border-gray-700',     icon: '~' },
  [ENTITY_CLASS.BENIGN]:       { color: 'text-green-600',  bg: 'bg-green-950 border-green-900',   icon: '○' },
  [ENTITY_CLASS.INFLAMMATORY]: { color: 'text-purple-400', bg: 'bg-purple-950 border-purple-900', icon: '~' },
  [ENTITY_CLASS.CLASSIFIED]:   { color: 'text-red-300',    bg: 'bg-red-950 border-red-800',       icon: '✕' },
};

const CELL_CONFIG = {
  dendritic:  { label: 'Scout (DC)',  color: 'text-purple-400', dot: 'bg-purple-600' },
  neutrophil: { label: 'Patrol (NΦ)', color: 'text-blue-400',   dot: 'bg-blue-600'   },
  macrophage: { label: 'Macrophage',  color: 'text-amber-400',  dot: 'bg-amber-600'  },
  responder:  { label: 'Responder',   color: 'text-red-400',    dot: 'bg-red-700'    },
  killer_t:   { label: 'Killer T',    color: 'text-red-300',    dot: 'bg-red-600'    },
  b_cell:     { label: 'B-Cell',      color: 'text-green-400',  dot: 'bg-green-600'  },
  nk_cell:    { label: 'NK Cell',     color: 'text-orange-400', dot: 'bg-orange-600' },
};

const DEPLOY_BUTTONS = [
  { type: CELL_TYPES.DENDRITIC,  label: 'Scout',    sublabel: 'DC',  detail: 'Round trip ~20s · high-confidence intel',  action: 'DEPLOY_DENDRITIC',  color: 'purple' },
  { type: CELL_TYPES.NEUTROPHIL, label: 'Patrol',   sublabel: 'NΦ',  detail: 'Circuits nodes · reveals inflammation',    action: 'DEPLOY_NEUTROPHIL', color: 'blue' },
  { type: CELL_TYPES.MACROPHAGE, label: 'Macrophage',sublabel: 'MΦ', detail: 'Static · sees this + adjacent nodes',      action: 'DEPLOY_MACROPHAGE', color: 'amber' },
  { type: CELL_TYPES.NK_CELL,    label: 'NK Cell',  sublabel: 'NK',  detail: 'No scout needed · calculated risk',        action: 'DEPLOY_NK_CELL',    color: 'orange' },
  { type: CELL_TYPES.B_CELL,     label: 'B-Cell',   sublabel: 'BC',  detail: 'Tags threats · safe · slower clearance',   action: 'DEPLOY_B_CELL',     color: 'green' },
  { type: CELL_TYPES.RESPONDER,  label: 'Responder',sublabel: 'Rsp', detail: 'General attack · risks collateral',        action: 'DEPLOY_RESPONDER',  color: 'red' },
  { type: CELL_TYPES.KILLER_T,   label: 'Killer T', sublabel: 'KT',  detail: 'Requires scout · high clearance',          action: 'DEPLOY_KILLER_T',   color: 'crimson' },
];

const BTN_COLOR = {
  purple:  'border-purple-800 text-purple-400 hover:bg-purple-950',
  blue:    'border-blue-800 text-blue-400 hover:bg-blue-950',
  amber:   'border-amber-800 text-amber-400 hover:bg-amber-950',
  orange:  'border-orange-800 text-orange-400 hover:bg-orange-950',
  green:   'border-green-800 text-green-400 hover:bg-green-950',
  red:     'border-red-800 text-red-400 hover:bg-red-950',
  crimson: 'border-red-700 text-red-300 hover:bg-red-950',
};

function timeAgo(tick, currentTick) {
  if (tick == null || currentTick == null) return '';
  const s = currentTick - tick;
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ${s % 60}s ago`;
}

export default function NodeDetail({
  nodeId,
  perceivedState,
  deployedCells,
  activeSignals,
  attentionTokens,
  currentTick,
  onDismissSignal,
  onHoldSignal,
  onDeploy,
  onRecall,
  onDismissEntity,
  onClose,
}) {
  const node = NODES[nodeId];
  if (!node) return null;

  const psNode = perceivedState.nodes[nodeId] ?? {};
  const entities = (perceivedState.foreignEntitiesByNode?.[nodeId] ?? []).filter(e => !e.isDismissed);

  // Signals for this node — split by category
  const nodeSignals = (activeSignals ?? []).filter(s => s.nodeId === nodeId && !s.routed);
  const alertSignals  = nodeSignals.filter(s => s.type === 'threat_confirmed' || s.type === 'threat_expanding');
  const warnSignals   = nodeSignals.filter(s => s.type === 'anomaly_detected' || s.type === 'collateral_damage');
  const latestClear   = nodeSignals
    .filter(s => s.type === 'patrol_clear' || s.type === 'false_alarm')
    .sort((a, b) => (b.arrivedAtTick ?? 0) - (a.arrivedAtTick ?? 0))[0] ?? null;

  const recentHistory = [...(activeSignals ?? [])]
    .filter(s => s.nodeId === nodeId && s.routed)
    .slice(-5)
    .reverse();

  // Cells at this node by phase
  const cellsHere    = Object.values(deployedCells).filter(c => c.nodeId === nodeId && c.phase === 'arrived');
  const cellsEnRoute = Object.values(deployedCells).filter(c => c.nodeId === nodeId && c.phase === 'outbound');

  const status = psNode.status ?? NODE_STATUSES.CLEAN;

  return (
    <div className="flex flex-col h-full bg-gray-950 border-l border-gray-800">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-mono text-gray-200">{node.label}</span>
            {node.isHQ && <span className="text-xs text-purple-400 border border-purple-800 px-1">HQ</span>}
            {node.isBottleneck && <span className="text-xs text-yellow-700 border border-yellow-900 px-1">KEY</span>}
            {node.isSystemic && <span className="text-xs text-blue-700 border border-blue-900 px-1">SYSTEMIC</span>}
          </div>
          <div className="text-xs text-gray-600 mt-0.5 capitalize">{status.replace('_', ' ')}</div>
        </div>
        <button onClick={onClose} className="text-gray-700 hover:text-gray-400 text-lg leading-none">×</button>
      </div>

      <div className="flex-1 overflow-y-auto">

        {/* ── Latest clear (info — no badge, shows time-ago) ── */}
        {latestClear && (
          <div className="px-4 py-2 border-b border-gray-800 flex items-center gap-2">
            <span className="text-gray-700 font-mono text-xs">○</span>
            <span className="text-xs text-gray-700">Last clear:</span>
            <span className="text-xs text-gray-600 font-mono">{timeAgo(latestClear.arrivedAtTick, currentTick)}</span>
          </div>
        )}

        {/* ── Alert signals (threat_confirmed / threat_expanding) ── */}
        {alertSignals.length > 0 && (
          <section className="border-b border-gray-800">
            <div className="px-4 py-2 text-xs text-red-700 uppercase tracking-wider">
              Known Problems ({alertSignals.length})
            </div>
            <div className="space-y-1 px-3 pb-3">
              {alertSignals.map(sig => {
                const tc = SIGNAL_TYPE_CONFIG[sig.type] ?? { label: sig.type, color: 'text-red-400', icon: '!' };
                return (
                  <div key={sig.id} className="border border-red-900 bg-red-950 p-2 rounded">
                    <div className="flex items-start gap-2 mb-1">
                      <span className={`font-mono text-sm ${tc.color} shrink-0`}>{tc.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-xs font-mono font-bold ${tc.color}`}>{tc.label}</span>
                          <span className={`text-xs font-mono ${CONF_COLORS[sig.confidence]}`}>{sig.confidence.toUpperCase()}</span>
                          {sig.isDendriticReturn && <span className="text-xs text-purple-400 font-mono">SCOUT</span>}
                          {sig.hasMemoryBonus && <span className="text-xs text-purple-600">✦</span>}
                          <span className="text-xs text-gray-700 ml-auto">{timeAgo(sig.arrivedAtTick, currentTick)}</span>
                        </div>
                        <p className="text-xs text-red-300 mt-0.5 leading-relaxed">{sig.text}</p>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-1">
                      <button onClick={() => onHoldSignal(sig.id)}
                        className="text-xs font-mono px-2 py-0.5 border border-yellow-900 text-yellow-700 hover:bg-yellow-950 transition-colors">
                        Hold
                      </button>
                      <button onClick={() => onDismissSignal(sig.id)}
                        className="text-xs font-mono px-2 py-0.5 border border-gray-700 text-gray-600 hover:bg-gray-900 transition-colors">
                        Dismiss
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Warning signals (anomaly / collateral) — with expiry indicator ── */}
        {warnSignals.length > 0 && (
          <section className="border-b border-gray-800">
            <div className="px-4 py-2 text-xs text-yellow-800 uppercase tracking-wider">
              Unknowns ({warnSignals.length})
            </div>
            <div className="space-y-1 px-3 pb-3">
              {warnSignals.map(sig => {
                const tc = SIGNAL_TYPE_CONFIG[sig.type] ?? { label: sig.type, color: 'text-yellow-500', icon: '?' };
                const expiresIn = sig.expiresAtTick != null ? Math.max(0, sig.expiresAtTick - (currentTick ?? 0)) : null;
                return (
                  <div key={sig.id} className="border border-yellow-900 bg-gray-900 p-2 rounded">
                    <div className="flex items-start gap-2 mb-1">
                      <span className={`font-mono text-sm ${tc.color} shrink-0`}>{tc.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-xs font-mono font-bold ${tc.color}`}>{tc.label}</span>
                          <span className={`text-xs font-mono ${CONF_COLORS[sig.confidence]}`}>{sig.confidence.toUpperCase()}</span>
                          {sig.hasMemoryBonus && <span className="text-xs text-purple-600">✦</span>}
                          <span className="text-xs text-gray-700 ml-auto">{timeAgo(sig.arrivedAtTick, currentTick)}</span>
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{sig.text}</p>
                        {expiresIn != null && expiresIn < 20 && (
                          <p className="text-xs text-gray-700 mt-0.5">Clears in {expiresIn}s</p>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 mt-1">
                      <button onClick={() => onHoldSignal(sig.id)}
                        className="text-xs font-mono px-2 py-0.5 border border-yellow-900 text-yellow-700 hover:bg-yellow-950 transition-colors">
                        Hold
                      </button>
                      <button onClick={() => onDismissSignal(sig.id)}
                        className="text-xs font-mono px-2 py-0.5 border border-gray-700 text-gray-600 hover:bg-gray-900 transition-colors">
                        Dismiss
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Foreign signatures ── */}
        <section className="border-b border-gray-800">
          <div className="px-4 py-2 text-xs text-gray-600 uppercase tracking-wider">
            Detected Signatures
          </div>
          {entities.length === 0 && (
            <div className="px-4 pb-3 text-xs text-gray-800 italic">Nothing detected.</div>
          )}
          <div className="space-y-1 px-3 pb-3">
            {entities.map(entity => {
              const es = ENTITY_STYLES[entity.perceivedClass] ?? ENTITY_STYLES[ENTITY_CLASS.UNKNOWN];
              const label = entity.displayLabel ?? entityDisplayLabel(entity.perceivedClass, entity.classifiedType, entity.confidence);
              const isSelfLike = entity.perceivedClass === ENTITY_CLASS.SELF_LIKE;

              return (
                <div key={entity.id} className={`flex items-start gap-2 p-2 border rounded text-xs ${es.bg}`}>
                  <span className={`font-mono font-bold ${es.color} shrink-0 mt-0.5`}>{es.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`font-mono ${es.color}`}>{label}</span>
                      <span className={`font-mono ${CONF_COLORS[entity.confidence]}`}>
                        {entity.confidence.toUpperCase()}
                      </span>
                      {entity.classifiedType && (
                        <span className="text-xs text-red-600 font-mono border border-red-900 px-0.5">
                          CLASSIFIED
                        </span>
                      )}
                      {/* Mimic warning: lots of self_like entities is suspicious */}
                      {isSelfLike && (
                        <span className="text-gray-700 italic">
                          {entity.confidence === 'high' ? 'confirmed clear' : 'appears normal'}
                        </span>
                      )}
                    </div>
                    <div className="text-gray-700 mt-0.5">
                      First seen T{entity.firstSeenTurn}
                      {entity.lastUpdatedTurn !== entity.firstSeenTurn && ` · updated T${entity.lastUpdatedTurn}`}
                    </div>
                  </div>
                  {!entity.isResolved && (
                    <button
                      onClick={() => onDismissEntity(nodeId, entity.id)}
                      className="text-gray-800 hover:text-gray-500 shrink-0"
                      title="Dismiss"
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Cells at this node ── */}
        <section className="border-b border-gray-800">
          <div className="px-4 py-2 text-xs text-gray-600 uppercase tracking-wider">
            Your Cells Here
          </div>
          {cellsHere.length === 0 && cellsEnRoute.length === 0 && (
            <div className="px-4 pb-3 text-xs text-gray-800 italic">No cells deployed.</div>
          )}

          {cellsHere.length > 0 && (
            <div className="space-y-px pb-1">
              {cellsHere.map(cell => {
                const cc = CELL_CONFIG[cell.type] ?? { label: cell.type, color: 'text-gray-500', dot: 'bg-gray-700' };
                return (
                  <div key={cell.id} className="flex items-center gap-2 px-4 py-1 hover:bg-gray-900">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${cc.dot}`} />
                    <span className={`text-xs font-mono ${cc.color} flex-1`}>{cc.label}</span>
                    {cell.type === 'responder' && !cell.hasDendriticBacking && (
                      <span className="text-xs text-yellow-800" title="No scout backing — reduced effectiveness + higher collateral risk">⚠ unconfirmed</span>
                    )}
                    <button
                      onClick={() => onRecall(cell.id)}
                      className="text-xs text-gray-800 hover:text-red-700 font-mono transition-colors"
                      title="Recall"
                    >
                      recall
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {cellsEnRoute.length > 0 && (
            <div className="space-y-px pb-2">
              <div className="px-4 pt-1 text-xs text-gray-700">En route:</div>
              {cellsEnRoute.map(cell => {
                const cc = CELL_CONFIG[cell.type] ?? { label: cell.type, color: 'text-gray-600', dot: 'bg-gray-700' };
                const arrivesIn = cell.arrivalTick != null && currentTick != null
                  ? Math.max(0, cell.arrivalTick - currentTick)
                  : null;
                return (
                  <div key={cell.id} className="flex items-center gap-2 px-4 py-1 opacity-60">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${cc.dot} opacity-50`} style={{ border: '1px dashed' }} />
                    <span className={`text-xs font-mono ${cc.color} flex-1`}>{cc.label}</span>
                    {arrivesIn != null && <span className="text-xs text-blue-900 font-mono">{arrivesIn}s</span>}
                    <button
                      onClick={() => onRecall(cell.id)}
                      className="text-xs text-gray-800 hover:text-red-700 font-mono transition-colors"
                    >
                      recall
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Deploy section ── */}
        <section className="pb-4">
          <div className="px-4 py-2 text-xs text-gray-600 uppercase tracking-wider">
            Deploy to {node.label}
          </div>
          <div className="px-3 space-y-1">
            {DEPLOY_BUTTONS.map(btn => {
              const cost = DEPLOY_COSTS[btn.type] ?? 1;
              const canAfford = attentionTokens >= cost;
              const btnStyle = BTN_COLOR[btn.color] ?? BTN_COLOR.red;

              return (
                <button
                  key={btn.type}
                  onClick={() => onDeploy(btn.action, nodeId)}
                  disabled={!canAfford}
                  className={`w-full text-left px-3 py-1.5 text-xs font-mono border transition-colors ${
                    canAfford ? btnStyle : 'border-gray-800 text-gray-700 cursor-not-allowed'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span>
                      {btn.label}
                      <span className="text-gray-600 ml-1">{btn.sublabel}</span>
                    </span>
                    <span className={canAfford ? '' : 'text-gray-800'}>{cost}t</span>
                  </div>
                  <div className={`text-xs mt-0.5 ${canAfford ? 'text-gray-600' : 'text-gray-800'}`}>
                    {btn.detail}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Recent signal history for this node */}
        {recentHistory.length > 0 && (
          <section className="border-t border-gray-800 pb-4">
            <div className="px-4 py-2 text-xs text-gray-700 uppercase tracking-wider">Recent History</div>
            <div className="space-y-px px-4">
              {recentHistory.map(sig => {
                const tc = SIGNAL_TYPE_CONFIG[sig.type] ?? { icon: '·', color: 'text-gray-700' };
                return (
                  <div key={sig.id} className="flex items-baseline gap-2 text-xs py-0.5">
                    <span className="text-gray-800 font-mono w-7 shrink-0">T{sig.arrivedOnTurn}</span>
                    <span className={`font-mono ${tc.color} opacity-50`}>{tc.icon}</span>
                    <span className="text-gray-700 truncate flex-1">{sig.text}</span>
                    <span className="text-gray-800 shrink-0">{sig.routingDecision ?? '—'}</span>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

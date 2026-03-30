// NodeDetail — shown when a node is selected.
// Displays: ground truth site status, perceived threat state, friendly cells, deploy hint.

import { NODES } from '../data/nodes.js';
import { computePathCost } from '../data/nodes.js';
import { ENTITY_CLASS } from '../state/perceivedState.js';
import { PATHOGEN_DISPLAY_NAMES, PATHOGEN_SIGNAL_TYPE, getPrimaryLoad } from '../data/pathogens.js';

// ── Sub-components ────────────────────────────────────────────────────────────

function BarFill({ value, max = 100, color, bg = 'bg-gray-800' }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={`h-1.5 w-full rounded ${bg} overflow-hidden`}>
      <div className={`h-full rounded transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function SiteStatusPanel({ gt, liveIntegrity = null, isStale = false }) {
  // Show if we have fog-aware site data OR at least live tissue integrity
  if (!gt && liveIntegrity == null) return null;

  const inflammation = gt?.inflammation ?? 0;
  const integrity    = liveIntegrity ?? gt?.tissueIntegrity ?? 100;
  const ceiling      = gt?.tissueIntegrityCeiling ?? 100;
  const walled       = gt?.isWalledOff ?? false;
  const suppressed   = gt?.immuneSuppressed ?? false;
  const transitPen   = gt?.transitPenalty ?? 0;
  const inflColor    = inflammation > 70 ? 'bg-red-500' : inflammation > 40 ? 'bg-orange-500' : 'bg-yellow-600';
  const intgColor    = integrity < 30 ? 'bg-red-600' : integrity < 60 ? 'bg-orange-500' : 'bg-green-600';

  return (
    <section className="border-b border-gray-800 px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-600 uppercase tracking-wider">Site Status</div>
        {isStale && <span className="text-xs text-gray-700 italic">last known</span>}
      </div>

      {gt && (
        <div>
          <div className="flex justify-between text-xs mb-0.5">
            <span className="text-gray-500">Inflammation</span>
            <span className={inflammation > 40 ? 'text-orange-500' : 'text-gray-600'}>{Math.round(inflammation)}</span>
          </div>
          <BarFill value={inflammation} color={inflColor} />
        </div>
      )}

      <div>
        <div className="flex justify-between text-xs mb-0.5">
          <span className="text-gray-500">Tissue Integrity</span>
          <span className={integrity < 40 ? 'text-red-400' : 'text-gray-400'}>
            {Math.round(integrity)}
            {gt && ceiling < 100 && <span className="text-gray-700"> / {Math.round(ceiling)} max</span>}
          </span>
        </div>
        <div className="relative h-1.5 w-full rounded bg-gray-800 overflow-hidden">
          {gt && ceiling < 100 && (
            <div className="absolute inset-y-0 bg-gray-700 opacity-40"
              style={{ left: `${ceiling}%`, right: 0 }} />
          )}
          <div className={`h-full rounded transition-all ${intgColor}`}
            style={{ width: `${Math.min(ceiling, integrity)}%` }} />
        </div>
      </div>

      {gt && (walled || suppressed || transitPen > 0) && (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {walled     && <span className="text-xs font-mono px-1 py-0.5 bg-amber-950 border border-amber-800 text-amber-400">WALLED OFF</span>}
          {suppressed && <span className="text-xs font-mono px-1 py-0.5 bg-purple-950 border border-purple-800 text-purple-400">SUPPRESSED</span>}
          {transitPen > 0 && <span className="text-xs font-mono px-1 py-0.5 bg-gray-900 border border-gray-700 text-gray-500">TRANSIT –{transitPen}</span>}
        </div>
      )}
    </section>
  );
}

// ── Perceived threat section ──────────────────────────────────────────────────

const CLASSIFIED_TYPE_NAMES = {
  bacterial: 'Bacterial pathogen',
  viral:     'Viral infection',
  fungal:    'Fungal infection',
  parasitic: 'Parasitic infection',
  toxin:     'Toxin producer',
  prion:     'Prion',
  cancer:    'Malignant growth',
  benign:    'Benign variation',
};

function PathogenPanel({ nodeId, perceivedState, groundTruthNodeState, currentTurn }) {
  const entities = (perceivedState.foreignEntitiesByNode?.[nodeId] ?? [])
    .filter(e => !e.isDismissed
      && !e.isResolved
      && e.perceivedClass !== ENTITY_CLASS.SELF_LIKE
      && e.perceivedClass !== ENTITY_CLASS.BENIGN);

  return (
    <section className="border-b border-gray-800 px-4 py-3 space-y-2">
      <div className="text-xs text-gray-600 uppercase tracking-wider">Threats</div>

      {entities.map(entity => {
        const cls = entity.perceivedClass;
        const isClassified = cls === ENTITY_CLASS.CLASSIFIED;

        // Determine display properties
        let label, barColor, labelColor, isGhost;

        if (cls === ENTITY_CLASS.UNKNOWN) {
          label      = 'Possible threat';
          barColor   = 'bg-yellow-600';
          labelColor = 'text-yellow-600';
          isGhost    = true;
        } else if (cls === ENTITY_CLASS.PATHOGEN) {
          label      = 'Confirmed threat';
          barColor   = 'bg-orange-600';
          labelColor = 'text-orange-500';
          isGhost    = true;
        } else {
          // CLASSIFIED — show actual type and load
          const signalType = entity.classifiedType;
          if (signalType === 'benign') {
            label      = 'Benign variation';
            barColor   = 'bg-gray-500';
            labelColor = 'text-gray-500';
          } else {
            label      = CLASSIFIED_TYPE_NAMES[signalType] ?? signalType ?? 'Unknown type';
            barColor   = 'bg-red-600';
            labelColor = 'text-red-400';
          }
          isGhost = false;
        }

        // For classified: look up real GT load
        let gtLoad = 0;
        if (isClassified) {
          const gtPathogens = groundTruthNodeState?.pathogens ?? {};
          for (const [pt, inst] of Object.entries(gtPathogens)) {
            if (PATHOGEN_SIGNAL_TYPE[pt] === entity.classifiedType) {
              gtLoad = Math.max(gtLoad, getPrimaryLoad(inst));
            }
          }
        }

        // Turns at current visibility level
        const levelSince = entity.levelSince ?? entity.firstSeenTurn ?? 0;
        const turnsAtLevel = Math.max(0, currentTurn - levelSince);

        return (
          <div key={entity.id}>
            <div className="flex justify-between text-xs mb-0.5">
              <span className={labelColor}>{label}</span>
              {isGhost ? (
                <span className="text-gray-600">{turnsAtLevel}T</span>
              ) : (
                <span className="text-gray-400">{Math.round(gtLoad)}</span>
              )}
            </div>
            {isGhost ? (
              <div className="h-1.5 w-full rounded bg-gray-800 overflow-hidden">
                <div className={`h-full w-full rounded ${barColor} opacity-20`} />
              </div>
            ) : (
              <BarFill value={gtLoad} color={barColor} />
            )}
          </div>
        );
      })}
    </section>
  );
}

// ── Cell config ───────────────────────────────────────────────────────────────

const CELL_CONFIG = {
  dendritic:  { label: 'Scout',      color: 'text-purple-400', dot: 'bg-purple-600' },
  neutrophil: { label: 'Patrol',     color: 'text-blue-400',   dot: 'bg-blue-600'   },
  macrophage: { label: 'Macrophage', color: 'text-amber-400',  dot: 'bg-amber-600'  },
  responder:  { label: 'Responder',  color: 'text-red-400',    dot: 'bg-red-700'    },
  killer_t:   { label: 'Killer T',   color: 'text-red-300',    dot: 'bg-red-600'    },
  b_cell:     { label: 'B-Cell',     color: 'text-green-400',  dot: 'bg-green-600'  },
  nk_cell:    { label: 'NK Cell',    color: 'text-orange-400', dot: 'bg-orange-600' },
};

// ── Main component ────────────────────────────────────────────────────────────

export default function NodeDetail({
  nodeId,
  perceivedState,
  groundTruthNodeState,
  deployedCells,
  currentTurn,
  onRecall,
  onClose,
  visibleNodes,
  lastKnownNodeStates,
}) {
  const node = NODES[nodeId];
  if (!node) return null;

  const isVisible  = visibleNodes?.has(nodeId) ?? false;
  const lastKnown  = lastKnownNodeStates?.[nodeId] ?? null;
  const siteGt     = isVisible ? groundTruthNodeState : lastKnown;

  const cellsHere      = Object.values(deployedCells).filter(c => c.nodeId === nodeId && c.phase === 'arrived');
  const cellsTransit   = Object.values(deployedCells).filter(c =>
    c.nodeId === nodeId && (c.phase === 'outbound' || c.phase === 'returning'));

  return (
    <div className="flex flex-col h-full bg-gray-950 border-l border-gray-800">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-mono text-gray-200">{node.label}</span>
            {node.isHQ && <span className="text-xs text-purple-400 border border-purple-800 px-1">HQ</span>}
            {node.isBottleneck && <span className="text-xs text-yellow-700 border border-yellow-900 px-1">KEY</span>}
            {node.isSystemic && <span className="text-xs text-blue-700 border border-blue-900 px-1">SYS</span>}
          </div>
        </div>
        <button onClick={onClose} className="text-gray-700 hover:text-gray-400 text-lg leading-none">×</button>
      </div>

      <div className="flex-1 overflow-y-auto">

        {/* Site status — fog-aware: real-time when visible, last-known when not */}
        <SiteStatusPanel
          gt={siteGt}
          liveIntegrity={groundTruthNodeState?.tissueIntegrity ?? null}
          isStale={!isVisible && !!lastKnown}
        />

        {/* Perceived threat state */}
        <PathogenPanel nodeId={nodeId} perceivedState={perceivedState} groundTruthNodeState={groundTruthNodeState} currentTurn={currentTurn} />

        {/* Friendly cells */}
        <section className="border-b border-gray-800">
          <div className="px-4 py-2 text-xs text-gray-600 uppercase tracking-wider">Your Cells Here</div>

          {cellsHere.length === 0 && cellsTransit.length === 0 &&
          (
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
                      <span className="text-xs text-yellow-800" title="No scout backing">⚠</span>
                    )}
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

          {cellsTransit.length > 0 && (
            <div className="space-y-px pb-2">
              <div className="px-4 pt-1 text-xs text-gray-700">Passing through:</div>
              {cellsTransit.map(cell => {
                const cc = CELL_CONFIG[cell.type] ?? { label: cell.type, color: 'text-gray-600', dot: 'bg-gray-700' };
                const isOutbound = cell.phase === 'outbound';
                const destLabel = isOutbound
                  ? (NODES[cell.destNodeId]?.label ?? cell.destNodeId ?? '?')
                  : 'HQ';
                const eta = (cell.path && cell.pathIndex != null)
                  ? computePathCost(cell.path, cell.pathIndex)
                  : null;
                return (
                  <div key={cell.id} className="flex items-center gap-2 px-4 py-1 opacity-60">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${cc.dot} opacity-50`} />
                    <span className={`text-xs font-mono ${cc.color} flex-1`}>{cc.label}</span>
                    <span className="text-xs text-gray-700">
                      {isOutbound ? '→' : '↩'} {destLabel}{eta != null ? ` ${eta}T` : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Deploy hint */}
        <section className="px-4 py-3">
          <div className="text-xs text-gray-700 italic">
            Select a unit from the roster, then right-click this node to deploy.
          </div>
        </section>

      </div>
    </div>
  );
}

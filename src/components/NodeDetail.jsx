// NodeDetail — shown when a node is selected.
// Displays: ground truth site status, perceived threat state, friendly cells, deploy hint.

import { NODES } from '../data/nodes.js';
import { computePathCost } from '../data/nodes.js';
import { PATHOGEN_DISPLAY_NAMES, getPrimaryLoad } from '../data/pathogens.js';
import { CELL_CONFIG as CELL_TYPE_CONFIG } from '../data/cellConfig.js';

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

// ── Pathogen threat section ───────────────────────────────────────────────────

function PathogenPanel({ groundTruthNodeState }) {
  const pathogens = (groundTruthNodeState?.pathogens ?? [])
    .filter(inst => inst.detected_level !== 'none');

  return (
    <section className="border-b border-gray-800 px-4 py-3 space-y-2">
      <div className="text-xs text-gray-600 uppercase tracking-wider">Threats</div>

      {pathogens.length === 0 && (
        <div className="text-xs text-gray-800 italic">No surveillance data.</div>
      )}

      {pathogens.map(inst => {
        const level = inst.detected_level;
        const isKnown = level === 'classified' || level === 'misclassified';

        let label, barColor, labelColor;

        if (level === 'unknown') {
          label      = 'Unknown anomaly';
          barColor   = 'bg-gray-600';
          labelColor = 'text-gray-500';
        } else if (level === 'threat') {
          label      = 'Unclassified threat';
          barColor   = 'bg-orange-600';
          labelColor = 'text-orange-500';
        } else {
          // classified or misclassified — show perceived_type (may be wrong if misclassified)
          const displayType = inst.perceived_type ?? inst.type;
          label      = PATHOGEN_DISPLAY_NAMES[displayType] ?? displayType;
          barColor   = displayType === 'benign' ? 'bg-gray-500' : 'bg-red-600';
          labelColor = displayType === 'benign' ? 'text-gray-500' : 'text-red-400';
        }

        const load = isKnown ? getPrimaryLoad(inst) : 0;

        return (
          <div key={inst.uid ?? inst.type}>
            <div className="flex justify-between text-xs mb-0.5">
              <span className={labelColor}>{label}</span>
              {isKnown
                ? <span className="text-gray-400">{Math.round(load)}</span>
                : null}
            </div>
            {isKnown ? (
              <BarFill value={load} color={barColor} />
            ) : (
              <div className="h-1.5 w-full rounded bg-gray-800 overflow-hidden">
                <div className={`h-full w-full rounded ${barColor} opacity-20`} />
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}


// ── Main component ────────────────────────────────────────────────────────────

export default function NodeDetail({
  nodeId,
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

        {/* Pathogen threat state */}
        <PathogenPanel groundTruthNodeState={groundTruthNodeState} />

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
                const cc = CELL_TYPE_CONFIG[cell.type] ?? { displayName: cell.type, textClass: 'text-gray-500', dotClass: 'bg-gray-700' };
                return (
                  <div key={cell.id} className="flex items-center gap-2 px-4 py-1 hover:bg-gray-900">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${cc.dotClass}`} />
                    <span className={`text-xs font-mono ${cc.textClass} flex-1`}>{cc.displayName}</span>
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
                const cc = CELL_TYPE_CONFIG[cell.type] ?? { displayName: cell.type, textClass: 'text-gray-600', dotClass: 'bg-gray-700' };
                const isOutbound = cell.phase === 'outbound';
                const destLabel = isOutbound
                  ? (NODES[cell.destNodeId]?.label ?? cell.destNodeId ?? '?')
                  : 'HQ';
                const eta = (cell.path && cell.pathIndex != null)
                  ? computePathCost(cell.path, cell.pathIndex)
                  : null;
                return (
                  <div key={cell.id} className="flex items-center gap-2 px-4 py-1 opacity-60">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${cc.dotClass} opacity-50`} />
                    <span className={`text-xs font-mono ${cc.textClass} flex-1`}>{cc.displayName}</span>
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

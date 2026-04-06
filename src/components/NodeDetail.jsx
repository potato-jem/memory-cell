// NodeDetail — shown when a node is selected.
// Displays: ground truth site status, perceived threat state, friendly cells, deploy hint.

import { NODES } from '../data/nodes.js';
import { computePathCost } from '../data/nodes.js';
import { PATHOGEN_DISPLAY_NAMES, getPrimaryLoad, PATHOGEN_REGISTRY } from '../data/pathogens.js';
import { CELL_CONFIG as CELL_TYPE_CONFIG } from '../data/cellConfig.js';
import CellIcon from './CellIcon.jsx';

// ── Sub-components ────────────────────────────────────────────────────────────

function BarFill({ value, max = 100, color, bg = 'bg-gray-800', ceiling = null }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={`relative h-2 w-full rounded-full ${bg} overflow-hidden`}>
      {ceiling != null && ceiling < 100 && (
        <div
          className="absolute inset-y-0 bg-gray-700 opacity-30"
          style={{ left: `${ceiling}%`, right: 0 }}
        />
      )}
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function SiteStatusPanel({ gt, liveIntegrity = null, isStale = false, turnsSinceLastVisible = 0 }) {
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
    <section className="border-b border-gray-800 px-4 py-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-500 uppercase tracking-widest">Site Status</div>
        {isStale && (
          <span className="text-xs text-gray-700 italic">last known ({turnsSinceLastVisible}T ago)</span>
        )}
      </div>

      {gt && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-gray-500">Inflammation</span>
            <span className={`font-mono font-bold ${inflammation > 40 ? 'text-orange-400' : 'text-gray-500'}`}>
              {Math.round(inflammation)}
            </span>
          </div>
          <BarFill value={inflammation} color={inflColor} />
        </div>
      )}

      <div className="space-y-1.5">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-gray-500">Tissue Integrity</span>
          <span className={`font-mono font-bold ${integrity < 40 ? 'text-red-400' : 'text-gray-400'}`}>
            {Math.round(integrity)}
            {gt && ceiling < 100 && (
              <span className="text-gray-700 font-normal"> / {Math.round(ceiling)}</span>
            )}
          </span>
        </div>
        <BarFill
          value={Math.min(ceiling, integrity)}
          max={100}
          color={intgColor}
          ceiling={ceiling < 100 ? ceiling : null}
        />
      </div>

      {gt && (walled || suppressed || transitPen > 0) && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {walled && (
            <span className="text-xs font-mono px-1.5 py-0.5 bg-amber-950 border border-amber-800 text-amber-400 rounded">
              WALLED OFF
            </span>
          )}
          {suppressed && (
            <span className="text-xs font-mono px-1.5 py-0.5 bg-purple-950 border border-purple-800 text-purple-400 rounded">
              SUPPRESSED
            </span>
          )}
          {transitPen > 0 && (
            <span className="text-xs font-mono px-1.5 py-0.5 bg-gray-900 border border-gray-700 text-gray-500 rounded">
              TRANSIT –{transitPen}
            </span>
          )}
        </div>
      )}
    </section>
  );
}

// ── Pathogen threat section ───────────────────────────────────────────────────

function PathogenPanel({ groundTruthNodeState, isVisible }) {
  const pathogens = (groundTruthNodeState?.pathogens ?? [])
    .filter(inst => inst.detected_level !== 'none');

  return (
    <section className="border-b border-gray-800 px-4 py-4 space-y-3">
      <div className="text-xs text-gray-500 uppercase tracking-widest">Threats</div>

      {pathogens.length === 0 && (
        <div className="text-xs text-gray-700 italic">No surveillance data.</div>
      )}

      {pathogens.map(inst => {
        const level = inst.detected_level;
        const isKnown = level === 'classified' || level === 'misclassified';

        let label, barColor, labelColor, ringColor;

        if (level === 'unknown') {
          label      = 'Unknown anomaly';
          barColor   = 'bg-gray-600';
          labelColor = 'text-gray-500';
          ringColor  = '#6b7280';
        } else if (level === 'threat') {
          label      = 'Unclassified threat';
          barColor   = 'bg-orange-600';
          labelColor = 'text-orange-400';
          ringColor  = '#f97316';
        } else {
          const displayType = inst.perceived_type ?? inst.type;
          label      = PATHOGEN_DISPLAY_NAMES[displayType] ?? displayType;
          barColor   = displayType === 'benign' ? 'bg-gray-500' : 'bg-red-600';
          labelColor = displayType === 'benign' ? 'text-gray-400' : 'text-red-400';
          ringColor  = PATHOGEN_REGISTRY[displayType]?.ringColor ?? '#f43f5e';
        }

        const load = isKnown ? getPrimaryLoad(inst, isVisible) : 0;

        return (
          <div key={inst.uid ?? inst.type} className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                {/* Detection-level dot */}
                <span
                  className="shrink-0 w-2 h-2 rounded-full"
                  style={{ background: ringColor, opacity: isKnown ? 1 : 0.5 }}
                />
                <span className={`text-xs truncate ${labelColor}`}>{label}</span>
              </div>
              {isKnown && (
                <span className="text-xs font-mono text-gray-500 shrink-0">{Math.round(load)}</span>
              )}
            </div>
            {isKnown ? (
              <BarFill value={load} color={barColor} />
            ) : (
              <div className="h-2 w-full rounded-full bg-gray-800 overflow-hidden">
                <div className={`h-full w-1/4 rounded-full ${barColor} opacity-25`} />
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
  selectedCellId,
  onRecall,
  onClose,
  onDeployToNode,
  visibleNodes,
}) {
  const node = NODES[nodeId];
  if (!node) return null;

  const isVisible = visibleNodes?.has(nodeId) ?? false;
  const siteGt = groundTruthNodeState
    ? {
        ...groundTruthNodeState,
        inflammation: isVisible
          ? groundTruthNodeState.inflammation
          : (groundTruthNodeState.lastKnownInflammation ?? 0),
      }
    : null;

  const cellsHere    = Object.values(deployedCells).filter(c => c.nodeId === nodeId && c.phase === 'arrived');
  const cellsTransit = Object.values(deployedCells).filter(c =>
    c.nodeId === nodeId && (c.phase === 'outbound' || c.phase === 'returning'));

  return (
    <div className="flex flex-col h-full bg-gray-950 border-l border-gray-800">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-gray-800 shrink-0">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-mono font-bold text-gray-100">{node.label}</span>
            {node.isHQ && (
              <span className="text-xs text-purple-400 border border-purple-800 px-1.5 py-0.5 rounded bg-purple-950">HQ</span>
            )}
            {node.isBottleneck && (
              <span className="text-xs text-yellow-600 border border-yellow-900 px-1.5 py-0.5 rounded bg-yellow-950">KEY</span>
            )}
            {node.isSystemic && (
              <span className="text-xs text-blue-600 border border-blue-900 px-1.5 py-0.5 rounded bg-blue-950">SYS</span>
            )}
          </div>
          {!isVisible && (
            <div className="text-xs text-gray-700 mt-0.5 italic">No active surveillance</div>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-gray-700 hover:text-gray-400 text-xl leading-none transition-colors ml-3"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">

        <SiteStatusPanel
          gt={siteGt}
          liveIntegrity={groundTruthNodeState?.tissueIntegrity ?? null}
          isStale={!isVisible && !!groundTruthNodeState}
          turnsSinceLastVisible={groundTruthNodeState?.turnsSinceLastVisible ?? 0}
        />

        <PathogenPanel groundTruthNodeState={groundTruthNodeState} isVisible={isVisible} />

        {/* Friendly cells */}
        <section className="border-b border-gray-800">
          <div className="px-4 py-3 text-xs text-gray-500 uppercase tracking-widest">
            Your Cells Here
          </div>

          {cellsHere.length === 0 && cellsTransit.length === 0 && (
            <div className="px-4 pb-4 text-xs text-gray-700 italic">No cells deployed.</div>
          )}

          {cellsHere.length > 0 && (
            <div className="space-y-px pb-2">
              {cellsHere.map(cell => {
                const cc = CELL_TYPE_CONFIG[cell.type] ?? { displayName: cell.type, textClass: 'text-gray-500', color: '#6b7280' };
                return (
                  <div key={cell.id} className="flex items-center gap-2.5 px-4 py-2 hover:bg-gray-900 transition-colors">
                    <CellIcon type={cell.type} size={14} color={cc.color ?? '#6b7280'} />
                    <span className={`text-xs font-mono ${cc.textClass} flex-1`}>{cc.displayName}</span>
                    <button
                      onClick={() => onRecall(cell.id)}
                      className="text-xs text-gray-700 hover:text-red-500 font-mono transition-colors"
                    >
                      recall
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {cellsTransit.length > 0 && (
            <div className="pb-2">
              <div className="px-4 pt-1 pb-1.5 text-xs text-gray-700 uppercase tracking-widest" style={{ fontSize: '10px' }}>
                Passing through
              </div>
              {cellsTransit.map(cell => {
                const cc = CELL_TYPE_CONFIG[cell.type] ?? { displayName: cell.type, textClass: 'text-gray-600', color: '#4b5563' };
                const isOutbound = cell.phase === 'outbound';
                const destLabel = isOutbound
                  ? (NODES[cell.destNodeId]?.label ?? cell.destNodeId ?? '?')
                  : 'HQ';
                const eta = (cell.path && cell.pathIndex != null)
                  ? computePathCost(cell.path, cell.pathIndex)
                  : null;
                return (
                  <div key={cell.id} className="flex items-center gap-2.5 px-4 py-2 opacity-50">
                    <CellIcon type={cell.type} size={13} color={cc.color ?? '#4b5563'} />
                    <span className={`text-xs font-mono ${cc.textClass} flex-1`}>{cc.displayName}</span>
                    <span className="text-xs text-gray-600 font-mono">
                      {isOutbound ? '→' : '↩'} {destLabel}{eta != null ? ` ${eta}T` : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Deploy */}
        <section className="px-4 py-3">
          {selectedCellId && deployedCells[selectedCellId]?.phase === 'ready' ? (() => {
            const cell = deployedCells[selectedCellId];
            const cc = CELL_TYPE_CONFIG[cell.type];
            return (
              <button
                onClick={() => onDeployToNode?.(nodeId)}
                className="w-full py-2 px-3 text-xs font-mono font-bold uppercase tracking-widest border border-green-700 bg-green-950 text-green-300 hover:bg-green-900 rounded transition-colors"
              >
                Deploy {cc?.displayName ?? cell.type} here
              </button>
            );
          })() : (
            <div className="text-xs text-gray-700 italic">
              Select a ready unit from the roster, then right-click this node (or tap Deploy) to deploy.
            </div>
          )}
        </section>

      </div>
    </div>
  );
}

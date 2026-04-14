// NodeDetail — shown when a node is selected.
// Displays: ground truth site status, perceived threat state, friendly cells, deploy hint.

import { useState } from 'react';
import { NODES } from '../data/nodes.js';
import { computePathCost } from '../data/nodes.js';
import { PATHOGEN_DISPLAY_NAMES, getPrimaryLoad, PATHOGEN_REGISTRY } from '../data/pathogens.js';
import { CELL_CONFIG as CELL_TYPE_CONFIG } from '../data/cellConfig.js';
import CellIcon from './CellIcon.jsx';

// ── Sub-components ────────────────────────────────────────────────────────────

function BreakdownTooltip({ breakdown, x, y, expanded }) {
  // Position left of cursor when near right edge of viewport
  const toLeft = x > window.innerWidth * 0.55;
  const style = {
    position: 'fixed',
    top: Math.min(y - 10, window.innerHeight - 240),
    zIndex: 60,
    pointerEvents: 'none',
    ...(toLeft ? { right: window.innerWidth - x + 8 } : { left: x + 14 }),
  };
  const fmtAmt = (n) => `${n > 0 ? '+' : ''}${n.toFixed(1)}`;
  const fmtPct = (n) => `${n >= 0 ? '+' : ''}${n}%`;

  return (
    <div
      style={style}
      className="bg-gray-900 border border-gray-600 rounded px-3 py-2 shadow-xl text-xs min-w-56 space-y-1.5 select-none"
    >
      {breakdown.map((item, i) => (
        <div key={i}>
          {/* Top line: label + final delta amount */}
          <div className="flex justify-between gap-4">
            <span className={item.strengthValue != null ? 'text-gray-300 font-medium' : 'text-gray-500'}>
              {item.label}
            </span>
            <span className={`font-mono ${item.amount < 0 ? 'text-green-400' : item.amount > 0 ? 'text-red-400' : 'text-gray-500'}`}>
              {fmtAmt(item.amount)}
            </span>
          </div>

          {/* Summary row: strength + modifiers (always shown when item has them) */}
          {item.strengthValue != null && (
            <div className="pl-2 mt-0.5 space-y-0.5">
              {/* Strength summary */}
              <div className="flex justify-between gap-4">
                <span className="text-gray-500">strength</span>
                <span className="font-mono text-gray-400">{item.strengthValue.toFixed(1)}</span>
              </div>
              {/* Strength sub-factors (expanded only) */}
              {expanded && item.strengthFactors?.map((f, j) => (
                <div key={j} className="flex justify-between gap-4 pl-3">
                  <span className="text-gray-700">{f.label}</span>
                  <span className="font-mono text-gray-600">{f.text}</span>
                </div>
              ))}

              {/* Modifiers summary */}
              <div className="flex justify-between gap-4">
                <span className="text-gray-500">modifiers</span>
                <span className={`font-mono ${item.modifierPct < 0 ? 'text-orange-500' : item.modifierPct > 0 ? 'text-green-500' : 'text-gray-600'}`}>
                  {fmtPct(item.modifierPct)}
                </span>
              </div>
              {/* Modifier sub-factors (expanded only) */}
              {expanded && item.modifierFactors?.map((f, j) => (
                <div key={j} className="flex justify-between gap-4 pl-3">
                  <span className="text-gray-700">{f.label}</span>
                  <span className="font-mono text-gray-600">{f.text}</span>
                </div>
              ))}

              {/* Attention (only when split across pathogens) */}
              {item.attentionPct != null && (
                <div className="flex justify-between gap-4">
                  <span className="text-gray-500">attention</span>
                  <span className="font-mono text-blue-400">{item.attentionPct}%</span>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
      <div className="text-gray-700 text-center pt-0.5" style={{ fontSize: '10px' }}>
        {expanded ? 'click row to collapse' : 'click row to expand'}
      </div>
    </div>
  );
}

/**
 * Shows a +N / -N delta badge. No tooltip — tooltip is handled by the parent row.
 * invert=true: positive delta is good (e.g. tissue integrity recovering).
 */
function DeltaBadge({ delta, invert = false }) {
  const rounded = Math.round(delta);
  if (!rounded) return null;
  const isGood = invert ? delta > 0 : delta < 0;
  return (
    <span className={`font-mono tabular-nums text-xs ${isGood ? 'text-green-400' : 'text-red-400'}`}>
      {rounded > 0 ? '+' : ''}{rounded}
    </span>
  );
}

/**
 * Wraps one pathogen row; hovering anywhere on the row shows the breakdown tooltip.
 */
function PathogenRow({ inst, projEntry, label, labelColor, ringColor, expanded, onToggleExpanded }) {
  const [hovered, setHovered] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const isKnown = inst.detected_level === 'classified';
  const load = isKnown ? getPrimaryLoad(inst, true) : 0;
  const hasBreakdown = projEntry?.breakdown?.length > 0;

  return (
    <div
      className="space-y-1.5 cursor-pointer"
      onMouseEnter={e => { setHovered(true); setPos({ x: e.clientX, y: e.clientY }); }}
      onMouseLeave={() => setHovered(false)}
      onMouseMove={e => setPos({ x: e.clientX, y: e.clientY })}
      onClick={hasBreakdown ? onToggleExpanded : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="shrink-0 w-2 h-2 rounded-full"
            style={{ background: ringColor, opacity: isKnown ? 1 : 0.5 }}
          />
          <span className={`text-xs truncate ${labelColor}`}>{label}</span>
        </div>
        {isKnown && (
          <span className="text-xs font-mono text-gray-500 shrink-0 flex items-center gap-1">
            {Math.round(load)}
            {projEntry && <DeltaBadge delta={projEntry.delta} />}
          </span>
        )}
      </div>
      {isKnown ? (
        <BarFill value={load} hexColor={ringColor} />
      ) : (
        <div className="h-2 w-full rounded-full bg-gray-800 overflow-hidden">
          <div className="h-full w-1/4 rounded-full opacity-25" style={{ background: ringColor }} />
        </div>
      )}
      {hovered && hasBreakdown && (
        <BreakdownTooltip breakdown={projEntry.breakdown} x={pos.x} y={pos.y} expanded={expanded} />
      )}
    </div>
  );
}

function BarFill({ value, max = 100, color, hexColor, bg = 'bg-gray-800', ceiling = null }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={`relative h-2 w-full rounded-full ${bg} overflow-hidden`}>
      {ceiling != null && ceiling < 100 && (
        <div
          className="absolute inset-y-0 bg-gray-700 opacity-30"
          style={{ left: `${ceiling}%`, right: 0 }}
        />
      )}
      <div
        className={`h-full rounded-full transition-all ${hexColor ? '' : color}`}
        style={{ width: `${pct}%`, ...(hexColor ? { background: hexColor } : {}) }}
      />
    </div>
  );
}

function SiteStatusPanel({ gt, liveIntegrity = null, nodeProjection = null }) {
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
      </div>

      {gt && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-gray-500">Inflammation</span>
            <span className={`font-mono font-bold flex items-center gap-1 ${inflammation > 40 ? 'text-orange-400' : 'text-gray-500'}`}>
              {Math.round(inflammation)}
              {nodeProjection && <DeltaBadge delta={nodeProjection.inflammationDelta} />}
            </span>
          </div>
          <BarFill value={inflammation} color={inflColor} />
        </div>
      )}

      <div className="space-y-1.5">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-gray-500">Tissue Integrity</span>
          <span className={`font-mono font-bold flex items-center gap-1 ${integrity < 40 ? 'text-red-400' : 'text-gray-400'}`}>
            {Math.round(integrity)}
            {gt && ceiling < 100 && (
              <span className="text-gray-700 font-normal"> / {Math.round(ceiling)}</span>
            )}
            {nodeProjection && <DeltaBadge delta={nodeProjection.tissueIntegrityDelta} invert />}
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

function PathogenPanel({ groundTruthNodeState, nodeProjection = null }) {
  const [expanded, setExpanded] = useState(false);
  const pathogens = (groundTruthNodeState?.pathogens ?? [])
    .filter(inst => inst.detected_level !== 'none');

  return (
    <section className="border-b border-gray-800 px-4 py-4 space-y-3">
      <div className="text-xs text-gray-500 uppercase tracking-widest">Threats</div>

      {pathogens.length === 0 && (
        <div className="text-xs text-gray-700 italic">No threats detected.</div>
      )}

      {pathogens.map(inst => {
        const level = inst.detected_level;
        let label, labelColor, ringColor;

        if (level === 'unknown') {
          label      = 'Unknown presence';
          labelColor = 'text-gray-500';
          ringColor  = '#6b7280';
        } else {
          // classified
          const displayType = inst.perceived_type ?? inst.type;
          label      = PATHOGEN_DISPLAY_NAMES[displayType] ?? displayType;
          labelColor = displayType === 'benign' ? 'text-gray-400' : 'text-red-400';
          ringColor  = PATHOGEN_REGISTRY[displayType]?.ringColor ?? '#f43f5e';
        }

        return (
          <PathogenRow
            key={inst.uid ?? inst.type}
            inst={inst}
            projEntry={nodeProjection?.pathogenDeltas?.[inst.uid] ?? null}
            label={label}
            labelColor={labelColor}
            ringColor={ringColor}
            expanded={expanded}
            onToggleExpanded={() => setExpanded(v => !v)}
          />
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
  onStartPatrol,
  projections = null,
}) {
  const node = NODES[nodeId];
  if (!node) return null;

  const nodeProjection = projections?.nodes?.[nodeId] ?? null;
  const siteGt = groundTruthNodeState ?? null;

  const cellsHereRaw = Object.values(deployedCells).filter(c => c.nodeId === nodeId && c.phase === 'arrived' && !c.isPatrolling);
  const cellsTransit = Object.values(deployedCells).filter(c =>
    c.nodeId === nodeId && (c.phase === 'outbound' || c.phase === 'returning' || (c.phase === 'arrived' && c.isPatrolling)));

  // Stack same-type cells at this node
  const cellsHereStacks = (() => {
    const seen = new Map();
    const result = [];
    for (const cell of cellsHereRaw) {
      if (seen.has(cell.type)) {
        seen.get(cell.type).push(cell);
      } else {
        const stack = [cell];
        seen.set(cell.type, stack);
        result.push(stack);
      }
    }
    return result;
  })();
  const cellsHere = cellsHereRaw; // keep for length check

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
          nodeProjection={nodeProjection}
        />

        <PathogenPanel groundTruthNodeState={groundTruthNodeState} nodeProjection={nodeProjection} />

        {/* Friendly cells */}
        <section className="border-b border-gray-800">
          <div className="px-4 py-3 text-xs text-gray-500 uppercase tracking-widest">
            Your Cells Here
          </div>

          {cellsHere.length === 0 && cellsTransit.length === 0 && (
            <div className="px-4 pb-4 text-xs text-gray-700 italic">No cells deployed.</div>
          )}

          {cellsHereStacks.length > 0 && (
            <div className="space-y-px pb-2">
              {cellsHereStacks.map(stack => {
                const cell = stack[0];
                const count = stack.length;
                const cc = CELL_TYPE_CONFIG[cell.type] ?? { displayName: cell.type, textClass: 'text-gray-500', color: '#6b7280' };
                return (
                  <div key={cell.id} className="flex items-center gap-2.5 px-4 py-2 hover:bg-gray-900 transition-colors">
                    <CellIcon type={cell.type} size={14} color={cc.color ?? '#6b7280'} />
                    <span className={`text-xs font-mono ${cc.textClass} flex-1 flex items-center gap-1.5`}>
                      {cc.displayName}
                      {count > 1 && (
                        <span className="text-xs font-mono font-bold bg-gray-800 text-gray-400 px-1 rounded leading-tight">×{count}</span>
                      )}
                    </span>
                    <button
                      onClick={e => (e.shiftKey ? stack : [stack[0]]).forEach(c => onRecall(c.id))}
                      className="text-xs text-gray-700 hover:text-red-500 font-mono transition-colors"
                      title={count > 1 ? 'Recall · shift+click for all' : 'Recall'}
                    >
                      recall{count > 1 ? ` ×${count}` : ''}
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
                const isPatrollingHere = cell.isPatrolling && cell.phase === 'arrived';
                const isOutbound = cell.phase === 'outbound';
                const indicator = isPatrollingHere ? '↻' : isOutbound ? '→' : '↩';
                const destLabel = isPatrollingHere
                  ? 'patrol'
                  : isOutbound
                    ? (NODES[cell.destNodeId]?.label ?? cell.destNodeId ?? '?')
                    : 'HQ';
                const eta = (!isPatrollingHere && cell.path && cell.pathIndex != null)
                  ? computePathCost(cell.path, cell.pathIndex)
                  : null;
                return (
                  <div key={cell.id} className="flex items-center gap-2.5 px-4 py-2 opacity-50">
                    <CellIcon type={cell.type} size={13} color={cc.color ?? '#4b5563'} />
                    <span className={`text-xs font-mono ${cc.textClass} flex-1`}>{cc.displayName}</span>
                    <span className="text-xs text-gray-600 font-mono">
                      {indicator} {destLabel}{eta != null ? ` ${eta}T` : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Deploy / Patrol */}
        <section className="px-4 py-3">
          {selectedCellId && deployedCells[selectedCellId]?.phase === 'ready' ? (() => {
            const cell = deployedCells[selectedCellId];
            const cc = CELL_TYPE_CONFIG[cell.type];
            const isRecon = cc?.isDetector || cc?.isClassifier;
            const stackCount = Object.values(deployedCells).filter(c => c.type === cell.type && c.phase === 'ready').length;
            const hasStack = stackCount > 1;
            return (
              <div className="flex flex-col gap-2">
                <button
                  onClick={e => onDeployToNode?.(nodeId, e.shiftKey)}
                  className="w-full py-2 px-3 text-xs font-mono font-bold uppercase tracking-widest border border-green-700 bg-green-950 text-green-300 hover:bg-green-900 rounded transition-colors"
                  title={hasStack ? `Shift+click to deploy all ${stackCount}` : undefined}
                >
                  Deploy {cc?.displayName ?? cell.type} here{hasStack ? ` (${stackCount} ready)` : ''}
                </button>
                {isRecon && (
                  <button
                    onClick={e => onStartPatrol?.(selectedCellId, e.shiftKey)}
                    className="w-full py-2 px-3 text-xs font-mono font-bold uppercase tracking-widest border border-amber-700 bg-amber-950 text-amber-300 hover:bg-amber-900 rounded transition-colors"
                    title={hasStack ? `Shift+click to patrol all ${stackCount}` : undefined}
                  >
                    Patrol ↻{hasStack ? ` (${stackCount})` : ''}
                  </button>
                )}
                {hasStack && (
                  <div className="text-xs text-gray-700 text-center">shift+click to deploy/patrol all</div>
                )}
              </div>
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

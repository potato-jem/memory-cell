// MobileRoster — mobile unit management.
// Bar: horizontal strip of cell icons. Tap anywhere to open roster drawer.
// Drawer: slides up from bottom, controlled externally via isOpen/onClose.
// Deploy button: tap = deploy to selected node (if any), long-press = choose node.

import { useRef } from 'react';
import { CELL_CONFIG, ALL_CELL_TYPES } from '../data/cellConfig.js';
import { DEPLOY_COSTS, CELL_DISPLAY_NAMES } from '../engine/cells.js';
import { PATHOGEN_DISPLAY_NAMES, PATHOGEN_RING_COLORS } from '../data/pathogens.js';
import { TICKS_PER_TURN } from '../data/gameConfig.js';
import { NODES } from '../data/nodes.js';
import CellIcon from './CellIcon.jsx';

// Long-press button: single tap = onClick, hold 500ms = onLongPress
function DeployBtn({ onTap, onLongPress, disabled, className, children }) {
  const timer = useRef(null);
  const fired = useRef(false);

  function onStart(e) {
    if (disabled) return;
    fired.current = false;
    timer.current = setTimeout(() => {
      fired.current = true;
      onLongPress?.();
    }, 500);
  }
  function onEnd() {
    clearTimeout(timer.current);
    if (!fired.current && !disabled) onTap?.();
  }
  function onCancel() { clearTimeout(timer.current); }

  return (
    <button
      disabled={disabled}
      className={className}
      onMouseDown={onStart}
      onMouseUp={onEnd}
      onMouseLeave={onCancel}
      onTouchStart={e => { e.stopPropagation(); onStart(e); }}
      onTouchEnd={e => { e.preventDefault(); onEnd(); }}
      onTouchCancel={onCancel}
    >
      {children}
    </button>
  );
}

function getClearanceEntries(cellType) {
  const cfg = CELL_CONFIG[cellType];
  if (!cfg || cfg.clearanceRate === 0) return [];
  return Object.entries(cfg.clearablePathogens ?? {})
    .filter(([pathType, mult]) => mult > 0 && PATHOGEN_RING_COLORS[pathType])
    .map(([pathType, mult]) => ({
      pathType,
      strength: Math.round(cfg.clearanceRate * mult),
      color: PATHOGEN_RING_COLORS[pathType],
      label: PATHOGEN_DISPLAY_NAMES[pathType] ?? pathType,
    }));
}

export default function MobileRoster({
  deployedCells,
  tokenCapacity,
  tokensInUse,
  runConfig,
  isOpen,
  isPlaying,            // whether the game is in playing phase (show end turn button)
  onOpenRoster,         // toggle-open the drawer
  onClose,
  onTrainCell,
  onSelectCellForDeploy, // (cellId) => void — enter select-node mode
  onRecall,              // (cellId) => void
  onDecommission,        // (cellId) => void
  onStartPatrol,         // (cellId) => void — start patrol for a recon cell
  onEndTurn,             // () => void — end the turn
  tooltipNode,           // currently selected node id (or null)
  onDeployDirect,        // (cellId, nodeId) => void — deploy directly
  nodeBarSlot,           // JSX to show at top of drawer when a node is selected
}) {
  const tokensAvailable = tokenCapacity - tokensInUse;
  const allTrainable = [...ALL_CELL_TYPES];
  const allCells = Object.values(deployedCells);

  // Cells present (arrived) at the currently selected node, by type
  const cellsAtNode = tooltipNode
    ? allCells.filter(c => c.nodeId === tooltipNode && c.phase === 'arrived')
    : [];
  const firstCellAtNodeByType = {};
  for (const cell of cellsAtNode) {
    if (!firstCellAtNodeByType[cell.type]) firstCellAtNodeByType[cell.type] = cell.id;
  }

  function getTypeSummary(type) {
    const cells = allCells.filter(c => c.type === type);
    return {
      ready:    cells.filter(c => c.phase === 'ready'),
      training: cells.filter(c => c.phase === 'training'),
      out:      cells.filter(c => c.phase === 'arrived' || c.phase === 'outbound' || c.phase === 'returning'),
      total:    cells.length,
    };
  }

  // Single tap: deploy to selected node, or enter select-node mode if none selected
  function handleDeploy(type) {
    const { ready } = getTypeSummary(type);
    if (!ready.length) return;
    const cellId = ready[0].id;
    if (tooltipNode) {
      onDeployDirect(cellId, tooltipNode);
    } else {
      onSelectCellForDeploy(cellId);
    }
    onClose();
  }

  // Long press: always enter select-node mode
  function handleDeploySelectMode(type) {
    const { ready } = getTypeSummary(type);
    if (!ready.length) return;
    onSelectCellForDeploy(ready[0].id);
    onClose();
  }

  function handlePatrol(type) {
    const { ready } = getTypeSummary(type);
    if (!ready.length) return;
    onStartPatrol?.(ready[0].id);
    onClose();
  }

  const deployLabel = tooltipNode
    ? `→ ${NODES[tooltipNode]?.label ?? 'Deploy'}`
    : 'Deploy →';

  return (
    <>
      {/* ── Roster drawer (slides up from bottom) ── */}
      {isOpen && (
        <div className="fixed inset-0 z-30 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/60" onClick={onClose} />

          <div
            className="relative bg-gray-900 border-t border-gray-700 rounded-t-xl overflow-hidden flex flex-col"
            style={{ maxHeight: '82vh' }}
          >
            {/* Node bar at top of drawer (when a node is selected) */}
            {nodeBarSlot && (
              <div className="shrink-0">{nodeBarSlot}</div>
            )}

            {/* Drawer header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
              <span className="text-xs font-mono uppercase tracking-widest text-gray-400">Units</span>
              <div className="flex items-center gap-4">
                <span className={`text-xs font-mono font-bold ${tokensInUse >= tokenCapacity ? 'text-red-400' : 'text-cyan-400'}`}>
                  {tokensInUse}<span className="text-gray-600 font-normal">/{tokenCapacity}</span>
                  <span className="text-gray-700 font-normal"> tokens</span>
                </span>
                <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg leading-none px-1">↓</button>
              </div>
            </div>

            {/* Scrollable cell-type list */}
            <div className="overflow-y-auto flex-1">
              {allTrainable.map(type => {
                const cfg = CELL_CONFIG[type];
                const cost = DEPLOY_COSTS[type] ?? 0;
                const trainingTurns = Math.ceil((cfg?.trainingTicks ?? 15) / TICKS_PER_TURN);
                const canAfford = tokensAvailable >= cost;
                const { ready, training, out } = getTypeSummary(type);
                const clearanceEntries = getClearanceEntries(type);

                return (
                  <div key={type} className="border-b border-gray-800 px-4 py-3.5">

                    {/* Type header */}
                    <div className="flex items-center gap-3 mb-2.5">
                      <CellIcon type={type} size={20} color={cfg?.color ?? '#888'} />
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm font-mono font-bold ${cfg?.textClass ?? 'text-gray-300'}`}>
                          {cfg?.displayName ?? type}
                        </div>
                        <div className="text-xs text-gray-600 font-mono">
                          {cost}t deploy · {trainingTurns}T train
                        </div>
                      </div>
                      {/* Status chips */}
                      <div className="flex flex-wrap gap-1 justify-end">
                        {training.length > 0 && (
                          <span className="text-xs font-mono px-1.5 py-0.5 bg-yellow-950 border border-yellow-800 text-yellow-600 rounded">
                            {training.length} training
                          </span>
                        )}
                        {ready.length > 0 && (
                          <span className="text-xs font-mono px-1.5 py-0.5 bg-green-950 border border-green-800 text-green-500 rounded">
                            {ready.length} ready
                          </span>
                        )}
                        {out.length > 0 && (
                          <span className="text-xs font-mono px-1.5 py-0.5 bg-cyan-950 border border-cyan-800 text-cyan-600 rounded">
                            {out.length} out
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Abilities */}
                    {clearanceEntries.length > 0 ? (
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mb-2.5">
                        {clearanceEntries.map(({ pathType, strength, color, label }) => (
                          <span key={pathType} className="text-xs font-mono flex items-center gap-1" style={{ color }}>
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                            {label} ×{strength}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-gray-700 mb-2.5 italic">Recon / surveillance only</div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => canAfford && onTrainCell(type)}
                        disabled={!canAfford}
                        className={`flex-1 py-2 text-xs font-mono border rounded transition-colors ${
                          canAfford
                            ? 'border-gray-600 text-gray-300 hover:bg-gray-800 active:bg-gray-700'
                            : 'border-gray-800 text-gray-700 cursor-not-allowed'
                        }`}
                      >
                        + Train ({cost}t)
                      </button>
                      {ready.length > 0 && (
                        <DeployBtn
                          onTap={() => handleDeploy(type)}
                          onLongPress={() => handleDeploySelectMode(type)}
                          className="flex-1 py-2 text-xs font-mono border border-green-700 bg-green-950 text-green-300 rounded hover:bg-green-900 active:bg-green-800 transition-colors select-none"
                          title="Tap to deploy to selected node · Hold to choose node"
                        >
                          {deployLabel}
                        </DeployBtn>
                      )}
                      {ready.length > 0 && cfg?.isRecon && (
                        <button
                          onClick={() => handlePatrol(type)}
                          className="flex-1 py-2 text-xs font-mono border border-amber-700 bg-amber-950 text-amber-300 rounded hover:bg-amber-900 active:bg-amber-800 transition-colors"
                        >
                          Patrol ↻
                        </button>
                      )}
                    </div>

                    {/* Deployed cells of this type — recall/decommission */}
                    {[...training, ...ready, ...out].map(cell => {
                      const canRecall = cell.phase === 'outbound' || cell.phase === 'arrived';
                      const canDecom = cell.phase === 'training' || cell.phase === 'ready';
                      if (!canRecall && !canDecom) return null;
                      const nodeLabel = cell.nodeId ? (NODES[cell.nodeId]?.label ?? cell.nodeId) : null;
                      const destLabel = cell.destNodeId ? (NODES[cell.destNodeId]?.label ?? cell.destNodeId) : null;
                      const statusText = cell.phase === 'training' ? 'training'
                        : cell.phase === 'ready' ? 'ready'
                        : cell.phase === 'arrived' && cell.isPatrolling ? `↻ ${nodeLabel ?? 'patrol'}`
                        : cell.phase === 'arrived' ? (nodeLabel ?? 'on site')
                        : cell.phase === 'outbound' && cell.isPatrolling ? `↻ → ${destLabel ?? '?'}`
                        : cell.phase === 'outbound' ? `→ ${destLabel ?? '?'}`
                        : '↩';
                      return (
                        <div key={cell.id} className="flex items-center justify-between mt-1.5 px-1 py-1 bg-gray-800 rounded text-xs font-mono">
                          <span className="text-gray-500 truncate flex-1">{statusText}</span>
                          {canRecall && (
                            <button
                              onClick={() => onRecall?.(cell.id)}
                              className="ml-2 px-1.5 py-0.5 border border-amber-800 text-amber-600 rounded hover:bg-amber-950 transition-colors"
                            >
                              ↩ recall
                            </button>
                          )}
                          {canDecom && (
                            <button
                              onClick={() => onDecommission?.(cell.id)}
                              className="ml-2 px-1.5 py-0.5 border border-red-900 text-red-700 rounded hover:bg-red-950 transition-colors"
                            >
                              × remove
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Horizontal bar ── */}
      <div className="bg-gray-900 border-t border-gray-800 flex flex-col">

        {/* Top strip: token economy + open drawer button */}
        <div className="flex items-center justify-between px-3 pt-1 pb-0.5 cursor-pointer" onClick={onOpenRoster}>
          <span className={`text-xs font-mono tabular-nums ${tokensInUse >= tokenCapacity ? 'text-red-400' : 'text-gray-500'}`}>
            {tokensInUse}<span className="text-gray-700">/{tokenCapacity}</span>
            <span className="text-gray-700"> t</span>
          </span>
          <button
            onClick={e => { e.stopPropagation(); onOpenRoster(); }}
            className="w-7 h-5 flex items-center justify-center rounded border border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600 transition-colors text-xs"
            title="Open unit roster"
          >
            ↑
          </button>
        </div>

        {/* Bottom strip: end turn (pinned left) + scrollable cell type 2×2 grids */}
        <div className="flex items-stretch pb-1">

          {/* End Turn — pinned left, non-scrollable */}
          <div className="shrink-0 flex items-center px-1.5 border-r border-gray-800" onClick={e => e.stopPropagation()}>
            {isPlaying && (
              <button
                onClick={onEndTurn}
                className="h-full min-h-[2.5rem] px-2 flex items-center justify-center bg-green-900 hover:bg-green-800 active:bg-green-700 text-green-200 text-base font-mono font-bold border border-green-700 rounded transition-colors cta-breathe"
                title="End Turn"
              >
                →
              </button>
            )}
          </div>

          {/* Scrollable cell type slots */}
          <div className="flex overflow-x-auto flex-1">
            {allTrainable.map(type => {
              const cfg = CELL_CONFIG[type];
              const cost = DEPLOY_COSTS[type] ?? 0;
              const canAfford = tokensAvailable >= cost;
              const { ready, training, total } = getTypeSummary(type);
              const hasReady = ready.length > 0;
              const iconColor = total > 0 ? (cfg?.color ?? '#888') : (canAfford ? '#4b5563' : '#374151');
              const cellAtNode = firstCellAtNodeByType[type];

              return (
                <div
                  key={type}
                  className="shrink-0 flex flex-col items-center gap-0.5 px-1.5 pt-1"
                  onClick={e => e.stopPropagation()}
                >
                  {/* Icon + count badge */}
                  <div className="relative mb-0.5">
                    <CellIcon type={type} size={18} color={iconColor} />
                    {total > 0 && (
                      <span
                        className={`absolute -top-1 -right-1.5 w-3.5 h-3.5 flex items-center justify-center rounded-full text-gray-200 font-mono font-bold ${
                          hasReady ? 'bg-green-800' : training.length > 0 ? 'bg-yellow-900' : 'bg-gray-700'
                        }`}
                        style={{ fontSize: 8 }}
                      >
                        {total}
                      </span>
                    )}
                  </div>

                  {/* Row 1: − recall / + train */}
                  <div className="flex gap-0.5">
                    <button
                      onClick={e => { e.stopPropagation(); cellAtNode && onRecall?.(cellAtNode); }}
                      disabled={!cellAtNode}
                      className={`w-6 h-5 flex items-center justify-center rounded text-xs border transition-colors ${
                        cellAtNode
                          ? 'border-amber-800 text-amber-500 hover:bg-amber-950 active:bg-amber-900'
                          : 'border-gray-800 text-gray-800 cursor-default'
                      }`}
                      title={cellAtNode ? `Recall ${CELL_DISPLAY_NAMES[type] ?? type} from ${NODES[tooltipNode]?.label ?? 'node'}` : undefined}
                    >
                      −
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); canAfford && onTrainCell(type); }}
                      disabled={!canAfford}
                      className={`w-6 h-5 flex items-center justify-center rounded text-xs border transition-colors ${
                        canAfford
                          ? 'border-gray-600 text-gray-400 hover:bg-gray-700 active:bg-gray-600'
                          : 'border-gray-800 text-gray-800 cursor-default'
                      }`}
                      title={`Train ${CELL_DISPLAY_NAMES[type] ?? type} (${cost}t)`}
                    >
                      +
                    </button>
                  </div>

                  {/* Row 2: deploy / patrol */}
                  <div className="flex gap-0.5">
                    <DeployBtn
                      onTap={() => handleDeploy(type)}
                      onLongPress={() => handleDeploySelectMode(type)}
                      disabled={!hasReady}
                      className={`w-6 h-5 flex items-center justify-center rounded text-xs border transition-colors select-none ${
                        hasReady
                          ? 'border-green-800 text-green-500 hover:bg-green-950 active:bg-green-900'
                          : 'border-gray-800 text-gray-800 cursor-default'
                      }`}
                      title={hasReady ? (tooltipNode ? `Deploy to ${NODES[tooltipNode]?.label ?? '?'} · Hold to choose` : `Deploy ${CELL_DISPLAY_NAMES[type] ?? type}`) : undefined}
                    >
                      {tooltipNode ? '→' : '▶'}
                    </DeployBtn>
                    {cfg?.isRecon && (
                      <button
                        onClick={e => { e.stopPropagation(); hasReady && handlePatrol(type); }}
                        disabled={!hasReady}
                        className={`w-6 h-5 flex items-center justify-center rounded text-xs border transition-colors ${
                          hasReady
                            ? 'border-amber-800 text-amber-500 hover:bg-amber-950 active:bg-amber-900'
                            : 'border-gray-800 text-gray-800 cursor-default'
                        }`}
                        title={hasReady ? `Patrol ${CELL_DISPLAY_NAMES[type] ?? type}` : undefined}
                      >
                        ↻
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

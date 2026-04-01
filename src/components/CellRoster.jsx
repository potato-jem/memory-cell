// CellRoster — left sidebar showing all units and the manufacturing queue.
// Click '+' to train a cell type. Click any unit card to select it.
// Right-click a node on the body map to deploy a ready cell there.
// Click ↩ on a deployed cell to recall it.

import { useState } from 'react';
import { CELL_TYPES, CELL_DISPLAY_NAMES, DEPLOY_COSTS } from '../engine/cells.js';
import { CELL_CONFIG, RECON_CELL_TYPES } from '../data/cellConfig.js';
import { PATHOGEN_RING_COLORS, PATHOGEN_DISPLAY_NAMES } from '../data/pathogens.js';
import { TOKEN_CAPACITY_MAX, TOKEN_CAPACITY_REGEN_INTERVAL, TICKS_PER_TURN } from '../data/gameConfig.js';
import { NODES, computePathCost } from '../data/nodes.js';

const PHASE_LABEL = {
  training: 'training',
  ready:    'READY',
  outbound: 'en route',
  arrived:  'on site',
  returning:'returning',
};

const PHASE_COLOR = {
  training: 'text-yellow-700',
  ready:    'text-green-400',
  outbound: 'text-blue-400',
  arrived:  'text-cyan-400',
  returning:'text-gray-500',
};

const GROUP_MODES = ['none', 'type', 'location'];
const GROUP_LABELS = { none: 'ungrouped', type: 'by type', location: 'by location' };

function shortName(type) {
  return CELL_DISPLAY_NAMES[type] ?? type;
}

function getClearanceEntries(cellType) {
  const cfg = CELL_CONFIG[cellType];
  if (!cfg || cfg.clearanceRate === 0) return [];
  return Object.entries(cfg.clearablePathogens)
    .filter(([pathType, mult]) => mult > 0 && PATHOGEN_RING_COLORS[pathType])
    .map(([pathType, mult]) => ({
      pathType,
      strength: cfg.clearanceRate * mult,
      color: PATHOGEN_RING_COLORS[pathType],
      label: PATHOGEN_DISPLAY_NAMES[pathType] ?? pathType,
    }));
}

function buildGroups(cells, groupBy) {
  if (groupBy === 'type') {
    const map = {};
    for (const cell of cells) {
      const k = cell.type;
      if (!map[k]) map[k] = { key: k, label: shortName(cell.type), cells: [] };
      map[k].cells.push(cell);
    }
    return Object.values(map);
  }
  if (groupBy === 'location') {
    const map = {};
    for (const cell of cells) {
      let k, label;
      if (cell.phase === 'training' || cell.phase === 'ready') {
        k = '__base'; label = 'Base';
      } else if (cell.phase === 'returning') {
        k = '__returning'; label = 'Returning';
      } else {
        k = cell.nodeId ?? '__unknown';
        label = NODES[cell.nodeId]?.label ?? cell.nodeId ?? '?';
      }
      if (!map[k]) map[k] = { key: k, label, cells: [] };
      map[k].cells.push(cell);
    }
    return Object.values(map);
  }
  // 'none'
  return [{ key: null, label: null, cells }];
}

export default function CellRoster({
  deployedCells,
  tokenCapacity,
  tokensInUse,
  currentTick,
  selectedCellId,
  runConfig,
  onTrainCell,
  onSelectCell,
  onDecommission,
  onRecall,
}) {
  const [groupBy, setGroupBy] = useState('none');
  const [tooltip, setTooltip] = useState(null); // { cellType, x, y }

  const tokensAvailable = tokenCapacity - tokensInUse;
  const ticksUntilRegen = TOKEN_CAPACITY_REGEN_INTERVAL - (currentTick % TOKEN_CAPACITY_REGEN_INTERVAL);
  const turnsUntilRegen = Math.max(1, Math.ceil(ticksUntilRegen / TICKS_PER_TURN));
  const atCap = tokenCapacity >= TOKEN_CAPACITY_MAX;

  const availableAttack = runConfig?.availableResponders ?? [];
  const allTrainable = [...RECON_CELL_TYPES, ...availableAttack];

  const allCells = Object.values(deployedCells).sort((a, b) => {
    const order = { training: 0, ready: 1, outbound: 2, arrived: 3, returning: 4 };
    return (order[a.phase] ?? 5) - (order[b.phase] ?? 5);
  });

  const groups = buildGroups(allCells, groupBy);

  function cycleGroup() {
    const idx = GROUP_MODES.indexOf(groupBy);
    setGroupBy(GROUP_MODES[(idx + 1) % GROUP_MODES.length]);
  }

  function turnsLeft(targetTick) {
    return Math.max(1, Math.ceil((targetTick - currentTick) / TICKS_PER_TURN));
  }

  function pathTurnsLeft(cell) {
    if (cell.path && cell.pathIndex != null) {
      return computePathCost(cell.path, cell.pathIndex);
    }
    return null;
  }

  function getStatusLine(cell) {
    if (cell.phase === 'training') {
      return `training ${turnsLeft(cell.trainingCompleteTick)}T`;
    }
    if (cell.phase === 'outbound') {
      const dest = cell.destNodeId ? (NODES[cell.destNodeId]?.label ?? cell.destNodeId) : '?';
      const eta = pathTurnsLeft(cell);
      const etaStr = eta != null ? ` ${eta}T` : '';
      // Show current intermediate node if not at origin
      const atNode = cell.nodeId && cell.nodeId !== 'BLOOD' && cell.nodeId !== cell.destNodeId
        ? ` (via ${NODES[cell.nodeId]?.label ?? cell.nodeId})`
        : '';
      return `→ ${dest}${etaStr}${atNode}`;
    }
    if (cell.phase === 'arrived') {
      return NODES[cell.nodeId]?.label ?? cell.nodeId ?? 'on site';
    }
    if (cell.phase === 'returning') {
      const eta = pathTurnsLeft(cell);
      return eta != null ? `↩ ${eta}T` : '↩ returning';
    }
    return PHASE_LABEL[cell.phase] ?? cell.phase;
  }

  const canRecall = phase => phase === 'outbound' || phase === 'arrived';
  const canDecommission = phase => phase === 'training' || phase === 'ready';

  const tooltipEntries = tooltip ? getClearanceEntries(tooltip.cellType) : [];

  return (
    <>
    {tooltip && tooltipEntries.length > 0 && (
      <div
        style={{ position: 'fixed', left: tooltip.x + 12, top: tooltip.y - 8, zIndex: 50 }}
        className="pointer-events-none bg-gray-900 border border-gray-700 rounded px-2 py-1.5 shadow-lg text-xs"
      >
        <div className="text-gray-400 font-mono mb-1">{CELL_CONFIG[tooltip.cellType].displayName}</div>
        {tooltipEntries.map(({ pathType, strength, color, label }) => (
          <div key={pathType} className="font-mono" style={{ color }}>
            {label} <span className="opacity-60">({strength})</span>
          </div>
        ))}
      </div>
    )}
    <div className="flex flex-col h-full text-xs overflow-hidden">

      {/* Header: capacity */}
      <div className="px-3 py-2 border-b border-gray-800 shrink-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-gray-600 uppercase tracking-wider">Capacity</span>
          <span className={`font-mono ${tokensInUse >= tokenCapacity ? 'text-red-500' : 'text-cyan-400'}`}>
            {tokensInUse}/{tokenCapacity}
          </span>
        </div>
        <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-cyan-700 transition-all duration-500"
            style={{ width: `${Math.min(100, (tokensInUse / Math.max(tokenCapacity, 1)) * 100)}%` }}
          />
        </div>
        {!atCap && (
          <div className="text-gray-700 mt-1 text-right">
            +1 cap in {turnsUntilRegen}T
          </div>
        )}
      </div>

      {/* Train section */}
      <div className="px-2 py-2 border-b border-gray-800 shrink-0">
        <div className="text-gray-700 uppercase tracking-wider mb-1.5 px-1">Build</div>
        <div className="space-y-0.5">
          {allTrainable.map(type => {
            const cost = DEPLOY_COSTS[type] ?? 0;
            const time = CELL_CONFIG[type]?.trainingTicks ?? 15;
            const canAfford = tokensAvailable >= cost;
            return (
              <button
                key={type}
                onClick={() => canAfford && onTrainCell(type)}
                disabled={!canAfford}
                className={`w-full flex items-center gap-1 px-1.5 py-1 rounded text-left transition-colors ${
                  canAfford ? 'hover:bg-gray-800 text-gray-400' : 'text-gray-700 cursor-not-allowed'
                }`}
                onMouseEnter={e => setTooltip({ cellType: type, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setTooltip(null)}
              >
                <span className={`font-mono font-bold w-3.5 text-center ${canAfford ? 'text-green-600' : 'text-gray-700'}`}>+</span>
                <span className="flex-1 truncate">{shortName(type)}</span>
                <span className={`font-mono ${canAfford ? 'text-cyan-700' : 'text-gray-800'}`}>{cost}t</span>
                <span className="text-gray-800 font-mono ml-1">{time / TICKS_PER_TURN}T</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Units list */}
      <div className="flex-1 overflow-y-auto">

        {/* Units header + group toggle */}
        <div className="px-2 py-1.5 flex items-center justify-between border-b border-gray-800 sticky top-0 bg-gray-950">
          <span className="text-gray-700 uppercase tracking-wider">Units ({allCells.length})</span>
          <button
            onClick={cycleGroup}
            className="text-gray-700 hover:text-gray-500 transition-colors truncate max-w-[80px] text-right"
            title={`Grouping: ${GROUP_LABELS[groupBy]}`}
          >
            {GROUP_LABELS[groupBy]}
          </button>
        </div>

        {allCells.length === 0 ? (
          <div className="px-3 py-3 text-gray-800 italic">No units. Build some above.</div>
        ) : (
          groups.map(group => (
            <div key={group.key ?? '__all'}>
              {/* Group header (omitted in 'none' mode) */}
              {group.label && (
                <div className="px-2 py-0.5 text-gray-700 bg-gray-900 border-b border-gray-800 uppercase tracking-wider">
                  {group.label}
                </div>
              )}
              {group.cells.map(cell => {
                const isSelected = cell.id === selectedCellId;
                const statusLine = getStatusLine(cell);

                return (
                  <div
                    key={cell.id}
                    onClick={() => onSelectCell(isSelected ? null : cell.id)}
                    className={`flex items-center gap-1.5 px-2 py-1.5 border-b border-gray-900 cursor-pointer transition-colors hover:bg-gray-800 ${
                      isSelected ? 'bg-blue-950 border-l-2 border-l-blue-600' : ''
                    }`}
                    onMouseEnter={e => setTooltip({ cellType: cell.type, x: e.clientX, y: e.clientY })}
                    onMouseLeave={() => setTooltip(null)}
                  >
                    {/* Phase dot */}
                    <span className={`shrink-0 ${PHASE_COLOR[cell.phase] ?? 'text-gray-600'}`}>
                      {cell.phase === 'training' ? '○' :
                       cell.phase === 'ready'    ? '●' :
                       cell.phase === 'arrived'  ? '◉' : '·'}
                    </span>

                    {/* Name + status */}
                    <div className="flex-1 min-w-0">
                      <div className={`font-mono truncate ${isSelected ? 'text-blue-300' : 'text-gray-400'}`}>
                        {shortName(cell.type)}
                      </div>
                      <div className={`truncate ${PHASE_COLOR[cell.phase] ?? 'text-gray-700'}`}>
                        {statusLine}
                      </div>
                    </div>

                    {/* Action buttons */}
                    {canRecall(cell.phase) && (
                      <button
                        onClick={e => { e.stopPropagation(); onRecall(cell.id); }}
                        className="shrink-0 text-gray-700 hover:text-amber-500 px-0.5 transition-colors"
                        title="Recall"
                      >
                        ↩
                      </button>
                    )}
                    {canDecommission(cell.phase) && (
                      <button
                        onClick={e => { e.stopPropagation(); onDecommission(cell.id); }}
                        className="shrink-0 text-gray-800 hover:text-red-700 px-0.5 transition-colors"
                        title="Decommission (free tokens)"
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* Deploy hint */}
      {selectedCellId && deployedCells[selectedCellId]?.phase === 'ready' && (
        <div className="px-3 py-2 border-t border-blue-900 bg-blue-950 shrink-0 text-blue-400">
          Right-click a node to deploy
        </div>
      )}
    </div>
    </>
  );
}

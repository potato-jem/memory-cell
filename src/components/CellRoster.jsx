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
import CellIcon from './CellIcon.jsx';

const PHASE_LABEL = {
  training: 'TRAINING',
  ready:    'READY',
  outbound: 'ROUTING',
  arrived:  'ON SITE',
  returning:'RETURNING',
};

const PHASE_PILL = {
  training: 'bg-yellow-950 text-yellow-500 border border-yellow-800',
  ready:    'bg-green-950  text-green-400  border border-green-800',
  outbound: 'bg-blue-950   text-blue-400   border border-blue-800',
  arrived:  'bg-cyan-950   text-cyan-400   border border-cyan-800',
  returning:'bg-gray-900   text-gray-500   border border-gray-700',
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
  return [{ key: null, label: null, cells }];
}

// ── Training progress bar ─────────────────────────────────────────────────────

function TrainingBar({ cell, currentTick, isSelected }) {
  const baseTicks = CELL_CONFIG[cell.type]?.trainingTicks ?? 15;
  const remaining = Math.max(0, cell.trainingCompleteTick - currentTick);
  const elapsed = baseTicks - remaining;
  const pct = Math.max(0, Math.min(100, (elapsed / baseTicks) * 100));
  const turnsLeft = Math.max(1, Math.ceil(remaining / TICKS_PER_TURN));

  return (
    <div className="mt-0.5 space-y-0.5">
      <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-yellow-700 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className={`text-xs leading-none ${isSelected ? 'text-yellow-400' : 'text-yellow-700'}`}>
        {turnsLeft}T remaining
      </div>
    </div>
  );
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
      return `${turnsLeft(cell.trainingCompleteTick)}T`;
    }
    if (cell.phase === 'outbound') {
      const dest = cell.destNodeId ? (NODES[cell.destNodeId]?.label ?? cell.destNodeId) : '?';
      const eta = pathTurnsLeft(cell);
      const etaStr = eta != null ? ` ${eta}T` : '';
      return `→ ${dest}${etaStr}`;
    }
    if (cell.phase === 'arrived') {
      return NODES[cell.nodeId]?.label ?? cell.nodeId ?? 'on site';
    }
    if (cell.phase === 'returning') {
      const eta = pathTurnsLeft(cell);
      return eta != null ? `↩ ${eta}T` : '↩';
    }
    return PHASE_LABEL[cell.phase] ?? cell.phase;
  }

  const canRecall = phase => phase === 'outbound' || phase === 'arrived';
  const canDecommission = phase => phase === 'training' || phase === 'ready';

  const tooltipEntries = tooltip ? getClearanceEntries(tooltip.cellType) : [];

  return (
    <>
    {tooltip && (
      <div
        style={{ position: 'fixed', left: tooltip.x + 14, top: tooltip.y - 10, zIndex: 50 }}
        className="pointer-events-none bg-gray-900 border border-gray-600 rounded px-3 py-2 shadow-xl text-xs min-w-28"
      >
        <div className="text-gray-200 font-bold mb-1.5 flex items-center gap-2">
          <CellIcon
            type={tooltip.cellType}
            size={13}
            color={CELL_CONFIG[tooltip.cellType]?.color ?? '#888'}
          />
          {CELL_CONFIG[tooltip.cellType]?.displayName ?? tooltip.cellType}
        </div>
        {tooltipEntries.length > 0 ? (
          tooltipEntries.map(({ pathType, strength, color, label }) => (
            <div key={pathType} className="font-mono flex justify-between gap-3" style={{ color }}>
              <span>{label}</span>
              <span className="opacity-70">{strength}</span>
            </div>
          ))
        ) : (
          <div className="text-gray-600">Recon only</div>
        )}
      </div>
    )}
    <div className="flex flex-col h-full overflow-hidden">

      {/* Header: capacity */}
      <div className="px-3 py-3 border-b border-gray-800 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-gray-500 uppercase tracking-widest">Capacity</span>
          <span className={`text-sm font-mono font-bold ${tokensInUse >= tokenCapacity ? 'text-red-400' : 'text-cyan-400'}`}>
            {tokensInUse}<span className="text-gray-600 font-normal">/{tokenCapacity}</span>
          </span>
        </div>
        <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-cyan-700 transition-all duration-500 rounded-full"
            style={{ width: `${Math.min(100, (tokensInUse / Math.max(tokenCapacity, 1)) * 100)}%` }}
          />
        </div>
        {!atCap && (
          <div className="text-gray-700 mt-1.5 text-right text-xs">
            +1 cap in {turnsUntilRegen}T
          </div>
        )}
      </div>

      {/* Build section */}
      <div className="px-2 py-2.5 border-b border-gray-800 shrink-0">
        <div className="text-xs text-gray-600 uppercase tracking-widest mb-2 px-1">Build</div>
        <div className="space-y-0.5">
          {allTrainable.map(type => {
            const cfg = CELL_CONFIG[type];
            const cost = DEPLOY_COSTS[type] ?? 0;
            const time = cfg?.trainingTicks ?? 15;
            const canAfford = tokensAvailable >= cost;
            const iconColor = canAfford ? (cfg?.color ?? '#888') : '#374151';
            return (
              <button
                key={type}
                onClick={() => canAfford && onTrainCell(type)}
                disabled={!canAfford}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors ${
                  canAfford ? 'hover:bg-gray-800 text-gray-300' : 'text-gray-700 cursor-not-allowed'
                }`}
                onMouseEnter={e => setTooltip({ cellType: type, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setTooltip(null)}
              >
                <CellIcon type={type} size={13} color={iconColor} />
                <span className="flex-1 truncate text-xs">{shortName(type)}</span>
                <span className={`text-xs font-mono ${canAfford ? 'text-cyan-600' : 'text-gray-800'}`}>{cost}t</span>
                <span className="text-xs text-gray-800 font-mono">{time / TICKS_PER_TURN}T</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Units list */}
      <div className="flex-1 overflow-y-auto">

        {/* Units header + group toggle */}
        <div className="px-3 py-2 flex items-center justify-between border-b border-gray-800 sticky top-0 bg-gray-950">
          <span className="text-xs text-gray-600 uppercase tracking-widest">Units ({allCells.length})</span>
          <button
            onClick={cycleGroup}
            className="text-xs text-gray-700 hover:text-gray-500 transition-colors truncate max-w-20 text-right"
            title={`Grouping: ${GROUP_LABELS[groupBy]}`}
          >
            {GROUP_LABELS[groupBy]}
          </button>
        </div>

        {allCells.length === 0 ? (
          <div className="px-3 py-4 text-xs text-gray-700 italic">No units. Build some above.</div>
        ) : (
          groups.map(group => (
            <div key={group.key ?? '__all'}>
              {group.label && (
                <div className="px-3 py-1 text-xs text-gray-700 bg-gray-900 border-b border-gray-800 uppercase tracking-widest">
                  {group.label}
                </div>
              )}
              {group.cells.map(cell => {
                const isSelected = cell.id === selectedCellId;
                const statusLine = getStatusLine(cell);
                const cfg = CELL_CONFIG[cell.type];
                const iconColor = cfg?.color ?? '#888';

                return (
                  <div
                    key={cell.id}
                    onClick={() => onSelectCell(isSelected ? null : cell.id)}
                    className={`flex items-center gap-2 px-2 py-2 border-b border-gray-900 cursor-pointer transition-colors hover:bg-gray-800 ${
                      isSelected ? 'bg-blue-950 border-l-2 border-l-blue-500' : ''
                    }`}
                    onMouseEnter={e => setTooltip({ cellType: cell.type, x: e.clientX, y: e.clientY })}
                    onMouseLeave={() => setTooltip(null)}
                  >
                    {/* Cell icon */}
                    <div className="shrink-0">
                      <CellIcon
                        type={cell.type}
                        size={14}
                        color={isSelected ? '#93c5fd' : iconColor}
                      />
                    </div>

                    {/* Name + status */}
                    <div className="flex-1 min-w-0">
                      <div className={`text-xs font-mono truncate leading-tight ${isSelected ? 'text-blue-300' : 'text-gray-300'}`}>
                        {shortName(cell.type)}
                      </div>
                      {cell.phase === 'training' ? (
                        <TrainingBar
                          cell={cell}
                          currentTick={currentTick}
                          isSelected={isSelected}
                        />
                      ) : (
                        <div className="text-xs text-gray-600 truncate leading-tight mt-0.5">
                          {statusLine}
                        </div>
                      )}
                    </div>

                    {/* Phase pill */}
                    <div className="shrink-0 flex items-center gap-1">
                      <span className={`text-xs px-1 py-0.5 rounded leading-none ${PHASE_PILL[cell.phase] ?? 'text-gray-600'}`}
                        style={{ fontSize: '9px' }}>
                        {PHASE_LABEL[cell.phase] ?? cell.phase}
                      </span>
                    </div>

                    {/* Action buttons */}
                    {canRecall(cell.phase) && (
                      <button
                        onClick={e => { e.stopPropagation(); onRecall(cell.id); }}
                        className="shrink-0 text-gray-700 hover:text-amber-400 transition-colors text-sm leading-none px-0.5"
                        title="Recall"
                      >
                        ↩
                      </button>
                    )}
                    {canDecommission(cell.phase) && (
                      <button
                        onClick={e => { e.stopPropagation(); onDecommission(cell.id); }}
                        className="shrink-0 text-gray-800 hover:text-red-600 transition-colors text-sm leading-none px-0.5"
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
        <div className="px-3 py-2.5 border-t border-blue-800 bg-blue-950 shrink-0">
          <span className="text-xs text-blue-400">Right-click a node to deploy</span>
        </div>
      )}
    </div>
    </>
  );
}

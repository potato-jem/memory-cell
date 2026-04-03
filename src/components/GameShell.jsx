// GameShell — endless run layout.
// Header: turn, systemic stress, systemic integrity, fever, tokens.
// Left: Cell Roster. Centre: Body Map. Right: Node Detail / Overview.

import { useReducer, useCallback, useState } from 'react';
import { initGameState, GAME_PHASES } from '../state/gameState.js';
import { gameReducer, ACTION_TYPES } from '../state/actions.js';
import { DEFAULT_RUN_CONFIG } from '../data/runConfig.js';
import { WIN_PATHOGEN_TARGET } from '../data/gameConfig.js';
import { CELL_DISPLAY_NAMES, DEPLOY_COSTS } from '../engine/cells.js';
import { CELL_CONFIG, CELL_TYPE_ORDER } from '../data/cellConfig.js';
import { NODES, computeVisibility } from '../data/nodes.js';
import { PATHOGEN_DISPLAY_NAMES } from '../data/pathogens.js';
import BodyMap from './BodyMap.jsx';
import CellRoster from './CellRoster.jsx';
import NodeDetail from './NodeDetail.jsx';
import PostMortem from './PostMortem.jsx';
import ModifierChoice from './ModifierChoice.jsx';
import CellIcon from './CellIcon.jsx';


export default function GameShell() {
  const [started, setStarted] = useState(false);
  const [startingCounts, setStartingCounts] = useState(() =>
    Object.fromEntries(
      Object.entries(CELL_CONFIG)
        .filter(([, cfg]) => cfg.startingCount > 0)
        .map(([type, cfg]) => [type, cfg.startingCount])
    )
  );

  const [state, dispatch] = useReducer(
    gameReducer,
    null,
    () => initGameState(DEFAULT_RUN_CONFIG, null)
  );

  const handleStartRun = useCallback(() => {
    const startingUnits = Object.entries(startingCounts)
      .filter(([, count]) => count > 0)
      .map(([type, count]) => ({ type, count }));
    const cfg = { ...DEFAULT_RUN_CONFIG, startingUnits };
    dispatch({ type: ACTION_TYPES.RESTART, initialState: initGameState(cfg,) });
    setStarted(true);
  }, [startingCounts]);

  const handleRestart = useCallback(() => {
    setStarted(false);
  }, [state.postMortem]);

  const handleSelectNode = useCallback((nodeId) => {
    dispatch({ type: ACTION_TYPES.SELECT_NODE, nodeId });
  }, []);

  const handleRecall = useCallback((cellId) => {
    dispatch({ type: ACTION_TYPES.RECALL_UNIT, cellId });
  }, []);

  const [selectedCellId, setSelectedCellId] = useState(null);

  const handleTrainCell = useCallback((cellType) => {
    dispatch({ type: ACTION_TYPES.TRAIN_CELL, cellType });
  }, []);

  const handleDecommission = useCallback((cellId) => {
    dispatch({ type: ACTION_TYPES.DECOMMISSION_CELL, cellId });
  }, []);

  const handleSelectCell = useCallback((cellId) => {
    setSelectedCellId(cellId);
  }, []);

  const handleNodeContextMenu = useCallback((nodeId) => {
    if (!selectedCellId) return;
    dispatch({ type: ACTION_TYPES.DEPLOY_FROM_ROSTER, cellId: selectedCellId, nodeId });
    setSelectedCellId(null);
  }, [selectedCellId]);

  const handleEndTurn = useCallback(() => {
    dispatch({ type: ACTION_TYPES.END_TURN });
  }, []);

  const handleToggleFever = useCallback(() => {
    dispatch({ type: ACTION_TYPES.TOGGLE_FEVER });
  }, []);

  // ── Start screen ────────────────────────────────────────────────────────────
  if (!started) {
    const totalTokenCost = Object.entries(startingCounts).reduce(
      (sum, [type, count]) => sum + (DEPLOY_COSTS[type] ?? 0) * count, 0
    );
    const overBudget = totalTokenCost > 8;

    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-950 text-gray-300">
        <div className="w-full max-w-sm px-6 space-y-7">

          {/* Title */}
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-mono font-bold text-gray-100 tracking-widest uppercase">
              Memory Cell
            </h1>
            <p className="text-sm text-gray-600">
              You are the coordination intelligence of the immune system.
            </p>
            <p className="text-xs text-gray-700">
              Detect. Route. Contain. Survive.
            </p>
          </div>

          {/* Starting units */}
          <div className="border border-gray-800 rounded-lg bg-gray-900 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
              <span className="text-xs text-gray-500 uppercase tracking-widest">Starting Units</span>
              <span className={`text-sm font-mono font-bold ${overBudget ? 'text-yellow-400' : 'text-gray-500'}`}>
                {totalTokenCost}
                <span className="text-gray-700 font-normal text-xs"> tokens</span>
              </span>
            </div>
            <div className="divide-y divide-gray-800">
              {CELL_TYPE_ORDER.map(type => {
                const count = startingCounts[type] ?? 0;
                const cfg = CELL_CONFIG[type];
                const color = cfg?.textClass ?? 'text-gray-400';
                const iconColor = cfg?.color ?? '#9ca3af';
                const cost = DEPLOY_COSTS[type] ?? 1;
                return (
                  <div key={type} className="flex items-center gap-3 px-4 py-2.5">
                    <CellIcon type={type} size={15} color={iconColor} />
                    <span className={`text-sm font-mono flex-1 ${color}`}>
                      {CELL_DISPLAY_NAMES[type]}
                    </span>
                    <span className="text-xs text-gray-700 font-mono">{cost}t</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setStartingCounts(c => ({ ...c, [type]: Math.max(0, (c[type] ?? 0) - 1) }))}
                        className="w-6 h-6 flex items-center justify-center text-gray-600 hover:text-gray-300 border border-gray-700 hover:border-gray-500 font-mono text-sm transition-colors rounded"
                        disabled={count === 0}
                      >
                        −
                      </button>
                      <span className="w-5 text-center text-sm font-mono text-gray-200 tabular-nums">{count}</span>
                      <button
                        onClick={() => setStartingCounts(c => ({ ...c, [type]: (c[type] ?? 0) + 1 }))}
                        className="w-6 h-6 flex items-center justify-center text-gray-600 hover:text-gray-300 border border-gray-700 hover:border-gray-500 font-mono text-sm transition-colors rounded"
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {overBudget && (
              <div className="px-4 py-2 border-t border-yellow-900 bg-yellow-950 bg-opacity-30 text-xs text-yellow-600">
                High starting cost — you'll begin with limited token headroom.
              </div>
            )}
          </div>

          {/* Begin */}
          <button
            onClick={handleStartRun}
            className="w-full py-3.5 bg-green-900 hover:bg-green-800 text-green-200 font-mono font-bold uppercase tracking-widest border border-green-700 rounded-lg transition-colors text-sm cta-breathe"
          >
            Begin Run →
          </button>

        </div>
      </div>
    );
  }

  const isPlaying = state.phase === GAME_PHASES.PLAYING;
  const selectedNodeId = state.selectedNodeId;
  const stress = state.systemicStress ?? 0;
  const integrity = state.systemicIntegrity ?? 100;
  const visibleNodes = computeVisibility(state.deployedCells);

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-300 overflow-hidden">

      {/* ── Header ── */}
      <header className="flex items-center justify-between px-5 py-3 bg-gray-900 border-b border-gray-800 shrink-0 gap-4">

        {/* Left: title + turn */}
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs font-mono font-bold text-gray-500 uppercase tracking-widest hidden sm:block">
            Memory Cell
          </span>
          <span className="text-gray-800 hidden sm:block">|</span>
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-700 font-mono">T</span>
            <span className="text-lg font-mono font-bold text-gray-400 tabular-nums leading-none">
              {state.turn}
            </span>
          </div>
        </div>

        {/* Centre: systemic values */}
        <div className="flex items-center gap-6 shrink-0">

          {/* Systemic Stress */}
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-xs text-gray-700 uppercase tracking-widest leading-none">Stress</span>
            <StressGauge stress={stress} />
          </div>

          {/* Systemic Integrity */}
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-xs text-gray-700 uppercase tracking-widest leading-none">Integrity</span>
            <IntegrityBar integrity={integrity} />
          </div>

          {/* Fever toggle */}
          <button
            onClick={handleToggleFever}
            className={`px-2.5 py-1 text-xs font-mono border rounded transition-colors ${
              state.fever?.active
                ? 'bg-orange-950 border-orange-700 text-orange-300 hover:bg-orange-900'
                : 'bg-gray-900 border-gray-700 text-gray-600 hover:text-gray-400 hover:border-gray-600'
            }`}
            title={state.fever?.active ? 'Fever active — suppress to reduce stress' : 'Fever off — activate to boost immune response'}
          >
            {state.fever?.active ? '🌡 FEVER' : '🌡 fever'}
          </button>

          {/* Win progress */}
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-xs text-gray-700 uppercase tracking-widest leading-none">Encountered</span>
            <span className={`text-base font-mono font-bold tabular-nums leading-none ${state.totalPathogensSpawned >= WIN_PATHOGEN_TARGET ? 'text-green-400' : 'text-gray-400'}`}>
              {Math.min(state.totalPathogensSpawned, WIN_PATHOGEN_TARGET)}
              <span className="text-gray-700 text-xs font-normal">/{WIN_PATHOGEN_TARGET}</span>
            </span>
          </div>

          {/* Token pool */}
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-xs text-gray-700 uppercase tracking-widest leading-none">Tokens</span>
            <TokenPool used={state.tokensInUse} capacity={state.tokenCapacity} />
          </div>

        </div>

        {/* Right: menu + end turn */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleRestart}
            className="px-3 py-1.5 text-xs font-mono text-gray-700 hover:text-gray-400 border border-gray-800 hover:border-gray-700 rounded transition-colors"
          >
            ← Menu
          </button>
          {isPlaying && (
            <button
              onClick={handleEndTurn}
              className="px-5 py-2 bg-green-900 hover:bg-green-800 text-green-200 text-sm font-mono font-bold uppercase tracking-wider border border-green-700 rounded transition-colors cta-breathe"
            >
              End Turn →
            </button>
          )}
        </div>
      </header>

      {/* ── Main area ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Cell roster — left sidebar */}
        <div className="w-64 shrink-0 border-r border-gray-800 overflow-hidden">
          <CellRoster
            deployedCells={state.deployedCells}
            tokenCapacity={state.tokenCapacity}
            tokensInUse={state.tokensInUse}
            currentTick={state.tick}
            selectedCellId={selectedCellId}
            runConfig={state.runConfig}
            onTrainCell={handleTrainCell}
            onSelectCell={handleSelectCell}
            onDecommission={handleDecommission}
            onRecall={handleRecall}
          />
        </div>

        {/* Body map */}
        <div
          className="flex-1 min-w-0 overflow-hidden cursor-default"
          onClick={e => { if (e.target === e.currentTarget) handleSelectNode(null); }}
        >
          <BodyMap
            groundTruthNodeStates={state.groundTruth.nodeStates}
            deployedCells={state.deployedCells}
            selectedNodeId={selectedNodeId}
            onSelectNode={handleSelectNode}
            onNodeContextMenu={handleNodeContextMenu}
            visibleNodes={visibleNodes}
          />
        </div>

        {/* Right panel: node detail or overview */}
        {selectedNodeId ? (
          <div className="shrink-0 overflow-hidden flex flex-col border-l border-gray-800" style={{ width: 420 }}>
            <NodeDetail
              nodeId={selectedNodeId}
              groundTruthNodeState={state.groundTruth.nodeStates[selectedNodeId]}
              deployedCells={state.deployedCells}
              currentTurn={state.turn}
              onRecall={handleRecall}
              onClose={() => handleSelectNode(null)}
              visibleNodes={visibleNodes}
            />
          </div>
        ) : (
          <div className="shrink-0 border-l border-gray-800 overflow-y-auto" style={{ width: 300 }}>
            <OverviewPanel
              deployedCells={state.deployedCells}
              systemicStress={stress}
              systemicIntegrity={integrity}
              stressHistory={state.systemicStressHistory}
              fever={state.fever}
              scars={state.scars}
              groundTruthNodeStates={state.groundTruth.nodeStates}
              onSelectNode={handleSelectNode}
            />
          </div>
        )}
      </div>

      {/* Modifier choice overlay */}
      {state.phase === GAME_PHASES.PLAYING && (state.pendingModifierChoices?.length ?? 0) > 0 && (
        <ModifierChoice
          pendingModifierChoices={state.pendingModifierChoices}
          dispatch={dispatch}
        />
      )}

      {/* Post-mortem overlay */}
      {state.phase !== GAME_PHASES.PLAYING && state.postMortem && (
        <PostMortem
          postMortem={state.postMortem}
          phase={state.phase}
          onRestart={handleRestart}
        />
      )}
    </div>
  );
}

// ── Overview panel ─────────────────────────────────────────────────────────────

function OverviewPanel({
  deployedCells, systemicStress, systemicIntegrity,
  stressHistory, fever, scars, groundTruthNodeStates, onSelectNode,
}) {
  const ALERT_LEVELS = new Set(['threat', 'classified', 'misclassified']);

  const alertNodes = Object.entries(groundTruthNodeStates ?? {})
    .filter(([, ns]) => ns.pathogens?.some(i => ALERT_LEVELS.has(i.detected_level)))
    .map(([nodeId]) => nodeId);

  const warningNodes = Object.entries(groundTruthNodeStates ?? {})
    .filter(([, ns]) => {
      const hasAlert = ns.pathogens?.some(i => ALERT_LEVELS.has(i.detected_level));
      return !hasAlert && ns.pathogens?.some(i => i.detected_level === 'unknown');
    })
    .map(([nodeId]) => nodeId);

  const totalDeployed = Object.keys(deployedCells).length;

  return (
    <div className="flex flex-col h-full text-xs">
      <div className="px-4 py-3 border-b border-gray-800">
        <span className="text-xs text-gray-600 uppercase tracking-widest">Overview</span>
      </div>

      <div className="flex-1 overflow-y-auto">

        {/* Systemic values */}
        <section className="px-4 py-4 border-b border-gray-800 space-y-3">
          <div className="space-y-1.5">
            <div className="flex justify-between mb-1">
              <span className="text-gray-600 text-xs">Stress</span>
              <span className={`text-sm font-mono font-bold tabular-nums ${stressColor(systemicStress)}`}>
                {systemicStress}%
              </span>
            </div>
            <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 rounded-full ${stressBg(systemicStress)}`}
                style={{ width: `${systemicStress}%` }}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between mb-1">
              <span className="text-gray-600 text-xs">Integrity</span>
              <span className={`text-sm font-mono font-bold tabular-nums ${integrityColor(systemicIntegrity)}`}>
                {systemicIntegrity}%
              </span>
            </div>
            <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 rounded-full ${integrityBg(systemicIntegrity)}`}
                style={{ width: `${systemicIntegrity}%` }}
              />
            </div>
          </div>
          {fever?.active && (
            <div className="text-xs text-orange-500 bg-orange-950 bg-opacity-40 border border-orange-900 rounded px-2 py-1">
              🌡 Fever active — +stress/turn, +immune effectiveness
            </div>
          )}
        </section>

        {/* Alerts */}
        {alertNodes.length > 0 && (
          <section className="border-b border-gray-800">
            <div className="px-4 py-2 flex items-center gap-2">
              <span className="text-red-500 font-bold">!</span>
              <span className="text-red-500 uppercase tracking-widest text-xs font-bold">
                Alerts ({alertNodes.length})
              </span>
            </div>
            {alertNodes.map(nodeId => (
              <NodeSummaryRow
                key={nodeId}
                nodeId={nodeId}
                level="alert"
                onSelect={onSelectNode}
                pathogens={groundTruthNodeStates?.[nodeId]?.pathogens ?? []}
              />
            ))}
          </section>
        )}

        {/* Warnings */}
        {warningNodes.length > 0 && (
          <section className="border-b border-gray-800">
            <div className="px-4 py-2 flex items-center gap-2">
              <span className="text-yellow-600 font-bold">?</span>
              <span className="text-yellow-700 uppercase tracking-widest text-xs font-bold">
                Warnings ({warningNodes.length})
              </span>
            </div>
            {warningNodes.map(nodeId => (
              <NodeSummaryRow
                key={nodeId}
                nodeId={nodeId}
                level="warning"
                onSelect={onSelectNode}
                pathogens={groundTruthNodeStates?.[nodeId]?.pathogens ?? []}
              />
            ))}
          </section>
        )}

        {alertNodes.length === 0 && warningNodes.length === 0 && (
          <div className="px-4 py-4 text-xs text-gray-800 italic border-b border-gray-800">
            No active threats detected.
          </div>
        )}

        {/* Deployed cells */}
        <section className="border-b border-gray-800">
          <div className="px-4 py-2 text-xs text-gray-600 uppercase tracking-widest">
            Deployed ({totalDeployed})
          </div>
          {totalDeployed === 0 ? (
            <div className="px-4 pb-4 text-xs text-gray-800 italic">None.</div>
          ) : (
            <div className="px-4 pb-3 space-y-1">
              {Object.values(deployedCells).map(cell => {
                const nodeName = NODES[cell.nodeId]?.label ?? cell.nodeId;
                const cfg = CELL_CONFIG[cell.type];
                return (
                  <button
                    key={cell.id}
                    onClick={() => onSelectNode(cell.nodeId)}
                    className="w-full text-left flex items-center gap-2 py-0.5 hover:bg-gray-900 rounded px-1 transition-colors"
                  >
                    <CellIcon type={cell.type} size={11} color={cfg?.color ?? '#6b7280'} />
                    <span className={`text-xs font-mono truncate ${cfg?.textClass ?? 'text-gray-500'}`}>
                      {cfg?.displayName ?? cell.type}
                    </span>
                    <span className="text-gray-700 text-xs">→ {nodeName}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Scars */}
        {scars.length > 0 && (
          <section className="border-b border-gray-800">
            <div className="px-4 py-2 text-xs text-red-800 uppercase tracking-widest">
              Scars ({scars.length})
            </div>
            {scars.map(scar => (
              <div key={scar.id} className="px-4 py-1 text-xs text-red-900">{scar.description}</div>
            ))}
          </section>
        )}

      </div>
    </div>
  );
}

function NodeSummaryRow({ nodeId, pathogens, level, onSelect }) {
  const node = NODES[nodeId];
  if (!node) return null;
  const isAlert = level === 'alert';
  const topPathogen = pathogens
    .filter(i => i.detected_level !== 'none')
    .sort((a, b) => {
      const order = { classified: 4, misclassified: 3, threat: 2, unknown: 1 };
      return (order[b.detected_level] ?? 0) - (order[a.detected_level] ?? 0);
    })[0];
  const sublabel =
    topPathogen?.detected_level === 'classified' || topPathogen?.detected_level === 'misclassified'
      ? (PATHOGEN_DISPLAY_NAMES[topPathogen.perceived_type] ?? '?')
      : topPathogen?.detected_level === 'threat' ? 'Unknown threat'
      : 'Anomaly';

  return (
    <button
      onClick={() => onSelect(nodeId)}
      className={`w-full text-left flex items-center gap-2 px-4 py-2 transition-colors border-l-2 ${
        isAlert
          ? 'text-red-400 hover:bg-red-950 hover:bg-opacity-30 border-l-red-700'
          : 'text-yellow-600 hover:bg-yellow-950 hover:bg-opacity-20 border-l-yellow-800'
      }`}
    >
      <span className={`font-mono font-bold text-sm leading-none ${isAlert ? 'text-red-500' : 'text-yellow-600'}`}>
        {isAlert ? '!' : '?'}
      </span>
      <span className="text-xs font-mono font-bold flex-1">{node.label}</span>
      {topPathogen && (
        <span className="text-xs opacity-60 truncate max-w-20">{sublabel}</span>
      )}
    </button>
  );
}

// ── Header sub-components ──────────────────────────────────────────────────────

function StressGauge({ stress }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-2 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-500 rounded-full ${stressBg(stress)}`}
          style={{ width: `${stress}%` }}
        />
      </div>
      <span className={`text-base font-mono font-bold tabular-nums leading-none ${stressColor(stress)}`}>
        {stress}%
      </span>
    </div>
  );
}

function IntegrityBar({ integrity }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-2 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-500 rounded-full ${integrityBg(integrity)}`}
          style={{ width: `${integrity}%` }}
        />
      </div>
      <span className={`text-base font-mono font-bold tabular-nums leading-none ${integrityColor(integrity)}`}>
        {integrity}%
      </span>
    </div>
  );
}

function TokenPool({ used, capacity }) {
  const available = capacity - used;
  const color = available === 0 ? 'text-red-500' : available <= 3 ? 'text-yellow-400' : 'text-cyan-400';
  return (
    <div className="flex items-center gap-1">
      <span className={`text-base font-mono font-bold tabular-nums leading-none ${color}`}>{used}</span>
      <span className="text-gray-700 text-xs font-mono">/{capacity}</span>
    </div>
  );
}

function stressColor(s)    { return s >= 80 ? 'text-red-400'    : s >= 50 ? 'text-yellow-400' : 'text-green-400'; }
function stressBg(s)       { return s >= 80 ? 'bg-red-600'      : s >= 50 ? 'bg-yellow-600'   : 'bg-green-600'; }
function integrityColor(i) { return i > 60  ? 'text-green-400'  : i > 30  ? 'text-yellow-400' : 'text-red-400'; }
function integrityBg(i)    { return i > 60  ? 'bg-green-600'    : i > 30  ? 'bg-yellow-600'   : 'bg-red-600'; }

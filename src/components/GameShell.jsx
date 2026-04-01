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

  // ── Node selection ──────────────────────────────────────────────────────────
  const handleSelectNode = useCallback((nodeId) => {
    dispatch({ type: ACTION_TYPES.SELECT_NODE, nodeId });
  }, []);

  const handleRecall = useCallback((cellId) => {
    dispatch({ type: ACTION_TYPES.RECALL_UNIT, cellId });
  }, []);

  // ── Cell roster ─────────────────────────────────────────────────────────────
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
    const overBudget = totalTokenCost > 8; // soft cap — warn but don't block

    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-950 text-gray-300">
        <div className="w-full max-w-sm px-6 space-y-6">

          {/* Title */}
          <div className="text-center">
            <h1 className="text-2xl font-mono text-gray-200 tracking-widest uppercase mb-1">Memory Cell</h1>
            <p className="text-xs text-gray-600">Coordinate the immune system. Contain threats. Survive.</p>
          </div>

          {/* Starting units */}
          <div className="border border-gray-800 bg-gray-900">
            <div className="px-4 py-2 border-b border-gray-800 flex items-center justify-between">
              <span className="text-xs text-gray-500 uppercase tracking-wider">Starting Units</span>
              <span className={`text-xs font-mono ${overBudget ? 'text-yellow-500' : 'text-gray-600'}`}>
                {totalTokenCost} tokens
              </span>
            </div>
            <div className="divide-y divide-gray-800">
              {CELL_TYPE_ORDER.map(type => {
                const count = startingCounts[type] ?? 0;
                const color = CELL_CONFIG[type]?.textClass ?? 'text-gray-400';
                const cost = DEPLOY_COSTS[type] ?? 1;
                return (
                  <div key={type} className="flex items-center gap-3 px-4 py-2">
                    <span className={`text-xs font-mono flex-1 ${color}`}>
                      {CELL_DISPLAY_NAMES[type]}
                    </span>
                    <span className="text-xs text-gray-700">{cost}t ea</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setStartingCounts(c => ({ ...c, [type]: Math.max(0, (c[type] ?? 0) - 1) }))}
                        className="w-5 h-5 flex items-center justify-center text-gray-600 hover:text-gray-300 border border-gray-700 hover:border-gray-500 font-mono text-xs transition-colors"
                        disabled={count === 0}
                      >
                        −
                      </button>
                      <span className="w-4 text-center text-sm font-mono text-gray-300 tabular-nums">{count}</span>
                      <button
                        onClick={() => setStartingCounts(c => ({ ...c, [type]: (c[type] ?? 0) + 1 }))}
                        className="w-5 h-5 flex items-center justify-center text-gray-600 hover:text-gray-300 border border-gray-700 hover:border-gray-500 font-mono text-xs transition-colors"
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Begin */}
          <button
            onClick={handleStartRun}
            className="w-full py-3 bg-green-900 hover:bg-green-800 text-green-200 font-mono uppercase tracking-wider border border-green-700 transition-colors"
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
      <header className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800 shrink-0 gap-4">

        {/* Left: title + turn */}
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs font-mono text-gray-600 uppercase tracking-widest hidden sm:block">Memory Cell</span>
          <span className="text-xs text-gray-700 hidden sm:block">|</span>
          <span className="text-xs font-mono text-gray-600">T</span>
          <span className="text-sm font-mono text-gray-400">{state.turn}</span>
        </div>

        {/* Centre: systemic values */}
        <div className="flex items-center gap-5 shrink-0">

          {/* Systemic Stress */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600">Stress</span>
            <StressGauge stress={stress} />
          </div>

          {/* Systemic Integrity */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600">Integrity</span>
            <IntegrityBar integrity={integrity} />
          </div>

          {/* Fever toggle */}
          <button
            onClick={handleToggleFever}
            className={`px-2 py-0.5 text-xs font-mono border transition-colors ${
              state.fever?.active
                ? 'bg-orange-900 border-orange-600 text-orange-300 hover:bg-orange-800'
                : 'bg-gray-900 border-gray-700 text-gray-600 hover:text-gray-400'
            }`}
            title={state.fever?.active ? 'Fever active — suppresses to reduce stress' : 'Fever off — activate to boost immune response'}
          >
            {state.fever?.active ? '🌡 FEVER' : '🌡 fever'}
          </button>

          {/* Win progress */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600">Cleared</span>
            <span className={`text-sm font-mono tabular-nums ${state.totalPathogensSpawned >= WIN_PATHOGEN_TARGET ? 'text-green-400' : 'text-gray-400'}`}>
              {Math.min(state.totalPathogensSpawned, WIN_PATHOGEN_TARGET)}/{WIN_PATHOGEN_TARGET}
            </span>
          </div>

          {/* Token pool */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600">Tokens</span>
            <TokenPool used={state.tokensInUse} capacity={state.tokenCapacity} />
          </div>

        </div>

        {/* Right: menu + end turn */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleRestart}
            className="px-2 py-1 text-xs font-mono text-gray-700 hover:text-gray-400 border border-gray-800 transition-colors"
          >
            ← Menu
          </button>
          {isPlaying && (
            <button
              onClick={handleEndTurn}
              className="px-4 py-1.5 bg-green-900 hover:bg-green-800 text-green-200 text-xs font-mono uppercase tracking-wider border border-green-700 transition-colors"
            >
              End Turn →
            </button>
          )}
        </div>
      </header>

      {/* ── Main area ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Cell roster — left sidebar */}
        <div className="w-48 shrink-0 border-r border-gray-800 overflow-hidden">
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
          <div className="w-80 shrink-0 overflow-hidden flex flex-col border-l border-gray-800">
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
          <div className="w-64 shrink-0 border-l border-gray-800 overflow-y-auto">
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
      <div className="px-3 py-2 border-b border-gray-800">
        <span className="text-xs text-gray-600 uppercase tracking-wider">Overview</span>
      </div>

      <div className="flex-1 overflow-y-auto">

        {/* Systemic values */}
        <section className="px-3 py-3 border-b border-gray-800 space-y-2">
          <div>
            <div className="flex justify-between mb-0.5">
              <span className="text-gray-600">Stress</span>
              <span className={stressColor(systemicStress) + ' font-mono'}>{systemicStress}%</span>
            </div>
            <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div className={`h-full transition-all duration-500 ${stressBg(systemicStress)}`}
                style={{ width: `${systemicStress}%` }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between mb-0.5">
              <span className="text-gray-600">Integrity</span>
              <span className={integrityColor(systemicIntegrity) + ' font-mono'}>{systemicIntegrity}%</span>
            </div>
            <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div className={`h-full transition-all duration-500 ${integrityBg(systemicIntegrity)}`}
                style={{ width: `${systemicIntegrity}%` }} />
            </div>
          </div>
          {fever?.active && (
            <div className="text-orange-600 text-xs">🌡 Fever active — +stress/turn, +immune effectiveness</div>
          )}
        </section>

        {/* Alerts */}
        {alertNodes.length > 0 && (
          <section className="border-b border-gray-800">
            <div className="px-3 py-1.5 text-red-700 uppercase tracking-wider">Alerts ({alertNodes.length})</div>
            {alertNodes.map(nodeId => (
              <NodeSummaryRow key={nodeId} nodeId={nodeId} level="alert" onSelect={onSelectNode}
                pathogens={groundTruthNodeStates?.[nodeId]?.pathogens ?? []} />
            ))}
          </section>
        )}

        {/* Warnings */}
        {warningNodes.length > 0 && (
          <section className="border-b border-gray-800">
            <div className="px-3 py-1.5 text-yellow-800 uppercase tracking-wider">Warnings ({warningNodes.length})</div>
            {warningNodes.map(nodeId => (
              <NodeSummaryRow key={nodeId} nodeId={nodeId} level="warning" onSelect={onSelectNode}
                pathogens={groundTruthNodeStates?.[nodeId]?.pathogens ?? []} />
            ))}
          </section>
        )}

        {alertNodes.length === 0 && warningNodes.length === 0 && (
          <div className="px-3 py-3 text-gray-800 italic border-b border-gray-800">No active threats detected.</div>
        )}

        {/* Deployed cells */}
        <section className="border-b border-gray-800">
          <div className="px-3 py-1.5 text-gray-600 uppercase tracking-wider">Deployed ({totalDeployed})</div>
          {totalDeployed === 0 ? (
            <div className="px-3 pb-3 text-gray-800 italic">None.</div>
          ) : (
            <div className="px-3 pb-2 space-y-0.5">
              {Object.values(deployedCells).map(cell => {
                const nodeName = NODES[cell.nodeId]?.label ?? cell.nodeId;
                return (
                  <button key={cell.id} onClick={() => onSelectNode(cell.nodeId)}
                    className="w-full text-left flex items-center gap-2 py-0.5 hover:bg-gray-900">
                    <span className="text-gray-600 font-mono w-16 truncate">{cell.type}</span>
                    <span className="text-gray-700">→ {nodeName}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Scars */}
        {scars.length > 0 && (
          <section className="border-b border-gray-800">
            <div className="px-3 py-1.5 text-red-900 uppercase tracking-wider">Scars ({scars.length})</div>
            {scars.map(scar => (
              <div key={scar.id} className="px-3 py-0.5 text-red-900 text-xs">{scar.description}</div>
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
  const color = level === 'alert' ? 'text-red-500 hover:bg-red-950' : 'text-yellow-600 hover:bg-yellow-950';
  // Show label for the most-detected pathogen
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
    <button onClick={() => onSelect(nodeId)}
      className={`w-full text-left flex items-center gap-2 px-3 py-1.5 transition-colors ${color}`}>
      <span className="font-mono text-xs font-bold">{level === 'alert' ? '!' : '?'}</span>
      <span className="text-xs font-mono flex-1">{node.label}</span>
      {topPathogen && <span className="text-xs opacity-60 truncate max-w-20">{sublabel}</span>}
    </button>
  );
}

// ── Header sub-components ──────────────────────────────────────────────────────

function StressGauge({ stress }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-20 h-2 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full transition-all duration-500 ${stressBg(stress)}`} style={{ width: `${stress}%` }} />
      </div>
      <span className={`text-sm font-mono tabular-nums ${stressColor(stress)}`}>{stress}%</span>
    </div>
  );
}

function IntegrityBar({ integrity }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-20 h-2 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full transition-all duration-500 ${integrityBg(integrity)}`} style={{ width: `${integrity}%` }} />
      </div>
      <span className={`text-sm font-mono tabular-nums ${integrityColor(integrity)}`}>{integrity}%</span>
    </div>
  );
}

function TokenPool({ used, capacity }) {
  const available = capacity - used;
  const color = available === 0 ? 'text-red-500' : available <= 3 ? 'text-yellow-500' : 'text-cyan-400';
  return (
    <div className="flex items-center gap-1.5">
      <span className={`text-sm font-mono tabular-nums ${color}`}>{used}</span>
      <span className="text-gray-700 text-xs">/{capacity}</span>
    </div>
  );
}

function stressColor(s) { return s >= 80 ? 'text-red-400' : s >= 50 ? 'text-yellow-400' : 'text-green-400'; }
function stressBg(s)    { return s >= 80 ? 'bg-red-600'   : s >= 50 ? 'bg-yellow-600'   : 'bg-green-600'; }
function integrityColor(i) { return i > 60 ? 'text-green-400' : i > 30 ? 'text-yellow-400' : 'text-red-400'; }
function integrityBg(i)    { return i > 60 ? 'bg-green-600'   : i > 30 ? 'bg-yellow-600'   : 'bg-red-600'; }

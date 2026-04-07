// GameShell — endless run layout.
// Header: turn, systemic stress, systemic integrity, fever, tokens.
// Left: Cell Roster. Centre: Body Map. Right: Node Detail / Overview.

import { useReducer, useCallback, useState, useEffect } from 'react';
import { initGameState, GAME_PHASES } from '../state/gameState.js';
import { gameReducer, ACTION_TYPES } from '../state/actions.js';
import { DEFAULT_RUN_CONFIG } from '../data/runConfig.js';
import { WIN_PATHOGEN_TARGET } from '../data/gameConfig.js';
import { CELL_DISPLAY_NAMES, DEPLOY_COSTS } from '../engine/cells.js';
import { CELL_CONFIG, CELL_TYPE_ORDER } from '../data/cellConfig.js';
import { NODES, computeVisibility } from '../data/nodes.js';
import { PATHOGEN_DISPLAY_NAMES, getPrimaryLoad, PATHOGEN_RING_COLORS } from '../data/pathogens.js';
import BodyMap from './BodyMap.jsx';
import CellRoster from './CellRoster.jsx';
import NodeDetail from './NodeDetail.jsx';
import PostMortem from './PostMortem.jsx';
import ModifierChoice from './ModifierChoice.jsx';
import MobileRoster from './MobileRoster.jsx';
import CellIcon from './CellIcon.jsx';
import { saveRun, loadRun, clearRun } from '../state/persistence.js';


export default function GameShell() {
  const [started, setStarted] = useState(() => loadRun()?.phase === GAME_PHASES.PLAYING);
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
    () => loadRun() ?? initGameState(DEFAULT_RUN_CONFIG, null)
  );

  useEffect(() => {
    if (state.phase === GAME_PHASES.PLAYING) {
      saveRun(state);
    } else if (state.phase === GAME_PHASES.LOST || state.phase === GAME_PHASES.WON) {
      clearRun();
    }
  }, [state]);

  const handleStartRun = useCallback(() => {
    const startingUnits = Object.entries(startingCounts)
      .filter(([, count]) => count > 0)
      .map(([type, count]) => ({ type, count }));
    const cfg = { ...DEFAULT_RUN_CONFIG, startingUnits };
    dispatch({ type: ACTION_TYPES.RESTART, initialState: initGameState(cfg,) });
    setStarted(true);
  }, [startingCounts]);

  const [selectedCellId, setSelectedCellId] = useState(null);
  // openDrawer: which mobile drawer is open — 'roster' | 'overview' | 'node' | null
  const [openDrawer, setOpenDrawer] = useState(null);
  const [tooltipNode, setTooltipNode] = useState(null); // node shown in mini-tooltip / node drawer
  const [menuOpen, setMenuOpen] = useState(false);

  const handleRestart = useCallback(() => {
    clearRun();
    setStarted(false);
  }, [state.postMortem]);

  // Only one drawer at a time; toggle if same name
  const handleOpenDrawer = useCallback((name) => {
    setOpenDrawer(prev => prev === name ? null : name);
    setMenuOpen(false);
  }, []);

  const handleSelectNode = useCallback((nodeId) => {
    if (!nodeId) {
      // Tapping background: deselect
      setTooltipNode(null);
      setOpenDrawer(prev => prev === 'node' ? null : prev);
      dispatch({ type: ACTION_TYPES.SELECT_NODE, nodeId: null });
      return;
    }
    dispatch({ type: ACTION_TYPES.SELECT_NODE, nodeId });
    if (openDrawer === 'node') {
      // Drawer already open: switch to new node
      setTooltipNode(nodeId);
    } else if (nodeId === tooltipNode) {
      // Second tap on same node: open full node view
      setOpenDrawer('node');
    } else {
      // First tap on a node: show mini tooltip
      setTooltipNode(nodeId);
    }
  }, [tooltipNode, openDrawer]);

  const handleRecall = useCallback((cellId) => {
    dispatch({ type: ACTION_TYPES.RECALL_UNIT, cellId });
  }, []);

  const handleTrainCell = useCallback((cellType) => {
    dispatch({ type: ACTION_TYPES.TRAIN_CELL, cellType });
  }, []);

  const handleDecommission = useCallback((cellId) => {
    dispatch({ type: ACTION_TYPES.DECOMMISSION_CELL, cellId });
  }, []);

  const handleSelectCell = useCallback((cellId) => {
    setSelectedCellId(cellId);
  }, []);

  // Mobile: select a cell for deployment (from roster bar/drawer)
  const handleSelectCellForDeploy = useCallback((cellId) => {
    setSelectedCellId(cellId);
    setOpenDrawer(null); // close any open drawer so user can see the map
  }, []);

  // Deploy to a node — used by desktop right-click, NodeDetail button, MiniNodeTooltip
  const handleNodeContextMenu = useCallback((nodeId) => {
    if (!selectedCellId) return;
    dispatch({ type: ACTION_TYPES.DEPLOY_FROM_ROSTER, cellId: selectedCellId, nodeId });
    setSelectedCellId(null);
  }, [selectedCellId]);

  // Mobile deploy from tooltip or node drawer: also close the drawer
  const handleDeployToNode = useCallback((nodeId) => {
    if (!selectedCellId) return;
    dispatch({ type: ACTION_TYPES.DEPLOY_FROM_ROSTER, cellId: selectedCellId, nodeId });
    setSelectedCellId(null);
    setOpenDrawer(null);
  }, [selectedCellId]);

  // Direct deploy with explicit cellId — used by MobileRoster when a node is already selected
  const handleDeployDirect = useCallback((cellId, nodeId) => {
    dispatch({ type: ACTION_TYPES.DEPLOY_FROM_ROSTER, cellId, nodeId });
    setSelectedCellId(null);
    setOpenDrawer(null);
  }, []);

  const handleStartPatrol = useCallback((cellId) => {
    dispatch({ type: ACTION_TYPES.START_PATROL, cellId });
    setSelectedCellId(null);
    setOpenDrawer(null);
  }, []);

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
  const rosterOpen = openDrawer === 'roster';

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-300 overflow-hidden">

      {/* ── Header ── */}
      {/* Mobile: tapping anywhere (except buttons) opens the overview drawer */}
      <header
        className="relative flex items-center px-2 md:px-5 py-2 md:py-3 bg-gray-900 border-b border-gray-800 shrink-0 gap-2 md:gap-4 cursor-pointer md:cursor-default"
        onClick={() => handleOpenDrawer('overview')}
      >
        {/* Left: hamburger (always) + title + desktop turn (stops header click) */}
        <div className="flex items-center gap-2 md:gap-3 shrink-0 relative" onClick={e => e.stopPropagation()}>

          {/* Hamburger menu button */}
          <button
            onClick={() => setMenuOpen(m => !m)}
            className="w-9 h-9 flex flex-col items-center justify-center gap-1.5 rounded hover:bg-gray-800 active:bg-gray-700 transition-colors shrink-0"
            aria-label="Menu"
          >
            <span className="w-5 h-px bg-gray-500" />
            <span className="w-5 h-px bg-gray-500" />
            <span className="w-5 h-px bg-gray-500" />
          </button>

          {/* Hamburger dropdown */}
          {menuOpen && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl overflow-hidden min-w-48">
              <button
                onClick={() => { handleRestart(); setMenuOpen(false); }}
                className="w-full text-left px-4 py-3 text-sm font-mono text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-colors border-b border-gray-800"
              >
                ← Return to Menu
              </button>
              {/* Future menu items */}
            </div>
          )}

          {/* Desktop: title + turn */}
          <span className="text-xs font-mono font-bold text-gray-500 uppercase tracking-widest hidden md:block">
            Memory Cell
          </span>
          <span className="text-gray-800 hidden md:block">|</span>
          <div className="hidden md:flex items-center gap-1">
            <span className="text-xs text-gray-700 font-mono">T</span>
            <span className="text-lg font-mono font-bold text-gray-400 tabular-nums leading-none">{state.turn}</span>
          </div>
        </div>

        {/* Centre: mobile compact stats (clickable area — propagates to header) */}
        <div className="flex md:hidden items-center gap-1.5 flex-1 justify-center min-w-0">
          <span className={`text-xs font-mono font-bold tabular-nums ${stressColor(stress)}`}>{stress}%</span>
          <span className="text-gray-800 text-xs">·</span>
          <span className={`text-xs font-mono font-bold tabular-nums ${integrityColor(integrity)}`}>{integrity}%</span>
          <span className="text-gray-600 text-xs ml-1">↓</span>
        </div>

        {/* Desktop full stats */}
        <div className="hidden md:flex items-center gap-6 shrink-0 flex-1 justify-center" onClick={e => e.stopPropagation()}>
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-xs text-gray-700 uppercase tracking-widest leading-none">Stress</span>
            <StressGauge stress={stress} />
          </div>
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-xs text-gray-700 uppercase tracking-widest leading-none">Integrity</span>
            <IntegrityBar integrity={integrity} />
          </div>
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
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-xs text-gray-700 uppercase tracking-widest leading-none">Encountered</span>
            <span className={`text-base font-mono font-bold tabular-nums leading-none ${state.totalPathogensSpawned >= WIN_PATHOGEN_TARGET ? 'text-green-400' : 'text-gray-400'}`}>
              {Math.min(state.totalPathogensSpawned, WIN_PATHOGEN_TARGET)}
              <span className="text-gray-700 text-xs font-normal">/{WIN_PATHOGEN_TARGET}</span>
            </span>
          </div>
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-xs text-gray-700 uppercase tracking-widest leading-none">Tokens</span>
            <TokenPool used={state.tokensInUse} capacity={state.tokenCapacity} />
          </div>
        </div>

        {/* Right: turn counter (mobile) + end turn (desktop only — mobile moves to roster bar) */}
        <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
          {/* Turn — mobile only (desktop shows it on left) */}
          <div className="flex items-center gap-0.5 md:hidden">
            <span className="text-xs text-gray-700 font-mono">T</span>
            <span className="text-base font-mono font-bold text-gray-400 tabular-nums leading-none">{state.turn}</span>
          </div>
          {isPlaying && (
            <button
              onClick={handleEndTurn}
              className="hidden md:inline-flex px-5 py-2 bg-green-900 hover:bg-green-800 text-green-200 text-sm font-mono font-bold uppercase tracking-wider border border-green-700 rounded transition-colors cta-breathe"
            >
              End Turn →
            </button>
          )}
        </div>
      </header>

      {/* ── Main area ── */}
      <div className="flex flex-1 overflow-hidden min-h-0">

        {/* Desktop: cell roster left sidebar */}
        <div className="hidden md:flex border-r border-gray-800 overflow-hidden flex-col w-64 shrink-0">
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

        {/* Body map — full-width on mobile, relative for bottom overlay */}
        <div
          className="flex-1 min-w-0 overflow-hidden relative cursor-default"
          onClick={e => { if (e.target === e.currentTarget) handleSelectNode(null); }}
        >
          <BodyMap
            groundTruthNodeStates={state.groundTruth.nodeStates}
            deployedCells={state.deployedCells}
            selectedNodeId={tooltipNode}
            onSelectNode={handleSelectNode}
            onNodeContextMenu={handleNodeContextMenu}
            visibleNodes={visibleNodes}
          />

          {/* ── Mobile: bottom overlay (z-30 so it sits above overview z-20 but below drawers z-40) ── */}
          <div className="md:hidden absolute bottom-0 left-0 right-0 flex flex-col z-30" onClick={e => e.stopPropagation()}>
            {/* Node bar — hidden only when its own drawer or roster drawer is open */}
            {tooltipNode && openDrawer !== 'node' && openDrawer !== 'roster' && (
              <NodeBar
                nodeId={tooltipNode}
                gtNodeStates={state.groundTruth.nodeStates}
                visibleNodes={visibleNodes}
                deployedCells={state.deployedCells}
                selectedCellId={selectedCellId}
                onOpenFull={() => handleOpenDrawer('node')}
                onDeployDirect={handleDeployDirect}
                onPatrolDirect={handleStartPatrol}
                onSelectCell={handleSelectCell}
              />
            )}
            {/* Roster bar */}
            <MobileRoster
              deployedCells={state.deployedCells}
              tokenCapacity={state.tokenCapacity}
              tokensInUse={state.tokensInUse}
              runConfig={state.runConfig}
              isOpen={rosterOpen}
              isPlaying={isPlaying}
              onOpenRoster={() => handleOpenDrawer('roster')}
              onClose={() => setOpenDrawer(null)}
              onTrainCell={handleTrainCell}
              onSelectCellForDeploy={handleSelectCellForDeploy}
              onRecall={handleRecall}
              onDecommission={handleDecommission}
              onEndTurn={handleEndTurn}
              tooltipNode={tooltipNode}
              onStartPatrol={handleStartPatrol}
              onDeployDirect={handleDeployDirect}
              nodeBarSlot={tooltipNode ? (
                <NodeBar
                  nodeId={tooltipNode}
                  gtNodeStates={state.groundTruth.nodeStates}
                  visibleNodes={visibleNodes}
                  deployedCells={state.deployedCells}
                  selectedCellId={selectedCellId}
                  onOpenFull={() => handleOpenDrawer('node')}
                  onDeployDirect={handleDeployDirect}
                  onPatrolDirect={handleStartPatrol}
                  onSelectCell={handleSelectCell}
                />
              ) : null}
            />
          </div>
        </div>

        {/* Desktop: right panel (node detail or overview) */}
        {selectedNodeId ? (
          <div className="hidden md:flex overflow-hidden flex-col border-l border-gray-800 w-[420px] shrink-0">
            <NodeDetail
              nodeId={selectedNodeId}
              groundTruthNodeState={state.groundTruth.nodeStates[selectedNodeId]}
              deployedCells={state.deployedCells}
              currentTurn={state.turn}
              selectedCellId={selectedCellId}
              onRecall={handleRecall}
              onClose={() => handleSelectNode(null)}
              onDeployToNode={handleNodeContextMenu}
              onStartPatrol={handleStartPatrol}
              visibleNodes={visibleNodes}
            />
          </div>
        ) : (
          <div className="hidden md:block border-l border-gray-800 overflow-y-auto w-[300px] shrink-0">
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

      {/* ── Mobile drawer: node view (slides from bottom; roster bar visible below via bottom-[60px]) ── */}
      {openDrawer === 'node' && tooltipNode && (
        <div className="md:hidden fixed inset-x-0 top-0 bottom-[60px] z-40 flex flex-col justify-end">
          {/* Scrim */}
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpenDrawer(null)} />
          {/* Panel */}
          <div
            className="relative bg-gray-950 border-t border-gray-700 rounded-t-xl overflow-hidden flex flex-col"
            style={{ maxHeight: '90%' }}
          >
            <NodeBar
              nodeId={tooltipNode}
              gtNodeStates={state.groundTruth.nodeStates}
              visibleNodes={visibleNodes}
              deployedCells={state.deployedCells}
              selectedCellId={selectedCellId}
              onOpenFull={null}
              onDeployDirect={handleDeployDirect}
              onPatrolDirect={handleStartPatrol}
              onSelectCell={handleSelectCell}
              showCloseButton
              onClose={() => setOpenDrawer(null)}
            />
            <div className="flex-1 overflow-y-auto">
              <NodeDetail
                nodeId={tooltipNode}
                groundTruthNodeState={state.groundTruth.nodeStates[tooltipNode]}
                deployedCells={state.deployedCells}
                currentTurn={state.turn}
                selectedCellId={selectedCellId}
                onRecall={handleRecall}
                onClose={() => setOpenDrawer(null)}
                onDeployToNode={handleDeployToNode}
                onStartPatrol={handleStartPatrol}
                visibleNodes={visibleNodes}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Mobile drawer: overview (slides from top, z-20 so bottom bars z-30 stay tappable) ── */}
      {openDrawer === 'overview' && (
        <div className="md:hidden fixed inset-0 z-20 flex flex-col" onClick={() => setOpenDrawer(null)}>
          {/* Panel */}
          <div
            className="bg-gray-900 border-b border-gray-700 overflow-y-auto flex flex-col"
            style={{ maxHeight: '70vh' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Drawer header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono uppercase tracking-widest text-gray-400">Overview</span>
                <button
                  onClick={e => { e.stopPropagation(); handleToggleFever(); }}
                  className={`px-1.5 py-0.5 text-xs font-mono border rounded transition-colors ${
                    state.fever?.active
                      ? 'bg-orange-950 border-orange-700 text-orange-300'
                      : 'bg-gray-900 border-gray-700 text-gray-600'
                  }`}
                >
                  🌡 {state.fever?.active ? 'FEVER' : 'fever'}
                </button>
              </div>
              <button onClick={() => setOpenDrawer(null)} className="text-gray-500 hover:text-gray-300 text-lg leading-none px-1">↑</button>
            </div>
            <OverviewPanel
              deployedCells={state.deployedCells}
              systemicStress={stress}
              systemicIntegrity={integrity}
              stressHistory={state.systemicStressHistory}
              fever={state.fever}
              scars={state.scars}
              groundTruthNodeStates={state.groundTruth.nodeStates}
              onSelectNode={(nodeId) => { handleSelectNode(nodeId); setOpenDrawer(null); }}
            />
          </div>
          {/* Scrim below — tap to close */}
          <div className="flex-1" />
        </div>
      )}

      {/* Game overlays */}
      {state.phase === GAME_PHASES.PLAYING && (state.pendingModifierChoices?.length ?? 0) > 0 && (
        <ModifierChoice
          pendingModifierChoices={state.pendingModifierChoices}
          dispatch={dispatch}
        />
      )}
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

// ── Node bar (mobile) ─────────────────────────────────────────────────────────
// 3-line strip showing selected node info. Shown above roster bar, and at top
// of both drawers. Tap to open node drawer (if onOpenFull is set).

function NodeBar({ nodeId, gtNodeStates, visibleNodes, deployedCells, selectedCellId,
                   onOpenFull, onDeployDirect, onPatrolDirect, onSelectCell, showCloseButton, onClose }) {
  const node = NODES[nodeId];
  if (!node) return null;

  const gt = gtNodeStates?.[nodeId];
  const isVisible = visibleNodes?.has(nodeId) ?? false;
  const inflammation = isVisible ? (gt?.inflammation ?? 0) : (gt?.lastKnownInflammation ?? 0);
  const integrity = gt?.tissueIntegrity ?? 100;
  const pathogens = (gt?.pathogens ?? []).filter(p => p.detected_level !== 'none');
  const cellsHere = Object.values(deployedCells).filter(c => c.nodeId === nodeId && c.phase === 'arrived');
  const cellsEnRoute = Object.values(deployedCells).filter(c => c.destNodeId === nodeId && c.phase === 'outbound');

  const inflColor = inflammation > 70 ? 'text-red-400' : inflammation > 40 ? 'text-orange-400' : 'text-gray-500';
  const integColor = integrity < 40 ? 'text-red-400' : integrity < 70 ? 'text-yellow-400' : 'text-gray-400';

  const readyCell = selectedCellId ? deployedCells[selectedCellId] : null;
  const canDeploy = readyCell?.phase === 'ready';
  const canPatrol = canDeploy && CELL_CONFIG[readyCell?.type]?.isRecon;

  return (
    <div
      className={`bg-gray-900 border-t border-gray-700 ${onOpenFull ? 'cursor-pointer active:bg-gray-800' : ''}`}
      onClick={onOpenFull ?? undefined}
    >
      {/* Line 1: Node name + visibility + inflammation + integrity + close/expand */}
      <div className="flex items-center gap-1.5 px-3 pt-2 pb-0.5">
        <span className="text-sm font-mono font-bold text-gray-100 flex-1 truncate min-w-0">{node.label}</span>
        {node.isHQ && <span className="text-xs text-purple-500 font-mono shrink-0">HQ</span>}
        {!isVisible && <span className="text-xs text-gray-600 italic font-mono shrink-0">dark</span>}
        <span className={`text-xs font-mono tabular-nums shrink-0 ${inflColor}`}>{Math.round(inflammation)} infl</span>
        <span className={`text-xs font-mono tabular-nums shrink-0 ${integColor}`}>{Math.round(integrity)}%</span>
        {showCloseButton ? (
          <button
            onClick={e => { e.stopPropagation(); onClose?.(); }}
            className="text-gray-500 hover:text-gray-300 text-lg leading-none px-1 -mr-1 shrink-0"
          >↓</button>
        ) : onOpenFull ? (
          <span className="text-gray-600 text-xs shrink-0">▶</span>
        ) : null}
      </div>

      {/* Line 2: Pathogens with ring colors + load % */}
      <div className="flex items-center flex-wrap gap-x-2 gap-y-0 px-3 py-0.5 min-h-[1.25rem]">
        {pathogens.length === 0 ? (
          <span className="text-xs text-gray-700 font-mono italic">clear</span>
        ) : pathogens.map(p => {
          const lvl = p.detected_level;
          const isKnown = lvl === 'classified' || lvl === 'misclassified';
          const displayType = p.perceived_type ?? p.type;
          const label = isKnown
            ? (PATHOGEN_DISPLAY_NAMES[displayType] ?? '?')
            : lvl === 'threat' ? 'threat' : 'anomaly';
          const load = isKnown ? getPrimaryLoad(p, isVisible) : null;
          const ringColor = isKnown
            ? (PATHOGEN_RING_COLORS[displayType] ?? '#f43f5e')
            : lvl === 'threat' ? '#f97316' : '#6b7280';
          return (
            <span key={p.uid ?? p.type} className="text-xs font-mono flex items-center gap-1" style={{ color: ringColor }}>
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: ringColor }} />
              {label}{load != null ? ` ${Math.round(load)}%` : ''}
            </span>
          );
        })}
      </div>

      {/* Line 3: Cells present (tappable to select) on left, en-route on right + deploy */}
      <div className="flex items-center gap-2 px-3 pb-2 pt-0.5">
        {/* Present cells — tap to select for redeploy */}
        <div className="flex items-center gap-0.5 flex-1 min-w-0 flex-wrap">
          {cellsHere.length === 0 ? (
            <span className="text-xs text-gray-700 font-mono italic">no cells</span>
          ) : cellsHere.map(cell => {
            const cc = CELL_CONFIG[cell.type];
            const isSelected = cell.id === selectedCellId;
            return (
              <button
                key={cell.id}
                onClick={e => { e.stopPropagation(); onSelectCell?.(isSelected ? null : cell.id); }}
                className={`rounded p-0.5 transition-colors ${isSelected ? 'bg-blue-900 ring-1 ring-blue-500' : 'hover:bg-gray-800 active:bg-gray-700'}`}
                title={cc?.displayName ?? cell.type}
              >
                <CellIcon type={cell.type} size={14} color={isSelected ? '#93c5fd' : (cc?.color ?? '#6b7280')} />
              </button>
            );
          })}
        </div>
        {/* En-route cells */}
        {cellsEnRoute.length > 0 && (
          <div className="flex items-center gap-0.5 shrink-0 opacity-50">
            <span className="text-xs text-gray-600 font-mono">→</span>
            {cellsEnRoute.map(cell => (
              <CellIcon key={cell.id} type={cell.type} size={12} color={CELL_CONFIG[cell.type]?.color ?? '#6b7280'} />
            ))}
          </div>
        )}
        {/* Deploy / Patrol buttons */}
        {canDeploy && (
          <button
            onClick={e => { e.stopPropagation(); onDeployDirect(readyCell.id, nodeId); }}
            className="text-xs font-mono px-1.5 py-0.5 border border-green-700 bg-green-950 text-green-300 rounded hover:bg-green-900 active:bg-green-800 transition-colors shrink-0"
          >
            Deploy →
          </button>
        )}
        {canPatrol && (
          <button
            onClick={e => { e.stopPropagation(); onPatrolDirect?.(readyCell.id); }}
            className="text-xs font-mono px-1.5 py-0.5 border border-amber-700 bg-amber-950 text-amber-300 rounded hover:bg-amber-900 active:bg-amber-800 transition-colors shrink-0"
          >
            Patrol ↻
          </button>
        )}
      </div>
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

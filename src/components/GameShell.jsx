// GameShell — new layout: large body map + node detail panel on right.
// Header: system health, turn, tokens. No separate signal console.

import { useReducer, useCallback, useState, useEffect, useRef } from 'react';
import { initGameState, GAME_PHASES, TOTAL_TOKENS } from '../state/gameState.js';
import { TICK_RATE_MS } from '../data/gameConfig.js';
import { gameReducer, ACTION_TYPES } from '../state/actions.js';
import { initMemoryBank, getMemoryBankSummary } from '../engine/memory.js';
import { UNINVITED_GUEST } from '../data/situations/uninvitedGuest.js';
import { NODES } from '../data/nodes.js';
import BodyMap from './BodyMap.jsx';
import NodeDetail from './NodeDetail.jsx';
import PostMortem from './PostMortem.jsx';
import SituationSelector from './SituationSelector.jsx';

function makeInitialState(situationDef, memoryBank = null) {
  return initGameState(situationDef, memoryBank);
}

export default function GameShell() {
  const [sessionMemoryBank, setSessionMemoryBank] = useState(initMemoryBank());
  const [showSelector, setShowSelector] = useState(true);

  const [state, dispatch] = useReducer(
    gameReducer,
    null,
    () => initGameState(UNINVITED_GUEST, null)
  );

  // ── Situation selection ──────────────────────────────────────────────────
  const handleSelectSituation = useCallback((sitDef) => {
    dispatch({ type: ACTION_TYPES.RESTART, initialState: makeInitialState(sitDef, sessionMemoryBank) });
    setShowSelector(false);
  }, [sessionMemoryBank]);

  const handleSelectConcurrent = useCallback((primary, secondary) => {
    dispatch({ type: ACTION_TYPES.RESTART, initialState: initGameState([primary, secondary], sessionMemoryBank) });
    setShowSelector(false);
  }, [sessionMemoryBank]);

  const handleRestart = useCallback(() => {
    if (state.postMortem?.memoryBank) setSessionMemoryBank(state.postMortem.memoryBank);
    setShowSelector(true);
  }, [state.postMortem]);

  // ── Node selection ────────────────────────────────────────────────────────
  const handleSelectNode = useCallback((nodeId) => {
    dispatch({ type: ACTION_TYPES.SELECT_NODE, nodeId });
  }, []);

  // ── Signal decisions (free) ───────────────────────────────────────────────
  const handleDismissSignal = useCallback((signalId) => {
    dispatch({ type: ACTION_TYPES.DISMISS_SIGNAL, signalId });
  }, []);

  const handleHoldSignal = useCallback((signalId) => {
    dispatch({ type: ACTION_TYPES.HOLD_SIGNAL, signalId });
  }, []);

  const handleDismissEntity = useCallback((nodeId, entityId) => {
    dispatch({ type: ACTION_TYPES.DISMISS_ENTITY, nodeId, entityId });
  }, []);

  // ── Cell deployment (costs tokens) ───────────────────────────────────────
  const handleDeploy = useCallback((actionType, nodeId) => {
    dispatch({ type: ACTION_TYPES[actionType] ?? actionType, nodeId });
  }, []);

  const handleRecall = useCallback((cellId) => {
    dispatch({ type: ACTION_TYPES.RECALL_UNIT, cellId });
  }, []);

  const handlePause = useCallback(() => {
    dispatch({ type: ACTION_TYPES.PAUSE });
  }, []);

  const handleResume = useCallback(() => {
    dispatch({ type: ACTION_TYPES.RESUME });
  }, []);

  // ── Real-time game loop ────────────────────────────────────────────────────
  // Dispatches TICK every second. The reducer ignores ticks when paused/ended.
  useEffect(() => {
    const id = setInterval(() => {
      dispatch({ type: ACTION_TYPES.TICK });
    }, TICK_RATE_MS);
    return () => clearInterval(id);
  }, []);

  if (showSelector) {
    return (
      <SituationSelector
        memoryBank={sessionMemoryBank}
        onSelect={handleSelectSituation}
        onSelectConcurrent={handleSelectConcurrent}
      />
    );
  }

  const primarySit = state.situationStates[0];
  const isPlaying = state.phase === GAME_PHASES.PLAYING;
  const isConcurrent = state.situationStates.length > 1;
  const selectedNodeId = state.selectedNodeId;

  // Count pending signals across all nodes for header indicator
  const pendingCount = state.activeSignals.filter(s => !s.routed).length;

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-300 overflow-hidden">

      {/* ── Header ── */}
      <header className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800 shrink-0 gap-4">
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs font-mono text-gray-600 uppercase tracking-widest hidden sm:block">
            Memory Cell
          </span>
          <span className="text-xs text-gray-700 hidden sm:block">|</span>
          <span className="text-xs font-mono text-gray-400 truncate max-w-xs">
            {state.situationStates.map(s => s.situationDef.name).join(' + ')}
          </span>
          {isConcurrent && (
            <span className="text-xs font-mono text-yellow-700 border border-yellow-900 px-1 shrink-0">×2</span>
          )}
        </div>

        <div className="flex items-center gap-5 shrink-0">
          {/* Timer */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-600">T</span>
            <span className="text-sm font-mono text-gray-400">{state.turn}</span>
          </div>

          {/* System health */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600">Health</span>
            <HealthBar score={state.healthScore ?? state.coherenceScore} />
          </div>

          {/* Token pool */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600">Tokens</span>
            <TokenPool available={state.attentionTokens} total={TOTAL_TOKENS} />
          </div>

          {/* Pending signal count */}
          {pendingCount > 0 && (
            <div className="flex items-center gap-1">
              <span className="text-xs text-yellow-600 font-mono">{pendingCount}</span>
              <span className="text-xs text-yellow-800">pending</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowSelector(true)}
            className="px-2 py-1 text-xs font-mono text-gray-700 hover:text-gray-400 border border-gray-800 transition-colors"
          >
            ← Menu
          </button>
          {isPlaying && (
            state.paused ? (
              <button
                onClick={handleResume}
                className="px-4 py-1.5 bg-green-900 hover:bg-green-800 text-green-200 text-xs font-mono uppercase tracking-wider border border-green-700 transition-colors"
              >
                ▶ Resume
              </button>
            ) : (
              <button
                onClick={handlePause}
                className="px-4 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs font-mono uppercase tracking-wider border border-gray-700 transition-colors"
              >
                ‖ Pause
              </button>
            )
          )}
        </div>
      </header>

      {/* Concurrent tabs */}
      {isConcurrent && (
        <div className="flex border-b border-gray-800 bg-gray-900 px-4 shrink-0">
          {state.situationStates.map(sit => (
            <button
              key={sit.id}
              onClick={() => dispatch({ type: ACTION_TYPES.SELECT_SITUATION, situationId: sit.id })}
              className={`px-3 py-1.5 text-xs font-mono border-b-2 transition-colors ${
                state.activeSituationId === sit.id
                  ? 'border-blue-600 text-blue-400'
                  : 'border-transparent text-gray-600 hover:text-gray-400'
              } ${sit.isResolved ? 'line-through text-green-700' : ''}`}
            >
              {sit.situationDef.name}{sit.isResolved && ' ✓'}
            </button>
          ))}
        </div>
      )}

      {/* ── Main area ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Body map — main event */}
        <div
          className="flex-1 min-w-0 overflow-hidden cursor-default"
          onClick={e => { if (e.target === e.currentTarget) handleSelectNode(null); }}
        >
          <BodyMap
            perceivedState={primarySit.perceivedState}
            deployedCells={state.deployedCells}
            selectedNodeId={selectedNodeId}
            onSelectNode={handleSelectNode}
            activeSignals={state.activeSignals}
          />
        </div>

        {/* Node detail panel */}
        {selectedNodeId ? (
          <div className="w-80 shrink-0 overflow-hidden flex flex-col border-l border-gray-800">
            <NodeDetail
              nodeId={selectedNodeId}
              perceivedState={primarySit.perceivedState}
              deployedCells={state.deployedCells}
              activeSignals={state.activeSignals}
              attentionTokens={state.attentionTokens}
              currentTick={state.tick}
              onDismissSignal={handleDismissSignal}
              onHoldSignal={handleHoldSignal}
              onDeploy={handleDeploy}
              onRecall={handleRecall}
              onDismissEntity={handleDismissEntity}
              onClose={() => handleSelectNode(null)}
            />
          </div>
        ) : (
          /* No node selected — show overview sidebar */
          <div className="w-64 shrink-0 border-l border-gray-800 overflow-y-auto">
            <OverviewPanel
              situationStates={state.situationStates}
              activeSignals={state.activeSignals}
              deployedCells={state.deployedCells}
              healthScore={state.healthScore ?? state.coherenceScore}
              memoryBank={state.memoryBank}
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

// ── Overview panel (shown when no node selected) ──────────────────────────────

function OverviewPanel({ situationStates, activeSignals, deployedCells, healthScore, memoryBank, onSelectNode }) {

  // Nodes with pending signals grouped by urgency
  const nodeSignalMap = {};
  for (const sig of activeSignals.filter(s => !s.routed)) {
    if (!nodeSignalMap[sig.nodeId]) nodeSignalMap[sig.nodeId] = [];
    nodeSignalMap[sig.nodeId].push(sig);
  }

  const alertNodes = Object.entries(nodeSignalMap)
    .filter(([, sigs]) => sigs.some(s => s.confidence === 'high' || s.type === 'threat_expanding' || s.type === 'threat_confirmed'))
    .map(([nodeId]) => nodeId);

  const warningNodes = Object.entries(nodeSignalMap)
    .filter(([nodeId]) => !alertNodes.includes(nodeId))
    .map(([nodeId]) => nodeId);

  const totalDeployed = Object.keys(deployedCells).length;
  const memorySummary = memoryBank ? getMemoryBankSummary(memoryBank) : [];

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-gray-800">
        <span className="text-xs text-gray-600 uppercase tracking-wider">Overview</span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-0">
        {/* Health */}
        <section className="px-3 py-3 border-b border-gray-800">
          <div className="text-xs text-gray-600 mb-1">System Health</div>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2.5 bg-gray-800 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-700 ${
                  healthScore > 60 ? 'bg-green-600' : healthScore > 30 ? 'bg-yellow-600' : 'bg-red-600'
                }`}
                style={{ width: `${healthScore}%` }}
              />
            </div>
            <span className={`text-sm font-mono w-10 text-right ${
              healthScore > 60 ? 'text-green-400' : healthScore > 30 ? 'text-yellow-400' : 'text-red-400'
            }`}>{healthScore}%</span>
          </div>
          <div className="text-xs text-gray-700 mt-1">
            {healthScore > 70 && 'System nominal.'}
            {healthScore > 40 && healthScore <= 70 && 'Gaps present — investigate.'}
            {healthScore > 20 && healthScore <= 40 && 'Degrading. Act.'}
            {healthScore <= 20 && 'Critical.'}
          </div>
        </section>

        {/* Alert nodes */}
        {alertNodes.length > 0 && (
          <section className="border-b border-gray-800">
            <div className="px-3 py-2 text-xs text-red-700 uppercase tracking-wider">
              Alerts ({alertNodes.length})
            </div>
            {alertNodes.map(nodeId => (
              <NodeSummaryRow
                key={nodeId} nodeId={nodeId}
                signals={nodeSignalMap[nodeId]}
                level="alert"
                onSelect={onSelectNode}
              />
            ))}
          </section>
        )}

        {/* Warning nodes */}
        {warningNodes.length > 0 && (
          <section className="border-b border-gray-800">
            <div className="px-3 py-2 text-xs text-yellow-800 uppercase tracking-wider">
              Warnings ({warningNodes.length})
            </div>
            {warningNodes.map(nodeId => (
              <NodeSummaryRow
                key={nodeId} nodeId={nodeId}
                signals={nodeSignalMap[nodeId]}
                level="warning"
                onSelect={onSelectNode}
              />
            ))}
          </section>
        )}

        {alertNodes.length === 0 && warningNodes.length === 0 && (
          <div className="px-3 py-3 text-xs text-gray-800 italic border-b border-gray-800">
            No active signals.
          </div>
        )}

        {/* Deployed cells summary */}
        <section className="border-b border-gray-800">
          <div className="px-3 py-2 text-xs text-gray-600 uppercase tracking-wider">
            Deployed Cells ({totalDeployed})
          </div>
          {totalDeployed === 0 ? (
            <div className="px-3 pb-3 text-xs text-gray-800 italic">None deployed.</div>
          ) : (
            <div className="px-3 pb-2 space-y-0.5">
              {Object.values(deployedCells).map(cell => {
                const nodeName = NODES[cell.nodeId]?.label ?? cell.nodeId;
                return (
                  <button
                    key={cell.id}
                    onClick={() => onSelectNode(cell.nodeId)}
                    className="w-full text-left flex items-center gap-2 text-xs py-0.5 hover:bg-gray-900"
                  >
                    <span className="text-gray-600 font-mono w-16 truncate">{cell.type}</span>
                    <span className="text-gray-700">→ {nodeName}</span>
                    {cell.phase === 'outbound' && <span className="text-blue-900 ml-auto font-mono">→{cell.arrivalTick}s</span>}
                    {cell.phase === 'returning' && <span className="text-gray-700 ml-auto font-mono">↩</span>}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Concurrent situations */}
        {situationStates.length > 1 && (
          <section className="border-b border-gray-800">
            <div className="px-3 py-2 text-xs text-gray-600 uppercase tracking-wider">Situations</div>
            {situationStates.map(sit => (
              <div key={sit.id} className="flex items-center gap-2 px-3 py-1 text-xs">
                <div className={`w-1.5 h-1.5 rounded-full ${sit.isResolved ? 'bg-green-600' : 'bg-yellow-600'}`} />
                <span className={sit.isResolved ? 'text-green-700 line-through' : 'text-gray-500'}>
                  {sit.situationDef.name}
                </span>
              </div>
            ))}
          </section>
        )}

        {/* Memory bank */}
        {memorySummary.length > 0 && (
          <section>
            <div className="px-3 py-2 text-xs text-purple-800 uppercase tracking-wider">Memory</div>
            {memorySummary.map(mem => (
              <div key={mem.type} className="flex items-center gap-2 px-3 py-0.5 text-xs">
                <div className="w-1.5 h-1.5 rounded-full bg-purple-800" />
                <span className="text-purple-700 flex-1">{mem.displayName}</span>
                <span className="text-purple-900">{mem.strength}</span>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

function NodeSummaryRow({ nodeId, signals, level, onSelect }) {
  const node = NODES[nodeId];
  if (!node) return null;
  const color = level === 'alert' ? 'text-red-500 hover:bg-red-950' : 'text-yellow-600 hover:bg-yellow-950';

  return (
    <button
      onClick={() => onSelect(nodeId)}
      className={`w-full text-left flex items-center gap-2 px-3 py-1.5 transition-colors ${color}`}
    >
      <span className="font-mono text-xs font-bold">{level === 'alert' ? '!' : '?'}</span>
      <span className="text-xs font-mono flex-1">{node.label}</span>
      <span className="text-xs opacity-60">{signals.length}×</span>
    </button>
  );
}

// ── Header sub-components ──────────────────────────────────────────────────────

function TokenPool({ available, total }) {
  const pct = total > 0 ? (available / total) * 100 : 0;
  const color = available === 0 ? 'text-red-500' : available <= 3 ? 'text-yellow-500' : 'text-cyan-400';
  return (
    <div className="flex items-center gap-1.5">
      <span className={`text-sm font-mono tabular-nums ${color}`}>{available}</span>
      <span className="text-gray-700 text-xs">/{total}</span>
    </div>
  );
}

function HealthBar({ score }) {
  const color = score > 60 ? 'bg-green-500' : score > 30 ? 'bg-yellow-500' : 'bg-red-500';
  const textColor = score > 60 ? 'text-green-400' : score > 30 ? 'text-yellow-400' : 'text-red-400';
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-2 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full ${color} transition-all duration-500`} style={{ width: `${score}%` }} />
      </div>
      <span className={`text-sm font-mono ${textColor}`}>{score}%</span>
    </div>
  );
}

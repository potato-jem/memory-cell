// GameShell — top-level layout and state container.
// Layer 2: multi-situation support, new cell types, situation selector.

import { useReducer, useCallback, useState } from 'react';
import { initGameState, GAME_PHASES } from '../state/gameState.js';
import { gameReducer, ACTION_TYPES } from '../state/actions.js';
import { initMemoryBank } from '../engine/memory.js';
import { UNINVITED_GUEST } from '../data/situations/uninvitedGuest.js';
import BodyMap from './BodyMap.jsx';
import SignalConsole from './SignalConsole.jsx';
import WorkingModel from './WorkingModel.jsx';
import PostMortem from './PostMortem.jsx';
import SituationSelector from './SituationSelector.jsx';

// Start at situation selector rather than auto-loading
const SHOW_SELECTOR_FIRST = true;

function makeInitialState(situationDef, memoryBank = null) {
  return initGameState(situationDef, memoryBank);
}

export default function GameShell() {
  // Persistent memory bank across situations within a session
  const [sessionMemoryBank, setSessionMemoryBank] = useState(initMemoryBank());
  const [showSelector, setShowSelector] = useState(SHOW_SELECTOR_FIRST);

  const [state, dispatch] = useReducer(
    gameReducer,
    null,
    () => initGameState(UNINVITED_GUEST, sessionMemoryBank)
  );

  const handleSelectSituation = useCallback((sitDef) => {
    dispatch({
      type: ACTION_TYPES.RESTART,
      initialState: makeInitialState(sitDef, sessionMemoryBank),
    });
    setShowSelector(false);
  }, [sessionMemoryBank]);

  const handleSelectConcurrent = useCallback((primary, secondary) => {
    dispatch({
      type: ACTION_TYPES.RESTART,
      initialState: initGameState([primary, secondary], sessionMemoryBank),
    });
    setShowSelector(false);
  }, [sessionMemoryBank]);

  const handleRestart = useCallback(() => {
    // Carry forward memory bank from completed situation
    if (state.postMortem?.memoryBank) {
      setSessionMemoryBank(state.postMortem.memoryBank);
    }
    setShowSelector(true);
  }, [state.postMortem]);

  const handleSelectNode = useCallback((nodeId) => {
    dispatch({ type: ACTION_TYPES.SELECT_NODE, nodeId });
  }, []);

  const handleRouteSignal = useCallback((signalId, decision) => {
    dispatch({ type: ACTION_TYPES.ROUTE_SIGNAL, signalId, decision });
  }, []);

  const handleDeployDendritic = useCallback((nodeId) => {
    dispatch({ type: ACTION_TYPES.DEPLOY_DENDRITIC, nodeId });
  }, []);

  const handleDeployNeutrophil = useCallback((nodeId) => {
    dispatch({ type: ACTION_TYPES.DEPLOY_NEUTROPHIL, nodeId });
  }, []);

  const handleDeployResponder = useCallback((nodeId) => {
    dispatch({ type: ACTION_TYPES.DEPLOY_RESPONDER, nodeId });
  }, []);

  const handleDeployKillerT = useCallback((nodeId) => {
    dispatch({ type: ACTION_TYPES.DEPLOY_KILLER_T, nodeId });
  }, []);

  const handleDeployBCell = useCallback((nodeId) => {
    dispatch({ type: ACTION_TYPES.DEPLOY_B_CELL, nodeId });
  }, []);

  const handleDeployNKCell = useCallback((nodeId) => {
    dispatch({ type: ACTION_TYPES.DEPLOY_NK_CELL, nodeId });
  }, []);

  const handleDeployMacrophage = useCallback((nodeId) => {
    dispatch({ type: ACTION_TYPES.DEPLOY_MACROPHAGE, nodeId });
  }, []);

  const handleRecallUnit = useCallback((cellId) => {
    dispatch({ type: ACTION_TYPES.RECALL_UNIT, cellId });
  }, []);

  const handleEndTurn = useCallback(() => {
    dispatch({ type: ACTION_TYPES.END_TURN });
  }, []);

  // Situation selector
  if (showSelector) {
    return (
      <SituationSelector
        memoryBank={sessionMemoryBank}
        onSelect={handleSelectSituation}
        onSelectConcurrent={handleSelectConcurrent}
      />
    );
  }

  // Get primary situation for display
  const primarySit = state.situationStates[0];
  const isPlaying = state.phase === GAME_PHASES.PLAYING;
  const isConcurrent = state.situationStates.length > 1;

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-300 overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-4">
          <span className="text-xs font-mono text-gray-500 uppercase tracking-widest">Memory Cell</span>
          <span className="text-xs text-gray-600">|</span>
          <span className="text-xs font-mono text-gray-400">
            {state.situationStates.map(s => s.situationDef.name).join(' + ')}
          </span>
          {isConcurrent && (
            <span className="text-xs font-mono text-yellow-700 border border-yellow-900 px-1">CONCURRENT</span>
          )}
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600 uppercase tracking-wider">Turn</span>
            <span className="text-sm font-mono text-gray-200">{state.turn}</span>
            <span className="text-gray-700">/</span>
            <span className="text-sm font-mono text-gray-500">
              {Math.min(...state.situationStates.map(s => s.situationDef.turnLimit))}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600 uppercase tracking-wider">Tokens</span>
            <TokenDisplay current={state.attentionTokens} max={5} />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600 uppercase tracking-wider">Coherence</span>
            <CoherenceDisplay score={state.coherenceScore} />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSelector(true)}
            className="px-2 py-1 text-xs font-mono text-gray-700 hover:text-gray-500 border border-gray-800 transition-colors"
          >
            ← Menu
          </button>
          {isPlaying && (
            <button
              onClick={handleEndTurn}
              className="px-4 py-1.5 bg-blue-900 hover:bg-blue-800 text-blue-200 text-xs font-mono uppercase tracking-wider border border-blue-700 transition-colors"
            >
              End Turn →
            </button>
          )}
        </div>
      </header>

      {/* Concurrent situation tabs */}
      {isConcurrent && (
        <div className="flex border-b border-gray-800 bg-gray-900 px-4">
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
              {sit.situationDef.name}
              {sit.isResolved && ' ✓'}
            </button>
          ))}
        </div>
      )}

      {/* Three-panel layout */}
      <div className="flex flex-1 overflow-hidden">
        <div className="w-56 shrink-0 border-r border-gray-800 overflow-y-auto">
          <BodyMap
            perceivedState={primarySit.perceivedState}
            deployedCells={state.deployedCells}
            selectedNodeId={state.selectedNodeId}
            onSelectNode={handleSelectNode}
            onDeployDendritic={handleDeployDendritic}
            onDeployNeutrophil={handleDeployNeutrophil}
            onDeployResponder={handleDeployResponder}
            onDeployKillerT={handleDeployKillerT}
            onDeployBCell={handleDeployBCell}
            onDeployNKCell={handleDeployNKCell}
            onDeployMacrophage={handleDeployMacrophage}
            attentionTokens={state.attentionTokens}
          />
        </div>

        <div className="flex-1 min-w-0 border-r border-gray-800 overflow-hidden flex flex-col">
          <SignalConsole
            activeSignals={state.activeSignals}
            signalHistory={state.signalHistory}
            silenceNotices={state.silenceNotices}
            attentionTokens={state.attentionTokens}
            onRouteSignal={handleRouteSignal}
            onEndTurn={handleEndTurn}
            isPlaying={isPlaying}
            isConcurrent={isConcurrent}
          />
        </div>

        <div className="w-64 shrink-0 overflow-y-auto">
          <WorkingModel
            perceivedState={primarySit.perceivedState}
            deployedCells={state.deployedCells}
            coherenceScore={state.coherenceScore}
            selectedNodeId={state.selectedNodeId}
            onSelectNode={handleSelectNode}
            onRecallUnit={handleRecallUnit}
            memoryBank={state.memoryBank}
            situationStates={state.situationStates}
          />
        </div>
      </div>

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

function TokenDisplay({ current, max }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <div key={i} className={`w-2.5 h-2.5 rounded-sm ${i < current ? 'bg-cyan-500' : 'bg-gray-700'}`} />
      ))}
    </div>
  );
}

function CoherenceDisplay({ score }) {
  const color = score > 60 ? 'text-green-400' : score > 30 ? 'text-yellow-400' : 'text-red-400';
  const barColor = score > 60 ? 'bg-green-500' : score > 30 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full ${barColor} transition-all duration-500`} style={{ width: `${score}%` }} />
      </div>
      <span className={`text-sm font-mono ${color}`}>{score}%</span>
    </div>
  );
}

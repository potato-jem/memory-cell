// GameShell — top-level layout and state container.
// Three-panel: BodyMap | SignalConsole | WorkingModel.
// Holds useReducer, passes state + dispatch to panels.

import { useReducer, useCallback } from 'react';
import { initGameState } from '../state/gameState.js';
import { gameReducer, ACTION_TYPES } from '../state/actions.js';
import { UNINVITED_GUEST } from '../data/situations/uninvitedGuest.js';
import BodyMap from './BodyMap.jsx';
import SignalConsole from './SignalConsole.jsx';
import WorkingModel from './WorkingModel.jsx';
import PostMortem from './PostMortem.jsx';
import { GAME_PHASES } from '../state/gameState.js';

const INITIAL_STATE = initGameState(UNINVITED_GUEST);

export default function GameShell() {
  const [state, dispatch] = useReducer(gameReducer, INITIAL_STATE);

  const handleRestart = useCallback(() => {
    dispatch({ type: ACTION_TYPES.RESTART, initialState: initGameState(UNINVITED_GUEST) });
  }, []);

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

  const handleRecallUnit = useCallback((cellId) => {
    dispatch({ type: ACTION_TYPES.RECALL_UNIT, cellId });
  }, []);

  const handleEndTurn = useCallback(() => {
    dispatch({ type: ACTION_TYPES.END_TURN });
  }, []);

  const isPlaying = state.phase === GAME_PHASES.PLAYING;

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-300 overflow-hidden">
      {/* Header bar */}
      <header className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-4">
          <span className="text-xs font-mono text-gray-500 uppercase tracking-widest">Memory Cell</span>
          <span className="text-xs text-gray-600">|</span>
          <span className="text-xs font-mono text-gray-400">
            {state.situationDef.name}
          </span>
        </div>

        <div className="flex items-center gap-6">
          {/* Turn counter */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600 uppercase tracking-wider">Turn</span>
            <span className="text-sm font-mono text-gray-200">{state.turn}</span>
            <span className="text-gray-700">/</span>
            <span className="text-sm font-mono text-gray-500">{state.situationDef.turnLimit}</span>
          </div>

          {/* Attention tokens */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600 uppercase tracking-wider">Tokens</span>
            <TokenDisplay current={state.attentionTokens} max={5} />
          </div>

          {/* Coherence */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600 uppercase tracking-wider">Coherence</span>
            <CoherenceDisplay score={state.coherenceScore} />
          </div>
        </div>

        {/* End Turn */}
        {isPlaying && (
          <button
            onClick={handleEndTurn}
            className="px-4 py-1.5 bg-blue-900 hover:bg-blue-800 text-blue-200 text-xs font-mono uppercase tracking-wider border border-blue-700 transition-colors"
          >
            End Turn →
          </button>
        )}
      </header>

      {/* Main three-panel layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel: Body Map */}
        <div className="w-56 shrink-0 border-r border-gray-800 overflow-y-auto">
          <BodyMap
            perceivedState={state.perceivedState}
            deployedCells={state.deployedCells}
            selectedNodeId={state.selectedNodeId}
            onSelectNode={handleSelectNode}
            onDeployDendritic={handleDeployDendritic}
            onDeployNeutrophil={handleDeployNeutrophil}
            onDeployResponder={handleDeployResponder}
            attentionTokens={state.attentionTokens}
          />
        </div>

        {/* Centre panel: Signal Console */}
        <div className="flex-1 min-w-0 border-r border-gray-800 overflow-hidden flex flex-col">
          <SignalConsole
            activeSignals={state.activeSignals}
            signalHistory={state.signalHistory}
            silenceNotices={state.silenceNotices}
            attentionTokens={state.attentionTokens}
            onRouteSignal={handleRouteSignal}
            onEndTurn={handleEndTurn}
            isPlaying={isPlaying}
          />
        </div>

        {/* Right panel: Working Model */}
        <div className="w-64 shrink-0 overflow-y-auto">
          <WorkingModel
            perceivedState={state.perceivedState}
            deployedCells={state.deployedCells}
            coherenceScore={state.coherenceScore}
            selectedNodeId={state.selectedNodeId}
            onSelectNode={handleSelectNode}
            onRecallUnit={handleRecallUnit}
            attentionTokens={state.attentionTokens}
          />
        </div>
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

function TokenDisplay({ current, max }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <div
          key={i}
          className={`w-2.5 h-2.5 rounded-sm ${
            i < current ? 'bg-cyan-500' : 'bg-gray-700'
          }`}
        />
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
        <div
          className={`h-full ${barColor} transition-all duration-500`}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className={`text-sm font-mono ${color}`}>{score}%</span>
    </div>
  );
}

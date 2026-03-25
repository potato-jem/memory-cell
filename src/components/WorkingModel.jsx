// WorkingModel — the player's current picture of the body.
// Right panel: node threat assessments, deployed cells, coherence breakdown.

import { NODES } from '../data/nodes.js';
import { NODE_STATUSES } from '../state/perceivedState.js';

const STATUS_CONFIG = {
  [NODE_STATUSES.CLEAN]: { label: 'Clear', color: 'text-gray-600', dot: 'bg-gray-700' },
  [NODE_STATUSES.WATCHING]: { label: 'Watching', color: 'text-yellow-700', dot: 'bg-yellow-700' },
  [NODE_STATUSES.INVESTIGATING]: { label: 'Scouting', color: 'text-blue-500', dot: 'bg-blue-600' },
  [NODE_STATUSES.SUSPECTED]: { label: 'Suspected', color: 'text-orange-500', dot: 'bg-orange-600' },
  [NODE_STATUSES.CONFIRMED]: { label: 'Confirmed', color: 'text-red-400', dot: 'bg-red-600' },
  [NODE_STATUSES.RESPONDING]: { label: 'Responding', color: 'text-red-300', dot: 'bg-red-700' },
  [NODE_STATUSES.RESOLVED]: { label: 'Resolved', color: 'text-green-500', dot: 'bg-green-600' },
};

const CELL_TYPE_LABELS = {
  dendritic: { label: 'Scout (DC)', color: 'text-purple-400' },
  neutrophil: { label: 'Patrol (NΦ)', color: 'text-blue-400' },
  responder: { label: 'Responder', color: 'text-red-400' },
};

export default function WorkingModel({
  perceivedState,
  deployedCells,
  coherenceScore,
  selectedNodeId,
  onSelectNode,
  onRecallUnit,
  attentionTokens,
}) {
  const nodeList = Object.values(NODES);

  // Active nodes: those with any non-clean status
  const activeNodes = nodeList.filter(node => {
    const psNode = perceivedState.nodes[node.id];
    return psNode && psNode.status !== NODE_STATUSES.CLEAN;
  });

  // Clean nodes
  const cleanNodes = nodeList.filter(node => {
    const psNode = perceivedState.nodes[node.id];
    return !psNode || psNode.status === NODE_STATUSES.CLEAN;
  });

  const deployedList = Object.values(deployedCells);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-800 shrink-0">
        <span className="text-xs text-gray-600 uppercase tracking-wider">Working Model</span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-0">
        {/* Coherence section */}
        <section className="px-3 py-3 border-b border-gray-800">
          <div className="text-xs text-gray-600 uppercase tracking-wider mb-2">Coherence</div>
          <CoherenceBar score={coherenceScore} />
          <div className="mt-1 text-xs text-gray-600">
            {coherenceScore > 70 && 'System operating normally.'}
            {coherenceScore > 40 && coherenceScore <= 70 && 'Gaps detected. Investigate.'}
            {coherenceScore > 15 && coherenceScore <= 40 && 'Coherence degrading. Act fast.'}
            {coherenceScore <= 15 && 'Critical. System near collapse.'}
          </div>
        </section>

        {/* Active nodes */}
        {activeNodes.length > 0 && (
          <section className="border-b border-gray-800">
            <div className="px-3 py-2 text-xs text-gray-600 uppercase tracking-wider">
              Active Nodes ({activeNodes.length})
            </div>
            <div className="space-y-px">
              {activeNodes.map(node => (
                <NodeRow
                  key={node.id}
                  node={node}
                  psNode={perceivedState.nodes[node.id]}
                  isSelected={node.id === selectedNodeId}
                  onSelect={() => onSelectNode(node.id === selectedNodeId ? null : node.id)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Clean nodes (collapsed) */}
        <section className="border-b border-gray-800">
          <div className="px-3 py-2 text-xs text-gray-700 uppercase tracking-wider">
            Clear Nodes ({cleanNodes.length})
          </div>
          <div className="px-3 pb-2 flex flex-wrap gap-1">
            {cleanNodes.map(node => (
              <button
                key={node.id}
                onClick={() => onSelectNode(node.id === selectedNodeId ? null : node.id)}
                className={`text-xs font-mono px-1.5 py-0.5 border border-gray-800 text-gray-700 hover:text-gray-500 transition-colors ${
                  node.id === selectedNodeId ? 'border-blue-800 text-blue-700' : ''
                }`}
              >
                {node.label}
              </button>
            ))}
          </div>
        </section>

        {/* Deployed cells */}
        <section>
          <div className="px-3 py-2 text-xs text-gray-600 uppercase tracking-wider">
            Deployed Cells ({deployedList.length})
          </div>

          {deployedList.length === 0 && (
            <div className="px-3 pb-3 text-xs text-gray-800 italic">
              No cells deployed.
            </div>
          )}

          <div className="space-y-px pb-3">
            {deployedList.map(cell => (
              <CellRow
                key={cell.id}
                cell={cell}
                onRecall={() => onRecallUnit(cell.id)}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function NodeRow({ node, psNode, isSelected, onSelect }) {
  const status = psNode?.status ?? NODE_STATUSES.CLEAN;
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG[NODE_STATUSES.CLEAN];
  const signalCount = psNode?.signalsReceived?.length ?? 0;

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left flex items-center gap-2 px-3 py-1.5 hover:bg-gray-900 transition-colors ${
        isSelected ? 'bg-gray-900 border-l-2 border-blue-700' : 'border-l-2 border-transparent'
      }`}
    >
      <div className={`w-2 h-2 rounded-full shrink-0 ${config.dot}`} />
      <span className={`text-xs font-mono ${config.color} flex-1`}>
        {node.label}
        {node.isHQ && <span className="text-purple-700 ml-1">[HQ]</span>}
      </span>
      <span className={`text-xs font-mono ${config.color}`}>{config.label}</span>
      {signalCount > 0 && (
        <span className="text-xs text-gray-700">{signalCount}s</span>
      )}
      {psNode?.scoutConfirmed && (
        <span className="text-xs text-purple-600">✓DC</span>
      )}
    </button>
  );
}

function CellRow({ cell, onRecall }) {
  const typeConfig = CELL_TYPE_LABELS[cell.type] ?? { label: cell.type, color: 'text-gray-500' };
  const nodeName = NODES[cell.nodeId]?.label ?? cell.nodeId;

  return (
    <div className="flex items-center gap-2 px-3 py-1 hover:bg-gray-900">
      <span className={`text-xs font-mono ${typeConfig.color} flex-1`}>
        {typeConfig.label}
      </span>
      <span className="text-xs text-gray-600">→ {nodeName}</span>
      {cell.inTransit && (
        <span className="text-xs text-blue-800">
          T{cell.returnsOnTurn}
        </span>
      )}
      {cell.type === 'responder' && !cell.hasDendriticBacking && (
        <span className="text-xs text-yellow-800" title="No scout confirmation">!</span>
      )}
      <button
        onClick={onRecall}
        className="text-xs text-gray-800 hover:text-gray-500 font-mono transition-colors ml-1"
        title="Recall"
      >
        ✕
      </button>
    </div>
  );
}

function CoherenceBar({ score }) {
  const color = score > 60 ? 'bg-green-600' : score > 30 ? 'bg-yellow-600' : 'bg-red-600';
  const textColor = score > 60 ? 'text-green-400' : score > 30 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} transition-all duration-700`}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className={`text-sm font-mono ${textColor} w-10 text-right`}>{score}%</span>
    </div>
  );
}

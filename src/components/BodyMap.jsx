// BodyMap — SVG rendering of the lymphatic network.
// Layer 2: new cell type indicators and deployment options.

import { NODES } from '../data/nodes.js';
import { NODE_STATUSES } from '../state/perceivedState.js';
import { DEPLOY_COSTS } from '../engine/cells.js';

const SVG_WIDTH = 200;
const SVG_HEIGHT = 380;

const STATUS_STYLES = {
  [NODE_STATUSES.CLEAN]: { fill: '#1e293b', stroke: '#334155', label: '#64748b' },
  [NODE_STATUSES.WATCHING]: { fill: '#1e293b', stroke: '#854d0e', label: '#a16207' },
  [NODE_STATUSES.INVESTIGATING]: { fill: '#1e3a5f', stroke: '#1d4ed8', label: '#60a5fa' },
  [NODE_STATUSES.SUSPECTED]: { fill: '#422006', stroke: '#c2410c', label: '#fb923c' },
  [NODE_STATUSES.CONFIRMED]: { fill: '#450a0a', stroke: '#dc2626', label: '#f87171' },
  [NODE_STATUSES.RESPONDING]: { fill: '#450a0a', stroke: '#7f1d1d', label: '#ef4444' },
  [NODE_STATUSES.RESOLVED]: { fill: '#052e16', stroke: '#15803d', label: '#4ade80' },
};

function getNodeStyle(status) {
  return STATUS_STYLES[status] ?? STATUS_STYLES[NODE_STATUSES.CLEAN];
}

export default function BodyMap({
  perceivedState,
  deployedCells,
  selectedNodeId,
  onSelectNode,
  onDeployDendritic,
  onDeployNeutrophil,
  onDeployResponder,
  onDeployKillerT,
  onDeployBCell,
  onDeployNKCell,
  onDeployMacrophage,
  attentionTokens,
}) {
  const nodeList = Object.values(NODES);

  const connections = [];
  const seen = new Set();
  for (const node of nodeList) {
    for (const connId of node.connections) {
      const key = [node.id, connId].sort().join('-');
      if (!seen.has(key)) {
        seen.add(key);
        connections.push({ from: node, to: NODES[connId] });
      }
    }
  }

  const cellsPerNode = {};
  for (const cell of Object.values(deployedCells)) {
    if (!cellsPerNode[cell.nodeId]) cellsPerNode[cell.nodeId] = [];
    cellsPerNode[cell.nodeId].push(cell);
  }

  const selectedNode = selectedNodeId ? NODES[selectedNodeId] : null;
  const selectedPerceived = selectedNodeId ? perceivedState.nodes[selectedNodeId] : null;

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-gray-800 shrink-0">
        <span className="text-xs text-gray-600 uppercase tracking-wider">Body Map</span>
      </div>

      <div className="flex-1 flex items-center justify-center p-2">
        <svg viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} className="w-full max-h-80" style={{ maxWidth: SVG_WIDTH }}>
          <BodySilhouette />

          {connections.map(({ from, to }) => (
            <line
              key={`${from.id}-${to.id}`}
              x1={from.position.x} y1={from.position.y}
              x2={to.position.x} y2={to.position.y}
              stroke="#1e293b" strokeWidth="1"
              strokeDasharray={to.isSystemic || from.isSystemic ? '3,3' : 'none'}
            />
          ))}

          {nodeList.map(node => {
            const psNode = perceivedState.nodes[node.id];
            const status = psNode?.status ?? NODE_STATUSES.CLEAN;
            const style = getNodeStyle(status);
            const isSelected = node.id === selectedNodeId;
            const cells = cellsPerNode[node.id] ?? [];

            const hasDendritic = cells.some(c => c.type === 'dendritic');
            const hasNeutrophil = cells.some(c => c.type === 'neutrophil');
            const hasResponder = cells.some(c => ['responder', 'killer_t', 'b_cell', 'nk_cell'].includes(c.type));
            const hasMacrophage = cells.some(c => c.type === 'macrophage');

            return (
              <g key={node.id} onClick={() => onSelectNode(node.id === selectedNodeId ? null : node.id)} className="cursor-pointer">
                {isSelected && (
                  <circle cx={node.position.x} cy={node.position.y} r={12}
                    fill="none" stroke="#60a5fa" strokeWidth="1.5" strokeDasharray="4,2" />
                )}
                {node.isHQ && (
                  <circle cx={node.position.x} cy={node.position.y} r={11}
                    fill="none" stroke="#6d28d9" strokeWidth="1" />
                )}
                <circle cx={node.position.x} cy={node.position.y} r={8}
                  fill={style.fill} stroke={style.stroke} strokeWidth={node.isBottleneck ? 1.5 : 1} />

                {/* Cell indicators */}
                {hasNeutrophil && <circle cx={node.position.x + 7} cy={node.position.y - 7} r={2.5} fill="#3b82f6" />}
                {hasDendritic && <circle cx={node.position.x - 7} cy={node.position.y - 7} r={2.5} fill="#8b5cf6" />}
                {hasResponder && <circle cx={node.position.x} cy={node.position.y - 10} r={2.5} fill="#ef4444" />}
                {hasMacrophage && <circle cx={node.position.x + 7} cy={node.position.y + 7} r={2.5} fill="#f59e0b" />}

                <text x={node.position.x} y={node.position.y + 18} textAnchor="middle"
                  fontSize="6" fill={style.label} fontFamily="monospace">
                  {node.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="px-2 pb-1">
        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
          {[
            { color: '#334155', label: 'Clear' },
            { color: '#854d0e', label: 'Watching' },
            { color: '#c2410c', label: 'Suspected' },
            { color: '#dc2626', label: 'Confirmed' },
            { color: '#7f1d1d', label: 'Responding' },
            { color: '#15803d', label: 'Resolved' },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-xs text-gray-700">{label}</span>
            </div>
          ))}
        </div>
        {/* Cell legend */}
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1">
          {[
            { color: '#8b5cf6', label: 'DC' },
            { color: '#3b82f6', label: 'NΦ' },
            { color: '#ef4444', label: 'Resp' },
            { color: '#f59e0b', label: 'MΦ' },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-0.5">
              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-xs text-gray-700">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Deployment panel for selected node */}
      {selectedNode && (
        <div className="border-t border-gray-800 p-2 shrink-0">
          <div className="text-xs text-gray-400 font-mono mb-1">
            {selectedNode.label}
            {selectedNode.isHQ && <span className="ml-1 text-purple-400">[HQ]</span>}
            {selectedNode.isBottleneck && <span className="ml-1 text-yellow-700">[KEY]</span>}
          </div>
          <div className="text-xs text-gray-600 mb-2">
            {selectedPerceived?.status ?? 'clean'}
            {selectedPerceived?.scoutConfirmed && <span className="text-purple-600 ml-1">✓ scouted</span>}
          </div>

          <div className="flex flex-col gap-1">
            <DeployButton label="Scout (DC)" cost={DEPLOY_COSTS.dendritic} tokens={attentionTokens}
              onClick={() => onDeployDendritic(selectedNode.id)} color="purple" detail="3t · precision intel" />
            <DeployButton label="Patrol (NΦ)" cost={DEPLOY_COSTS.neutrophil} tokens={attentionTokens}
              onClick={() => onDeployNeutrophil(selectedNode.id)} color="blue" detail="1t · coverage" />
            <DeployButton label="Macrophage" cost={DEPLOY_COSTS.macrophage} tokens={attentionTokens}
              onClick={() => onDeployMacrophage(selectedNode.id)} color="amber" detail="1t · ambient sense" />
            <DeployButton label="Responder" cost={DEPLOY_COSTS.responder} tokens={attentionTokens}
              onClick={() => onDeployResponder(selectedNode.id)} color="red" detail="3t · general attack" />
            <DeployButton label="Killer T" cost={DEPLOY_COSTS.killer_t} tokens={attentionTokens}
              onClick={() => onDeployKillerT(selectedNode.id)} color="red" detail="4t · needs scout" />
            <DeployButton label="B-Cell" cost={DEPLOY_COSTS.b_cell} tokens={attentionTokens}
              onClick={() => onDeployBCell(selectedNode.id)} color="green" detail="2t · safe tag" />
            <DeployButton label="NK Cell" cost={DEPLOY_COSTS.nk_cell} tokens={attentionTokens}
              onClick={() => onDeployNKCell(selectedNode.id)} color="orange" detail="3t · no scout needed" />
          </div>
        </div>
      )}
    </div>
  );
}

function DeployButton({ label, cost, tokens, onClick, color, detail }) {
  const canAfford = tokens >= cost;
  const colorMap = {
    purple: 'border-purple-800 text-purple-400 hover:bg-purple-900',
    blue: 'border-blue-800 text-blue-400 hover:bg-blue-900',
    red: 'border-red-800 text-red-400 hover:bg-red-900',
    green: 'border-green-800 text-green-400 hover:bg-green-900',
    orange: 'border-orange-800 text-orange-400 hover:bg-orange-900',
    amber: 'border-amber-800 text-amber-400 hover:bg-amber-900',
  };

  return (
    <button onClick={onClick} disabled={!canAfford}
      className={`w-full text-left px-2 py-0.5 text-xs font-mono border ${
        canAfford ? colorMap[color] : 'border-gray-800 text-gray-700 cursor-not-allowed'
      } transition-colors`}>
      <div className="flex justify-between">
        <span>{label}</span>
        <span>{cost}t</span>
      </div>
      <div className="text-gray-600 text-xs leading-tight">{detail}</div>
    </button>
  );
}

function BodySilhouette() {
  return (
    <g opacity="0.08">
      <ellipse cx="100" cy="25" rx="14" ry="17" fill="none" stroke="#94a3b8" strokeWidth="1" />
      <rect x="94" y="40" width="12" height="10" fill="none" stroke="#94a3b8" strokeWidth="1" />
      <path d="M75 50 L55 80 L55 200 L145 200 L145 80 Z" fill="none" stroke="#94a3b8" strokeWidth="1" />
      <path d="M75 55 L45 130" fill="none" stroke="#94a3b8" strokeWidth="1" />
      <path d="M125 55 L155 130" fill="none" stroke="#94a3b8" strokeWidth="1" />
      <path d="M80 200 L70 330" fill="none" stroke="#94a3b8" strokeWidth="1" />
      <path d="M120 200 L130 330" fill="none" stroke="#94a3b8" strokeWidth="1" />
    </g>
  );
}

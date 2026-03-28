// BodyMap — the main event. Large SVG with notification badges on nodes.
// Clicking a node selects it for detail view.

import { NODES } from '../data/nodes.js';
import { NODE_STATUSES } from '../state/perceivedState.js';

const SVG_W = 320;
const SVG_H = 540;
const NODE_R = 14;

// Node fill/stroke by perceived status
const STATUS_STYLES = {
  [NODE_STATUSES.CLEAN]:        { fill: '#0f172a', stroke: '#1e3a5f', glow: null },
  [NODE_STATUSES.WATCHING]:     { fill: '#1c1208', stroke: '#854d0e', glow: '#854d0e' },
  [NODE_STATUSES.INVESTIGATING]:{ fill: '#0c1a35', stroke: '#1d4ed8', glow: '#1d4ed8' },
  [NODE_STATUSES.SUSPECTED]:    { fill: '#2d1200', stroke: '#c2410c', glow: '#c2410c' },
  [NODE_STATUSES.CONFIRMED]:    { fill: '#2d0000', stroke: '#dc2626', glow: '#dc2626' },
  [NODE_STATUSES.RESPONDING]:   { fill: '#3d0000', stroke: '#ef4444', glow: '#ef4444' },
  [NODE_STATUSES.RESOLVED]:     { fill: '#021a0a', stroke: '#16a34a', glow: '#16a34a' },
};

// Two badge counts per node:
//   knownCount  — threat_confirmed / threat_expanding (red badge, right)
//   unknownCount — anomaly_detected / collateral_damage (blue/yellow badge, left)
// Info signals (patrol_clear, false_alarm) do NOT appear in badges.
function getNodeBadges(signals) {
  if (!signals || signals.length === 0) return { knownCount: 0, unknownCount: 0 };
  const active = signals.filter(s => !s.routed);
  const knownCount = active.filter(s =>
    s.type === 'threat_confirmed' || s.type === 'threat_expanding'
  ).length;
  const unknownCount = active.filter(s =>
    s.type === 'anomaly_detected' || s.type === 'collateral_damage'
  ).length;
  return { knownCount, unknownCount };
}

function getCellIndicators(nodeId, deployedCells) {
  const here = Object.values(deployedCells).filter(c => c.nodeId === nodeId && c.phase === 'arrived');
  const enRoute = Object.values(deployedCells).filter(c => c.nodeId === nodeId && c.phase === 'outbound');
  return { here, enRoute };
}

export default function BodyMap({ perceivedState, deployedCells, selectedNodeId, onSelectNode, onNodeContextMenu, activeSignals }) {
  const nodeList = Object.values(NODES);

  // Deduplicated connections
  const connections = [];
  const seen = new Set();
  for (const node of nodeList) {
    for (const connId of node.connections) {
      const key = [node.id, connId].sort().join('-');
      if (!seen.has(key)) {
        seen.add(key);
        if (NODES[connId]) connections.push({ from: node, to: NODES[connId] });
      }
    }
  }

  // Group signals by node for badges
  const signalsByNode = {};
  for (const sig of (activeSignals ?? [])) {
    if (!signalsByNode[sig.nodeId]) signalsByNode[sig.nodeId] = [];
    signalsByNode[sig.nodeId].push(sig);
  }

  return (
    <div className="w-full h-full flex items-center justify-center bg-gray-950 select-none">
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        className="w-full h-full"
        style={{ maxHeight: '100%' }}
      >
        <defs>
          {/* Glow filters for active nodes */}
          {['#c2410c', '#dc2626', '#ef4444', '#1d4ed8', '#16a34a', '#854d0e'].map(color => (
            <filter key={color} id={`glow-${color.replace('#', '')}`}>
              <feGaussianBlur stdDeviation="3" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          ))}
        </defs>

        {/* Body silhouette */}
        {/* <BodySilhouette /> */}

        {/* Connection lines */}
        {connections.map(({ from, to }) => {
          
          return (
            <line
              key={`${from.id}-${to.id}`}
              x1={from.position.x} y1={from.position.y}
              x2={to.position.x} y2={to.position.y}
              stroke={'#1e293b'}
              strokeWidth={1}
              strokeDasharray={ 'none'}
              opacity="0.6"
            />
          );
        })}

        {/* Nodes */}
        {nodeList.map(node => {
          const psNode = perceivedState.nodes[node.id];
          const status = psNode?.status ?? NODE_STATUSES.CLEAN;
          const style = STATUS_STYLES[status] ?? STATUS_STYLES[NODE_STATUSES.CLEAN];
          const isSelected = node.id === selectedNodeId;
          const { knownCount, unknownCount } = getNodeBadges(signalsByNode[node.id]);
          const { here, enRoute } = getCellIndicators(node.id, deployedCells);
          const hasCells = here.length > 0 || enRoute.length > 0;

          return (
            <g
              key={node.id}
              onClick={() => onSelectNode(node.id === selectedNodeId ? null : node.id)}
              onContextMenu={e => { e.preventDefault(); onNodeContextMenu?.(node.id); }}
              className="cursor-pointer"
            >
              {/* Glow ring for active nodes */}
              {style.glow && (
                <circle
                  cx={node.position.x} cy={node.position.y}
                  r={NODE_R + 4}
                  fill="none"
                  stroke={style.glow}
                  strokeWidth="1"
                  opacity="0.3"
                  filter={`url(#glow-${style.glow.replace('#', '')})`}
                />
              )}

              {/* Selection ring */}
              {isSelected && (
                <circle
                  cx={node.position.x} cy={node.position.y}
                  r={NODE_R + 7}
                  fill="none"
                  stroke="#60a5fa"
                  strokeWidth="1.5"
                  strokeDasharray="5,3"
                  opacity="0.8"
                />
              )}

              {/* HQ ring */}
              {node.isHQ && (
                <circle
                  cx={node.position.x} cy={node.position.y}
                  r={NODE_R + 5}
                  fill="none"
                  stroke="#7c3aed"
                  strokeWidth="1"
                  opacity="0.5"
                />
              )}

              {/* Node body */}
              <circle
                cx={node.position.x} cy={node.position.y}
                r={NODE_R}
                fill={style.fill}
                stroke={style.stroke}
                strokeWidth={node.isBottleneck ? 2 : 1.5}
              />

              {/* Node label */}
              <text
                x={node.position.x}
                y={node.position.y + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize="7"
                fill={style.stroke}
                fontFamily="monospace"
                fontWeight="500"
              >
                {node.label}
              </text>

              {/* Cell presence dot (bottom of node) */}
              {hasCells && (
                <g>
                  {here.length > 0 && (
                    <circle
                      cx={node.position.x - 8} cy={node.position.y + NODE_R + 5}
                      r={4}
                      fill="#1e3a5f"
                      stroke="#3b82f6"
                      strokeWidth="1"
                    />
                  )}
                  {here.length > 0 && (
                    <text
                      x={node.position.x - 8} y={node.position.y + NODE_R + 5}
                      textAnchor="middle" dominantBaseline="middle"
                      fontSize="5" fill="#93c5fd" fontFamily="monospace"
                    >
                      {here.length}
                    </text>
                  )}
                  {enRoute.length > 0 && (
                    <circle
                      cx={node.position.x + 8} cy={node.position.y + NODE_R + 5}
                      r={4}
                      fill="#1a1a2e"
                      stroke="#6366f1"
                      strokeWidth="1"
                      strokeDasharray="2,1"
                    />
                  )}
                  {enRoute.length > 0 && (
                    <text
                      x={node.position.x + 8} y={node.position.y + NODE_R + 5}
                      textAnchor="middle" dominantBaseline="middle"
                      fontSize="5" fill="#a5b4fc" fontFamily="monospace"
                    >
                      {enRoute.length}
                    </text>
                  )}
                </g>
              )}

              {/* Known problems badge — top-right (red) */}
              {knownCount > 0 && (
                <g>
                  <circle
                    cx={node.position.x + NODE_R - 2}
                    cy={node.position.y - NODE_R + 2}
                    r={7} fill="#450a0a" stroke="#ef4444" strokeWidth="1"
                  />
                  <text
                    x={node.position.x + NODE_R - 2} y={node.position.y - NODE_R + 2}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize="6" fill="#ef4444" fontFamily="monospace" fontWeight="bold"
                  >
                    {knownCount > 9 ? '9+' : knownCount}
                  </text>
                </g>
              )}

              {/* Unknown signals badge — top-left (yellow) */}
              {unknownCount > 0 && (
                <g>
                  <circle
                    cx={node.position.x - NODE_R + 2}
                    cy={node.position.y - NODE_R + 2}
                    r={7} fill="#2d1800" stroke="#f59e0b" strokeWidth="1"
                  />
                  <text
                    x={node.position.x - NODE_R + 2} y={node.position.y - NODE_R + 2}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize="6" fill="#f59e0b" fontFamily="monospace" fontWeight="bold"
                  >
                    {unknownCount > 9 ? '9+' : unknownCount}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function BodySilhouette() {
  return (
    <g opacity="0.06" stroke="#94a3b8" strokeWidth="1" fill="none">
      {/* Head */}
      <ellipse cx="160" cy="32" rx="28" ry="25" />
      {/* Neck */}
      <rect x="150" y="55" width="20" height="18" />
      {/* Torso */}
      <path d="M110 73 L70 160 L80 360 L240 360 L250 160 L210 73 Z" />
      {/* Left arm */}
      <path d="M110 90 L55 220 L70 230" />
      {/* Right arm */}
      <path d="M210 90 L265 220 L250 230" />
      {/* Left leg */}
      <path d="M120 360 L100 530" />
      {/* Right leg */}
      <path d="M200 360 L220 530" />
    </g>
  );
}

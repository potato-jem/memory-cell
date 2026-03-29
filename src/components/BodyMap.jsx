// BodyMap — SVG body map.
//
// Node appearance:
//   Fill colour  = inflammation (dark blue → olive → amber → orange → red)
//   Fill level   = tissue integrity (full = 100%, empty = 0%)
//   Arc rings    = classified pathogens (arc length = load %, each type a unique colour)
//   Inner dots   = friendly cells present (colour = cell type, sorted)
//   Orange badge = count of unclassified anomalies ("possible threat")
//   Red badge    = count of confirmed-but-untyped threats
//   (Classified threats are shown as rings, not badges)

import { NODES } from '../data/nodes.js';
import { ENTITY_CLASS } from '../state/perceivedState.js';
import { PATHOGEN_SIGNAL_TYPE, getPrimaryLoad } from '../data/pathogens.js';

const SVG_W = 420;
const SVG_H = 420;
const NODE_R = 22;

// ── Colour tables ─────────────────────────────────────────────────────────────

const PATHOGEN_RING_COLORS = {
  extracellular_bacteria: '#a3e635',   // lime
  intracellular_bacteria: '#34d399',   // emerald
  virus:                  '#e879f9',   // fuchsia
  fungi:                  '#f59e0b',   // amber
  parasite:               '#a855f7',   // purple
  toxin_producer:         '#fb923c',   // orange
  prion:                  '#ef4444',   // red
  cancer:                 '#94a3b8',   // slate
};

const CELL_DOT_COLORS = {
  neutrophil: '#60a5fa',   // blue
  macrophage: '#fbbf24',   // amber
  dendritic:  '#c084fc',   // purple
  responder:  '#f87171',   // red
  killer_t:   '#fb7185',   // rose
  b_cell:     '#4ade80',   // green
  nk_cell:    '#fb923c',   // orange
};
const CELL_TYPE_ORDER = ['neutrophil', 'macrophage', 'dendritic', 'responder', 'killer_t', 'b_cell', 'nk_cell'];

// ── Signal type → pathogen type reverse map ───────────────────────────────────
const SIG_TO_PATHOGEN = {};
for (const [pathType, sigType] of Object.entries(PATHOGEN_SIGNAL_TYPE)) {
  if (!SIG_TO_PATHOGEN[sigType]) SIG_TO_PATHOGEN[sigType] = [];
  SIG_TO_PATHOGEN[sigType].push(pathType);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function inflammationStyle(pct) {
  // pct 0..1 — returns { fill, stroke } SVG colour strings
  if (pct < 0.10) return { fill: '#0a1628', stroke: '#1e3a5f' };   // deep navy
  if (pct < 0.25) return { fill: '#151a00', stroke: '#4a6010' };   // dark olive
  if (pct < 0.50) return { fill: '#2a1500', stroke: '#854d0e' };   // dark amber
  if (pct < 0.75) return { fill: '#3a0e00', stroke: '#c2410c' };   // dark orange
  return                 { fill: '#3a0000', stroke: '#dc2626' };    // dark red
}

// Partial circle arc, starting at 12 o'clock, sweeping clockwise by `pct` (0..1).
// Returns an SVG path `d` string (open arc — no fill, use stroke).
function arcPath(cx, cy, r, pct) {
  if (pct <= 0) return '';
  const p = Math.min(pct, 0.9999);
  const a0 = -Math.PI / 2;
  const a1 = a0 + p * 2 * Math.PI;
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const large = p > 0.5 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

// Rings to render:
//   CLASSIFIED entity  → type-specific colour, arc = GT load %
//   PATHOGEN entity    → generic orange ring, arc = dominant GT load %
function getPathogenRings(nodeId, perceivedState, gtNodeStates) {
  const entities = (perceivedState.foreignEntitiesByNode?.[nodeId] ?? [])
    .filter(e => !e.isDismissed);

  const gtNode = gtNodeStates?.[nodeId];
  if (!gtNode) return [];

  const rings = [];
  const seenPathogenTypes = new Set();

  // 1. CLASSIFIED entities → specific ring colour
  for (const entity of entities.filter(e => e.perceivedClass === ENTITY_CLASS.CLASSIFIED && e.classifiedType)) {
    const pathTypes = SIG_TO_PATHOGEN[entity.classifiedType] ?? [];
    for (const pt of pathTypes) {
      if (seenPathogenTypes.has(pt)) continue;
      const inst = gtNode.pathogens?.[pt];
      if (!inst) continue;
      const load = getPrimaryLoad(inst);
      if (load <= 0) continue;
      seenPathogenTypes.add(pt);
      rings.push({ pathogenType: pt, loadPct: Math.min(0.999, load / 100), color: PATHOGEN_RING_COLORS[pt] ?? '#aaa', dashed: false });
    }
  }

  // 2. PATHOGEN entities (confirmed-untyped) → generic ring using dominant GT pathogen
  const hasUntyped = entities.some(e => e.perceivedClass === ENTITY_CLASS.PATHOGEN);
  if (hasUntyped) {
    // Find highest-load GT pathogen not already shown as a classified ring
    let bestLoad = 0, bestType = null;
    for (const [pt, inst] of Object.entries(gtNode.pathogens ?? {})) {
      if (seenPathogenTypes.has(pt)) continue;
      const load = getPrimaryLoad(inst);
      if (load > bestLoad) { bestLoad = load; bestType = pt; }
    }
    if (bestType && bestLoad > 0) {
      rings.push({ pathogenType: bestType, loadPct: Math.min(0.999, bestLoad / 100), color: '#f97316', dashed: true });
    }
  }

  return rings;
}

function getBadgeCounts(nodeId, perceivedState, rings) {
  const entities = (perceivedState.foreignEntitiesByNode?.[nodeId] ?? []).filter(e => !e.isDismissed);
  // UNKNOWN → orange badge; PATHOGEN → orange badge if no ring yet (ring already conveys it)
  const hasRings = rings.length > 0;
  return {
    possible: entities.filter(e => e.perceivedClass === ENTITY_CLASS.UNKNOWN).length,
    // Confirmed-untyped badge only shows when there's no ring (no GT data found)
    confirmed: hasRings ? 0 : entities.filter(e => e.perceivedClass === ENTITY_CLASS.PATHOGEN).length,
  };
}

function getCellDots(nodeId, deployedCells) {
  // Show cells at this node regardless of phase (arrived, outbound-passing-through, returning)
  // Outbound/returning cells at their current intermediate position appear as dimmed dots
  return Object.values(deployedCells)
    .filter(c => c.nodeId === nodeId &&
      (c.phase === 'arrived' || c.phase === 'outbound' || c.phase === 'returning'))
    .sort((a, b) => CELL_TYPE_ORDER.indexOf(a.type) - CELL_TYPE_ORDER.indexOf(b.type));
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function BodyMap({
  perceivedState,
  groundTruthNodeStates,
  deployedCells,
  selectedNodeId,
  onSelectNode,
  onNodeContextMenu,
}) {
  const nodeList = Object.values(NODES);

  // Deduplicated edges
  const edges = [];
  const seenEdges = new Set();
  for (const node of nodeList) {
    for (const connId of node.connections) {
      const key = [node.id, connId].sort().join('-');
      if (!seenEdges.has(key) && NODES[connId]) {
        seenEdges.add(key);
        edges.push({ from: node, to: NODES[connId] });
      }
    }
  }

  return (
    <div className="w-full h-full flex items-center justify-center bg-gray-950 select-none">
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        className="w-full h-full"
        style={{ maxHeight: '100%' }}
      >
        <defs>
          {/* Per-node integrity clip paths */}
          {nodeList.map(node => {
            const gt = groundTruthNodeStates?.[node.id];
            const integ = Math.max(0, Math.min(100, gt?.tissueIntegrity ?? 100)) / 100;
            const cx = node.position.x;
            const cy = node.position.y;
            return (
              <clipPath key={node.id} id={`clip-${node.id}`}>
                <rect
                  x={cx - NODE_R}
                  y={cy + NODE_R - integ * 2 * NODE_R}
                  width={2 * NODE_R}
                  height={integ * 2 * NODE_R}
                />
              </clipPath>
            );
          })}

          {/* Glow filters */}
          {[
            '#dc2626', '#c2410c', '#f97316', '#f59e0b',
            '#a3e635', '#34d399', '#e879f9', '#a855f7',
            '#fb923c', '#60a5fa', '#fbbf24',
          ].map(c => (
            <filter key={c} id={`glow-${c.slice(1)}`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          ))}
        </defs>

        {/* Connection lines */}
        {edges.map(({ from, to }) => (
          <line
            key={`${from.id}-${to.id}`}
            x1={from.position.x} y1={from.position.y}
            x2={to.position.x}   y2={to.position.y}
            stroke="#1e293b" strokeWidth="1.5" opacity="0.5"
          />
        ))}

        {/* Nodes */}
        {nodeList.map(node => {
          const cx = node.position.x;
          const cy = node.position.y;
          const gt  = groundTruthNodeStates?.[node.id];
          const inflammPct = (gt?.inflammation ?? 0) / 100;
          const { fill, stroke } = inflammationStyle(inflammPct);
          const isSelected = node.id === selectedNodeId;
          const rings = getPathogenRings(node.id, perceivedState, groundTruthNodeStates);
          const { possible, confirmed } = getBadgeCounts(node.id, perceivedState, rings);
          const cellDots = getCellDots(node.id, deployedCells);

          // Pathogen rings: start just outside the node border, spaced 6px apart
          const ringBase = NODE_R + 5;
          const ringStep = 6;

          // Selection ring sits outside all pathogen rings
          const selectR = ringBase + rings.length * ringStep + 6;

          // Multi-line label for "Bone Marrow"
          const words = node.label.split(' ');

          return (
            <g
              key={node.id}
              onClick={() => onSelectNode(node.id === selectedNodeId ? null : node.id)}
              onContextMenu={e => { e.preventDefault(); onNodeContextMenu?.(node.id); }}
              className="cursor-pointer"
            >
              {/* Pathogen arc rings */}
              {rings.map((ring, i) => {
                const r = ringBase + i * ringStep;
                const d = arcPath(cx, cy, r, ring.loadPct);
                return d ? (
                  <path
                    key={ring.pathogenType}
                    d={d}
                    fill="none"
                    stroke={ring.color}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeDasharray={ring.dashed ? '4 3' : undefined}
                    opacity={ring.dashed ? 0.6 : 0.85}
                    filter={`url(#glow-${ring.color.slice(1)})`}
                  />
                ) : null;
              })}

              {/* Selection ring */}
              {isSelected && (
                <circle
                  cx={cx} cy={cy} r={selectR}
                  fill="none"
                  stroke="#60a5fa"
                  strokeWidth="1.5"
                  strokeDasharray="4 3"
                  opacity="0.8"
                />
              )}

              {/* HQ outer ring */}
              {node.isHQ && (
                <circle cx={cx} cy={cy} r={NODE_R + 3}
                  fill="none" stroke="#7c3aed" strokeWidth="1" opacity="0.5" />
              )}

              {/* Dark background circle */}
              <circle cx={cx} cy={cy} r={NODE_R} fill="#050d18" />

              {/* Inflammation fill, clipped to integrity level from bottom */}
              <circle
                cx={cx} cy={cy} r={NODE_R - 0.75}
                fill={fill}
                clipPath={`url(#clip-${node.id})`}
              />

              {/* Border (drawn last so it's always crisp on top) */}
              <circle
                cx={cx} cy={cy} r={NODE_R}
                fill="none"
                stroke={stroke}
                strokeWidth={node.isBottleneck ? 2.5 : 1.5}
              />

              {/* Friendly cell dots around inner edge */}
              {/* Arrived = full opacity; outbound/returning = dimmed (passing through) */}
              {cellDots.map((cell, i) => {
                const angle = (i / Math.max(1, cellDots.length)) * 2 * Math.PI - Math.PI / 2;
                const dr = NODE_R - 6;
                const inTransit = cell.phase === 'outbound' || cell.phase === 'returning';
                return (
                  <circle
                    key={cell.id}
                    cx={cx + dr * Math.cos(angle)}
                    cy={cy + dr * Math.sin(angle)}
                    r={inTransit ? 2 : 2.5}
                    fill={CELL_DOT_COLORS[cell.type] ?? '#888'}
                    opacity={inTransit ? 0.35 : 0.95}
                  />
                );
              })}

              {/* Node label — split "Bone Marrow" onto two lines */}
              {words.length > 1 ? (
                <text
                  textAnchor="middle"
                  fontFamily="monospace"
                  fontWeight={node.isHQ ? '600' : '500'}
                  fill={node.isHQ ? '#a78bfa' : stroke}
                  className="pointer-events-none select-none"
                >
                  <tspan x={cx} y={cy - 3} fontSize="6.5">{words[0]}</tspan>
                  <tspan x={cx} dy="9"     fontSize="6.5">{words[1]}</tspan>
                </text>
              ) : (
                <text
                  x={cx} y={cy + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="7"
                  fontFamily="monospace"
                  fontWeight={node.isHQ ? '600' : '500'}
                  fill={node.isHQ ? '#a78bfa' : stroke}
                  className="pointer-events-none select-none"
                >
                  {node.label}
                </text>
              )}

              {/* Orange badge — possible / unclassified threats */}
              {possible > 0 && (
                <g>
                  <circle
                    cx={cx - NODE_R + 4} cy={cy - NODE_R + 3}
                    r={6} fill="#92400e" stroke="#f59e0b" strokeWidth="0.75"
                  />
                  <text
                    x={cx - NODE_R + 4} y={cy - NODE_R + 3}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize="6" fontFamily="monospace" fontWeight="bold"
                    fill="#fde68a"
                    className="pointer-events-none select-none"
                  >
                    {possible}
                  </text>
                </g>
              )}

              {/* Red badge — confirmed untyped threats */}
              {confirmed > 0 && (
                <g>
                  <circle
                    cx={cx + NODE_R - 4} cy={cy - NODE_R + 3}
                    r={6} fill="#7f1d1d" stroke="#ef4444" strokeWidth="0.75"
                  />
                  <text
                    x={cx + NODE_R - 4} y={cy - NODE_R + 3}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize="6" fontFamily="monospace" fontWeight="bold"
                    fill="#fca5a5"
                    className="pointer-events-none select-none"
                  >
                    {confirmed}
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

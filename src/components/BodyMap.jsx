// BodyMap — SVG body map.
//
// Node appearance:
//   Fill colour  = inflammation (dark blue → olive → amber → orange → red)
//   Fill level   = tissue integrity (full = 100%, empty = 0%)
//   Arc rings    = detected pathogens (style reflects detected_level; arc = load %)
//     unknown       → thin dashed grey ring, fixed arc
//     threat        → dashed orange ring, fixed arc
//     classified    → solid type-colour ring, arc = load %
//     misclassified → solid ring in perceived_type colour, arc = load %
//   Inner dots   = friendly cells present (colour = cell type, sorted)
//   Yellow badge = count of unknown-level pathogens

import { NODES } from '../data/nodes.js';
import { getPrimaryLoad, PATHOGEN_RING_COLORS } from '../data/pathogens.js';
import { CELL_CONFIG, CELL_TYPE_ORDER } from '../data/cellConfig.js';

const SVG_W = 420;
const SVG_H = 420;
const NODE_R = 22;

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

// Build rings and badge counts from pathogen detected_levels.
// Rings are sorted: classified/misclassified innermost, then threat, then unknown (outermost).
function getPathogenDisplay(nodeId, gtNodeStates, isVisible) {
  const pathogens = gtNodeStates?.[nodeId]?.pathogens ?? [];
  const rings = [];
  let unknownCount = 0;

  // Separate by level for ordered rendering
  const classified = [], threats = [], unknowns = [];
  for (const inst of pathogens) {
    if (inst.detected_level === 'classified' || inst.detected_level === 'misclassified') classified.push(inst);
    else if (inst.detected_level === 'threat') threats.push(inst);
    else if (inst.detected_level === 'unknown') unknowns.push(inst);
  }
  unknownCount = unknowns.length;

  // classified/misclassified: solid type-colour ring; arc = actual load when visible, lastKnownLoad when not
  for (const inst of classified) {
    const displayType = inst.perceived_type ?? inst.type;
    const color = PATHOGEN_RING_COLORS[displayType] ?? '#aaa';
    const load =  getPrimaryLoad(inst, isVisible);
    if (load <= 0) continue;
    const loadPct = Math.min(0.999, load / 100);
    rings.push({ uid: inst.uid, loadPct, color, dashed: false, dashArray: undefined });
  }

  // threat: dashed orange ring, fixed arc (load unknown to player)
  for (const inst of threats) {
    rings.push({ uid: inst.uid, loadPct: 0.15, color: '#f97316', dashed: true, dashArray: '5 3' });
  }

  // unknown: thin dashed grey ring, short fixed arc
  for (const inst of unknowns) {
    rings.push({ uid: inst.uid, loadPct: 0.15, color: '#6b7280', dashed: true, dashArray: '3 4' });
  }

  return { rings, unknownCount };
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
  groundTruthNodeStates,
  deployedCells,
  selectedNodeId,
  onSelectNode,
  onNodeContextMenu,
  visibleNodes = new Set(),
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
            '#dc2626', '#c2410c', '#f97316',
            '#4ade80', '#2dd4bf', '#f43f5e', '#fbbf24',
            '#818cf8', '#fb923c', '#e879f9', '#94a3b8',
            '#60a5fa',
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
          const gt = groundTruthNodeStates?.[node.id];
          const isVisible = visibleNodes.has(node.id);
          const inflammPct = (isVisible ? (gt?.inflammation ?? 0) : (gt?.lastKnownInflammation ?? 0)) / 100;
          const { fill, stroke } = inflammationStyle(inflammPct);
          const isSelected = node.id === selectedNodeId;
          const { rings, unknownCount } = getPathogenDisplay(node.id, groundTruthNodeStates, isVisible);
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
              {/* Selection ring — outside fog layer so it's always crisp when selected */}
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

              {/* Fog layer — dims everything when no visibility (cell dots and selection excluded) */}
              <g opacity={isVisible ? 1 : 0.35}>

                {/* Pathogen arc rings */}
                {rings.map((ring, i) => {
                  const r = ringBase + i * ringStep;
                  const d = arcPath(cx, cy, r, ring.loadPct);
                  return d ? (
                    <path
                      key={ring.uid ?? i}
                      d={d}
                      fill="none"
                      stroke={ring.color}
                      strokeWidth={ring.dashed ? 1.5 : 2.5}
                      strokeLinecap="round"
                      strokeDasharray={ring.dashArray}
                      opacity={ring.dashed ? 0.55 : 0.85}
                      filter={ring.dashed ? undefined : `url(#glow-${ring.color.slice(1)})`}
                    />
                  ) : null;
                })}

                {/* HQ outer ring */}
                {node.isHQ && (
                  <circle cx={cx} cy={cy} r={NODE_R + 3}
                    fill="none" stroke="#7c3aed" strokeWidth="1" opacity="0.5" />
                )}

                {/* Dark background circle */}
                <circle cx={cx} cy={cy} r={NODE_R} fill="#050d18" />

                {/* Inflammation fill (fog-aware colour), clipped to tissue integrity level (always GT) */}
                <circle
                  cx={cx} cy={cy} r={NODE_R - 0.75}
                  fill={fill}
                  clipPath={`url(#clip-${node.id})`}
                />

                {/* Border */}
                <circle
                  cx={cx} cy={cy} r={NODE_R}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={node.isBottleneck ? 2.5 : 1.5}
                />

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

                {/* Yellow badge — count of unknown-level pathogens */}
                {unknownCount > 0 && (
                  <g>
                    <circle
                      cx={cx - NODE_R + 4} cy={cy - NODE_R + 3}
                      r={6} fill="#78350f" stroke="#d97706" strokeWidth="0.75"
                    />
                    <text
                      x={cx - NODE_R + 4} y={cy - NODE_R + 3}
                      textAnchor="middle" dominantBaseline="middle"
                      fontSize="6" fontFamily="monospace" fontWeight="bold"
                      fill="#fde68a"
                      className="pointer-events-none select-none"
                    >
                      {unknownCount}
                    </text>
                  </g>
                )}

              </g>{/* end fog layer */}

              {/* Friendly cell dots — always full opacity (globally visible) */}
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
                    fill={CELL_CONFIG[cell.type]?.color ?? '#888'}
                    opacity={inTransit ? 0.35 : 0.95}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// BodyMap — SVG body map.
//
// Node appearance:
//   Fill colour  = inflammation (dark blue → olive → amber → orange → red)
//   Fill level   = tissue integrity (full = 100%, empty = 0%)
//   Arc rings    = detected pathogens (style reflects detected_level; arc = load %)
//     unknown    → thin dashed grey ring, fixed arc
//     classified → solid type-colour ring, arc = load %
//   Inner pips   = white dots around inside of node, 1 per turnsSinceLastClear (max 36)
//   Inner dots   = friendly cells present (colour = cell type, sorted)

import { useState } from 'react';
import { NODES } from '../data/nodes.js';
import { getPrimaryLoad, PATHOGEN_RING_COLORS, PATHOGEN_DISPLAY_NAMES } from '../data/pathogens.js';
import { CELL_CONFIG, CELL_TYPE_ORDER } from '../data/cellConfig.js';

const SVG_W = 420;
const SVG_H = 420;
const NODE_R = 25;  // slightly larger nodes for readability

const MAX_PIPS = 24;  // max surveillance-staleness pips to show

// ── Helpers ───────────────────────────────────────────────────────────────────

function darkenColor(hex, factor = 0.65) {
  // Normalise 3-char shorthand (#aaa → #aaaaaa) before parsing
  const h = hex.length === 4
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex;
  const r = Math.round(parseInt(h.slice(1, 3), 16) * factor);
  const g = Math.round(parseInt(h.slice(3, 5), 16) * factor);
  const b = Math.round(parseInt(h.slice(5, 7), 16) * factor);
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

function inflammationStyle(pct) {
  // pct 0..1 — returns { fill, stroke } SVG colour strings
  if (pct < 0.10) return { fill: '#0a1628', stroke: '#1e3a5f' };   // deep navy
  if (pct < 0.25) return { fill: '#151a00', stroke: '#4a6010' };   // dark olive
  if (pct < 0.50) return { fill: '#2a1500', stroke: '#854d0e' };   // dark amber
  if (pct < 0.75) return { fill: '#3a0e00', stroke: '#c2410c' };   // dark orange
  return                 { fill: '#3a0000', stroke: '#dc2626' };    // dark red
}

// Partial circle arc, starting at 12 o'clock, sweeping clockwise by `pct` (0..1).
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

// Closed hollow arc band — outlines the shape a thick arc would fill.
// End caps are semicircular arcs matching strokeLinecap="round" on the main arc.
function hollowArcBand(cx, cy, r, startPct, endPct, halfWidth) {
  const span = endPct - startPct;
  if (span <= 0) return '';
  const p = Math.min(span, 0.9999);
  const a0 = -Math.PI / 2 + startPct * 2 * Math.PI;
  const a1 = a0 + p * 2 * Math.PI;
  const large = p > 0.5 ? 1 : 0;
  const ro = r + halfWidth, ri = r - halfWidth;
  const ox0 = cx + ro * Math.cos(a0), oy0 = cy + ro * Math.sin(a0);
  const ox1 = cx + ro * Math.cos(a1), oy1 = cy + ro * Math.sin(a1);
  const ix0 = cx + ri * Math.cos(a1), iy0 = cy + ri * Math.sin(a1);
  const ix1 = cx + ri * Math.cos(a0), iy1 = cy + ri * Math.sin(a0);
  const hw = halfWidth;
  return [
    `M ${ox0.toFixed(2)} ${oy0.toFixed(2)}`,
    `A ${ro} ${ro} 0 ${large} 1 ${ox1.toFixed(2)} ${oy1.toFixed(2)}`,
    `A ${hw} ${hw} 0 0 1 ${ix0.toFixed(2)} ${iy0.toFixed(2)}`,  // end cap (rounded)
    `A ${ri} ${ri} 0 ${large} 0 ${ix1.toFixed(2)} ${iy1.toFixed(2)}`,
    `A ${hw} ${hw} 0 0 1 ${ox0.toFixed(2)} ${oy0.toFixed(2)}`,  // start cap (rounded)
    'Z',
  ].join(' ');
}

// Arc segment from startPct to endPct (both 0..1, clockwise from 12 o'clock).
function arcSegment(cx, cy, r, startPct, endPct) {
  const span = endPct - startPct;
  if (span <= 0) return '';
  const p = Math.min(span, 0.9999);
  const a0 = -Math.PI / 2 + startPct * 2 * Math.PI;
  const a1 = a0 + p * 2 * Math.PI;
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const large = p > 0.5 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function getPathogenDisplay(nodeId, gtNodeStates) {
  const pathogens = gtNodeStates?.[nodeId]?.pathogens ?? [];
  const rings = [];
  let unknownCount = 0;

  const classified = [], unknowns = [];
  for (const inst of pathogens) {
    if (inst.detected_level === 'classified') classified.push(inst);
    else if (inst.detected_level === 'unknown') unknowns.push(inst);
  }
  unknownCount = unknowns.length;

  for (const inst of classified) {
    const displayType = inst.perceived_type ?? inst.type;
    const color = PATHOGEN_RING_COLORS[displayType] ?? '#aaa';
    const load = getPrimaryLoad(inst, true);
    if (load <= 0) continue;
    const loadPct = Math.min(0.999, load / 100);
    rings.push({ uid: inst.uid, loadPct, color, dashed: false, dashArray: undefined });
  }

  for (const inst of unknowns) {
    rings.push({ uid: inst.uid, loadPct: 1, color: '#d97706', dashed: true, dashArray: '2 4' });
  }

  return { rings, unknownCount };
}

function getCellDots(nodeId, deployedCells) {
  return Object.values(deployedCells)
    .filter(c => c.nodeId === nodeId &&
      (c.phase === 'arrived' || c.phase === 'outbound' || c.phase === 'returning'))
    .sort((a, b) => CELL_TYPE_ORDER.indexOf(a.type) - CELL_TYPE_ORDER.indexOf(b.type));
}

// ── Hover tooltip ─────────────────────────────────────────────────────────────

function NodeTooltip({ nodeId, gtNodeStates, x, y }) {
  const node = NODES[nodeId];
  if (!node) return null;

  const ns = gtNodeStates?.[nodeId];
  const inflammation = ns?.inflammation ?? 0;
  const integrity = ns?.tissueIntegrity ?? 100;
  const pathogens = (ns?.pathogens ?? []).filter(p => p.detected_level !== 'none');
  const turnsSinceLastClear = ns?.turnsSinceLastClear ?? 0;

  const inflLabel = inflammation > 70 ? 'HIGH' : inflammation > 40 ? 'MOD' : 'LOW';
  const inflColor = inflammation > 70 ? '#f87171' : inflammation > 40 ? '#fb923c' : '#6b7280';

  return (
    <div
      style={{
        position: 'fixed',
        left: x + 14,
        top: y - 10,
        pointerEvents: 'none',
        zIndex: 40,
        minWidth: 130,
      }}
      className="bg-gray-900 border border-gray-600 rounded-md px-3 py-2 shadow-2xl text-xs"
    >
      <div className="font-mono font-bold text-gray-100 mb-1.5">{node.label}</div>
      <div className="space-y-0.5">
        <div className="flex justify-between gap-4">
          <span className="text-gray-600">Inflammation</span>
          <span className="font-mono" style={{ color: inflColor }}>{Math.round(inflammation)} {inflLabel}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-gray-600">Integrity</span>
          <span className={`font-mono ${integrity < 40 ? 'text-red-400' : integrity < 70 ? 'text-yellow-400' : 'text-green-400'}`}>
            {Math.round(integrity)}
          </span>
        </div>
        {turnsSinceLastClear > 0 && (
          <div className="flex justify-between gap-4">
            <span className="text-gray-600">Last clear</span>
            <span className="font-mono text-gray-500">{turnsSinceLastClear}T ago</span>
          </div>
        )}
        {pathogens.length > 0 && (
          <div className="mt-1 pt-1 border-t border-gray-800 space-y-0.5">
            {pathogens.map(p => {
              const level = p.detected_level;
              const isKnown = level === 'classified';
              const label = isKnown
                ? (PATHOGEN_DISPLAY_NAMES[p.perceived_type ?? p.type] ?? p.type)
                : 'Unknown presence';
              return (
                <div key={p.uid ?? p.type} className="text-orange-500 text-xs">{label}</div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function BodyMap({
  groundTruthNodeStates,
  deployedCells,
  selectedNodeId,
  onSelectNode,
  onNodeContextMenu,
  projections = null,
  onNodeHoverStart = null,
  onNodeHoverEnd = null,
}) {
  const [hoveredNode, setHoveredNode] = useState(null); // { nodeId, x, y }

  const nodeList = Object.values(NODES);

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
    <div className="w-full h-full flex items-center justify-center bg-gray-950 select-none relative">
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        className="w-full h-full"
        style={{ maxHeight: '100%' }}
      >
        <defs>
          {/* Cell type icon paths — referenced via <use href="#cell-icon-TYPE"> */}
          {/* Each icon is defined in a 24x24 viewBox; callers scale with transform */}
          <g id="cell-icon-neutrophil">
            <circle cx="9"  cy="8.5" r="5.2" />
            <circle cx="15" cy="8.5" r="5.2" />
            <circle cx="12" cy="15"  r="5.2" />
          </g>
          <g id="cell-icon-dendritic">
            <circle cx="12" cy="12" r="3.5" />
            <rect x="10.75" y="2"  width="2.5" height="7"  rx="1.25" />
            <rect x="10.75" y="15" width="2.5" height="7"  rx="1.25" />
            <rect x="2"  y="10.75" width="7"  height="2.5" rx="1.25" />
            <rect x="15" y="10.75" width="7"  height="2.5" rx="1.25" />
          </g>
          <g id="cell-icon-macrophage">
            <path d="M12 3 C15.5 3 19 6 19.5 9.5 C20.5 10.5 21.5 11 21.5 13 C21.5 14.5 20.5 15 19.5 14.5 C18.5 16.5 16 19 12 19 C7 19 3.5 16 3.5 12 C3.5 7.5 7 3 12 3 Z" />
          </g>
          <g id="cell-icon-responder">
            <path d="M12 2 L20 5.5 L20 12 C20 16.8 12 21.5 12 21.5 C12 21.5 4 16.8 4 12 L4 5.5 Z" />
          </g>
          <g id="cell-icon-killer_t">
            <path d="M12 2 L20 20 L12 14.5 L4 20 Z" />
          </g>
          <g id="cell-icon-b_cell">
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="6.5" fill="rgba(0,0,0,0.4)" />
            <circle cx="12" cy="12" r="2.75" />
          </g>
          <g id="cell-icon-nk_cell">
            <path d="M18.5 12 L15.25 17.9 L8.75 17.9 L5.5 12 L8.75 6.1 L15.25 6.1 Z" />
          </g>

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

          {/* High-inflammation glow filter */}
          <filter id="glow-red-hot" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Connection lines */}
        {edges.map(({ from, to }) => (
          <line
            key={`${from.id}-${to.id}`}
            x1={from.position.x} y1={from.position.y}
            x2={to.position.x}   y2={to.position.y}
            stroke="#1e293b" strokeWidth="2" opacity="0.6"
          />
        ))}

        {/* Nodes */}
        {nodeList.map(node => {
          const cx = node.position.x;
          const cy = node.position.y;
          const gt = groundTruthNodeStates?.[node.id];
          const inflammPct = (gt?.inflammation ?? 0) / 100;
          const { fill, stroke } = inflammationStyle(inflammPct);
          const isSelected = node.id === selectedNodeId;
          const { rings, unknownCount } = getPathogenDisplay(node.id, groundTruthNodeStates);
          const cellDots = getCellDots(node.id, deployedCells);
          const isHighInflamm = inflammPct >= 0.65;

          // Surveillance-staleness pips
          const pipCount = Math.min(MAX_PIPS, gt?.turnsSinceLastClear ?? 0);

          const ringBase = NODE_R + 5;
          const ringStep = 6;
          const outerRingR = rings.length > 0 ? ringBase + (rings.length - 1) * ringStep : NODE_R;
          const selectR = outerRingR + 6;

          const words = node.label.split(' ');

          return (
            <g
              key={node.id}
              onClick={() => onSelectNode(node.id === selectedNodeId ? null : node.id)}
              onContextMenu={e => { e.preventDefault(); onNodeContextMenu?.(node.id, e.shiftKey); }}
              onMouseEnter={e => { setHoveredNode({ nodeId: node.id, x: e.clientX, y: e.clientY }); onNodeHoverStart?.(node.id); }}
              onMouseLeave={() => { setHoveredNode(h => h?.nodeId === node.id ? null : h); onNodeHoverEnd?.(); }}
              onMouseMove={e => setHoveredNode(h => h?.nodeId === node.id ? { ...h, x: e.clientX, y: e.clientY } : h)}
              className="cursor-pointer"
            >
              {/* Selection brackets */}
              {isSelected && (() => {
                const bR = selectR;
                const arm = 7;
                const d = [
                  `M ${(cx - bR + arm).toFixed(1)} ${(cy - bR).toFixed(1)} L ${(cx - bR).toFixed(1)} ${(cy - bR).toFixed(1)} L ${(cx - bR).toFixed(1)} ${(cy - bR + arm).toFixed(1)}`,
                  `M ${(cx + bR - arm).toFixed(1)} ${(cy - bR).toFixed(1)} L ${(cx + bR).toFixed(1)} ${(cy - bR).toFixed(1)} L ${(cx + bR).toFixed(1)} ${(cy - bR + arm).toFixed(1)}`,
                  `M ${(cx + bR - arm).toFixed(1)} ${(cy + bR).toFixed(1)} L ${(cx + bR).toFixed(1)} ${(cy + bR).toFixed(1)} L ${(cx + bR).toFixed(1)} ${(cy + bR - arm).toFixed(1)}`,
                  `M ${(cx - bR + arm).toFixed(1)} ${(cy + bR).toFixed(1)} L ${(cx - bR).toFixed(1)} ${(cy + bR).toFixed(1)} L ${(cx - bR).toFixed(1)} ${(cy + bR - arm).toFixed(1)}`,
                ].join(' ');
                return <path d={d} fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" opacity="0.95" />;
              })()}

              {/* High-inflammation outer glow ring (pulsing via CSS animation) */}
              {isHighInflamm && (
                <circle
                  cx={cx} cy={cy} r={NODE_R + 3}
                  fill="none"
                  stroke={stroke}
                  strokeWidth="3"
                  className="inflammation-pulse"
                  filter="url(#glow-red-hot)"
                />
              )}

              {/* Pathogen arc rings */}
              {rings.map((ring, i) => {
                const r = ringBase + i * ringStep;
                if (!arcPath(cx, cy, r, ring.loadPct)) return null;

                // Determine fill extent and growth segment based on projection
                let fillPct = ring.loadPct;
                let growthPct = null; // if set, extra flashing segment from loadPct to here
                if (!ring.dashed) {
                  const pathProj = projections?.nodes?.[node.id]?.pathogenDeltas?.[ring.uid];
                  if (pathProj && Math.abs(pathProj.delta) >= 0.5) {
                    const deltaPct = pathProj.delta / 100;
                    if (deltaPct > 0) {
                      growthPct = Math.min(0.999, ring.loadPct + deltaPct);
                    } else {
                      fillPct = Math.max(0.001, ring.loadPct + deltaPct);
                    }
                  }
                }

                const fillD = arcPath(cx, cy, r, fillPct);
                const growthD = growthPct !== null ? arcSegment(cx, cy, r, ring.loadPct, growthPct) : null;
                // Hollow band always at current loadPct — the "this turn" border
                const bandD = !ring.dashed ? hollowArcBand(cx, cy, r, 0, ring.loadPct, 1.5) : null;

                return (
                  <g key={ring.uid ?? i}>
                    {/* Stable fill arc */}
                    {fillD && (
                      <path
                        d={fillD}
                        fill="none"
                        stroke={ring.color}
                        strokeWidth={ring.dashed ? 1.5 : 3}
                        strokeLinecap="round"
                        strokeDasharray={ring.dashArray}
                        opacity={ring.dashed ? 0.55 : 0.9}
                        filter={ring.dashed ? undefined : `url(#glow-${ring.color.slice(1)})`}
                      />
                    )}
                    {/* Growth segment — flashing, beneath the border band */}
                    {growthD && (
                      <path
                        d={growthD}
                        fill="none"
                        stroke={ring.color}
                        strokeWidth={3}
                        strokeLinecap="round"
                        className="forecast-pulse"
                        filter={`url(#glow-${ring.color.slice(1)})`}
                      />
                    )}
                    {/* Hollow border band — current-turn boundary, drawn on top */}
                    {!ring.dashed && ring.loadPct >= 0.999 ? (
                      <>
                        <circle cx={cx} cy={cy} r={r + 1.5} fill="none" stroke={darkenColor(ring.color)} strokeWidth={1} opacity={0.9} />
                        <circle cx={cx} cy={cy} r={r - 1.5} fill="none" stroke={darkenColor(ring.color)} strokeWidth={1} opacity={0.9} />
                      </>
                    ) : bandD && (
                      <path d={bandD} fill="none" stroke={darkenColor(ring.color)} strokeWidth={1} opacity={0.9} />
                    )}
                  </g>
                );
              })}


              {/* Dark background circle */}
              <circle cx={cx} cy={cy} r={NODE_R} fill="#050d18" />

              {/* Inflammation fill, clipped to tissue integrity */}
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
                strokeWidth={node.isBottleneck ? 3 : 2}
              />

              {/* Surveillance-staleness pips — small white dots around inside of circle */}
              {pipCount > 0 && Array.from({ length: pipCount }).map((_, i) => {
                const angle = (i / MAX_PIPS) * 2 * Math.PI - Math.PI / 2;
                const pr = NODE_R - 4;
                return (
                  <circle
                    key={`pip-${i}`}
                    cx={(cx + pr * Math.cos(angle)).toFixed(2)}
                    cy={(cy + pr * Math.sin(angle)).toFixed(2)}
                    r="0.7"
                    fill="white"
                    opacity={0.25 + 0.85 * (i / (MAX_PIPS - 1))}
                    className="pointer-events-none"
                  />
                );
              })}

              {/* Node label */}
              {words.length > 1 ? (
                <text
                  textAnchor="middle"
                  fontFamily="monospace"
                  fontWeight={node.isHQ ? '700' : '600'}
                  fill={node.isHQ ? '#a78bfa' : stroke}
                  className="pointer-events-none select-none"
                >
                  <tspan x={cx} y={cy - 4} fontSize="8">{words[0]}</tspan>
                  <tspan x={cx} dy="10"    fontSize="8">{words[1]}</tspan>
                </text>
              ) : (
                <text
                  x={cx} y={cy + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="9"
                  fontFamily="monospace"
                  fontWeight={node.isHQ ? '700' : '600'}
                  fill={node.isHQ ? '#a78bfa' : stroke}
                  className="pointer-events-none select-none"
                >
                  {node.label}
                </text>
              )}

              {/* Unknown-pathogen badge */}
              {unknownCount > 0 && (
                <g>
                  <circle
                    cx={cx - NODE_R + 5} cy={cy - NODE_R + 4}
                    r={7} fill="#78350f" stroke="#d97706" strokeWidth="1"
                  />
                  <text
                    x={cx - NODE_R + 5} y={cy - NODE_R + 4}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize="7" fontFamily="monospace" fontWeight="bold"
                    fill="#fde68a"
                    className="pointer-events-none select-none"
                  >
                    {unknownCount}
                  </text>
                </g>
              )}

              {/* Friendly cell icons — always full opacity */}
              {cellDots.map((cell, i) => {
                const angle = (i / Math.max(1, cellDots.length)) * 2 * Math.PI - Math.PI / 2;
                const dr = NODE_R - 8;
                const iconSize = 10; // rendered size in SVG units
                const iconX = cx + dr * Math.cos(angle);
                const iconY = cy + dr * Math.sin(angle);
                const inTransit = cell.phase === 'outbound' || cell.phase === 'returning';
                const iconColor = CELL_CONFIG[cell.type]?.color ?? '#888';
                const scale = iconSize / 24;
                return (
                  <use
                    key={cell.id}
                    href={`#cell-icon-${cell.type}`}
                    fill={iconColor}
                    opacity={inTransit ? 0.35 : 0.95}
                    transform={`translate(${(iconX - iconSize / 2).toFixed(2)}, ${(iconY - iconSize / 2).toFixed(2)}) scale(${scale.toFixed(4)})`}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>

      {/* Hover tooltip — desktop only (mobile uses node bar instead) */}
      {hoveredNode && (
        <div className="hidden md:block">
          <NodeTooltip
            nodeId={hoveredNode.nodeId}
            gtNodeStates={groundTruthNodeStates}
            x={hoveredNode.x}
            y={hoveredNode.y}
          />
        </div>
      )}
    </div>
  );
}

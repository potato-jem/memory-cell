import { getEffectiveConnections, getEffectiveExitCost } from './runModifiers.js';
import { CELL_CONFIG } from './cellConfig.js';

export const NODES = {

  // ── Production nodes ─────────────────────────────────────────────

  BONE_MARROW: {
    id: 'BONE_MARROW',
    label: 'Bone Marrow',
    position: { x: 85, y: 295 },
    connections: ['BLOOD'],
    signalTravelCost: 1,
    damageWeight: 2.5,
    isBottleneck: false,
    isCellSource: true,
    isHQ: false,
    isSystemic: false,
  },

  // ── Immune HQ ─────────────────────────────────────────────────────────────
  SPLEEN: {
    id: 'SPLEEN',
    label: 'Spleen',
    position: { x: 85, y: 125 },
    connections: ['BLOOD'],
    signalTravelCost: 0,  // HQ — free to leave
    damageWeight: 2.0,
    isBottleneck: false,
    isCellSource: false,
    isHQ: true,
    isSystemic: false,
  },

  // ── Body regions ──────────────────────────────────────────────────────────
  THROAT: {
    id: 'THROAT',
    label: 'Throat',
    position: { x: 335, y: 85 },
    connections: ['CHEST'],
    signalTravelCost: 1,
    damageWeight: 1.2,
    isBottleneck: false,
    isCellSource: false,
    isHQ: false,
    isSystemic: false,
  },
  CHEST: {
    id: 'CHEST',
    label: 'Chest',
    position: { x: 210, y: 85 },
    connections: ['THROAT', 'BLOOD'],
    signalTravelCost: 1,
    damageWeight: 1.5,
    isBottleneck: false,
    isCellSource: false,
    isHQ: false,
    isSystemic: false,
  },
  LIVER: {
    id: 'LIVER',
    label: 'Liver',
    position: { x: 210, y: 335 },
    connections: ['GUT', 'BLOOD'],
    signalTravelCost: 1,
    damageWeight: 1.8,
    isBottleneck: false,
    isCellSource: false,
    isHQ: false,
    isSystemic: false,
  },
  BLOOD: {
    id: 'BLOOD',
    label: 'Blood',
    position: { x: 85, y: 210 },
    connections: ['SPLEEN', 'BONE_MARROW', 'CHEST', 'LIVER', 'MUSCLE'],
    signalTravelCost: 1,
    damageWeight: 2.0,
    isBottleneck: false,
    isCellSource: false,
    isHQ: false,
    isSystemic: true,
  },
  GUT: {
    id: 'GUT',
    label: 'Gut',
    position: { x: 335, y: 335 },
    connections: ['LIVER'],
    signalTravelCost: 1,
    damageWeight: 1.3,
    isBottleneck: false,
    isCellSource: false,
    isHQ: false,
    isSystemic: false,
  },
  MUSCLE: {
    id: 'MUSCLE',
    label: 'Muscle',
    position: { x: 210, y: 210 },
    connections: ['BLOOD', 'PERIPHERY'],
    signalTravelCost: 1,
    damageWeight: 1.0,
    isBottleneck: false,
    isCellSource: false,
    isHQ: false,
    isSystemic: false,
  },
  PERIPHERY: {
    id: 'PERIPHERY',
    label: 'Periphery',
    position: { x: 335, y: 210 },
    connections: ['MUSCLE'],
    signalTravelCost: 1,
    damageWeight: 0.8,
    isBottleneck: false,
    isCellSource: false,
    isHQ: false,
    isSystemic: false,
  },
};

export const NODE_IDS = Object.keys(NODES);
export const HQ_NODE_ID = 'SPLEEN'; // all cells deploy from here

// ── Dijkstra shortest path using signalTravelCost as edge weights ─────────────
// Cost is the EXIT cost of the node being left.
// SPLEEN has cost 0 (free departure from HQ); all others cost 1.

export function computePath(fromId, toId) {
  if (fromId === toId) return [fromId];

  const nodeIds = Object.keys(NODES);
  const dist = {};
  const prev = {};
  const unvisited = new Set(nodeIds);

  for (const id of nodeIds) dist[id] = Infinity;
  dist[fromId] = 0;

  while (unvisited.size > 0) {
    let u = null;
    for (const id of unvisited) {
      if (u === null || dist[id] < dist[u]) u = id;
    }
    if (dist[u] === Infinity || u === toId) break;
    unvisited.delete(u);

    const exitCost = NODES[u].signalTravelCost ?? 1;
    for (const connId of (NODES[u].connections ?? [])) {
      if (!unvisited.has(connId)) continue;
      const alt = dist[u] + exitCost;
      if (alt < dist[connId]) {
        dist[connId] = alt;
        prev[connId] = u;
      }
    }
  }

  const path = [];
  let cur = toId;
  while (cur !== undefined) {
    path.unshift(cur);
    cur = prev[cur];
  }
  return path[0] === fromId ? path : [fromId, toId];
}

// Sum of exit costs along path[fromIndex..path.length-2].
// This equals the number of turns needed (budget = 1/turn).
export function computePathCost(path, fromIndex = 0) {
  let cost = 0;
  for (let i = fromIndex; i < path.length - 1; i++) {
    cost += NODES[path[i]]?.signalTravelCost ?? 1;
  }
  return cost;
}

// ── Modifier-aware path computation ──────────────────────────────────────────
// Use these when runModifiers may include added/removed connections or exit cost changes.
// Falls back to standard computePath/computePathCost when no node modifiers are active.

export function computePathWithModifiers(fromId, toId, modifiers) {
  if (fromId === toId) return [fromId];
  if (!modifiers || Object.keys(modifiers.nodes ?? {}).length === 0) {
    return computePath(fromId, toId);
  }

  const nodeIds = Object.keys(NODES);
  const dist = {};
  const prev = {};
  const unvisited = new Set(nodeIds);

  for (const id of nodeIds) dist[id] = Infinity;
  dist[fromId] = 0;

  while (unvisited.size > 0) {
    let u = null;
    for (const id of unvisited) {
      if (u === null || dist[id] < dist[u]) u = id;
    }
    if (dist[u] === Infinity || u === toId) break;
    unvisited.delete(u);

    const baseExitCost = NODES[u].signalTravelCost ?? 1;
    const exitCost = getEffectiveExitCost(u, baseExitCost, modifiers);
    const baseConnections = NODES[u].connections ?? [];
    const connections = getEffectiveConnections(u, baseConnections, modifiers);

    for (const connId of connections) {
      if (!unvisited.has(connId)) continue;
      const alt = dist[u] + exitCost;
      if (alt < dist[connId]) {
        dist[connId] = alt;
        prev[connId] = u;
      }
    }
  }

  const path = [];
  let cur = toId;
  while (cur !== undefined) {
    path.unshift(cur);
    cur = prev[cur];
  }
  return path[0] === fromId ? path : [fromId, toId];
}

export function computePathCostWithModifiers(path, modifiers, fromIndex = 0) {
  if (!modifiers || Object.keys(modifiers.nodes ?? {}).length === 0) {
    return computePathCost(path, fromIndex);
  }
  let cost = 0;
  for (let i = fromIndex; i < path.length - 1; i++) {
    const baseExitCost = NODES[path[i]]?.signalTravelCost ?? 1;
    cost += getEffectiveExitCost(path[i], baseExitCost, modifiers);
  }
  return cost;
}

// ── Fog-of-war visibility ─────────────────────────────────────────────────────
// Returns a Set of nodeIds currently visible based on deployed cell positions.
// Scouts (dendritic) and patrols (neutrophil): current node only.
// Macrophages: current node + all adjacent nodes.
// Only 'arrived' cells grant adjascent visibility — transit cells do not.

export function computeVisibility(deployedCells) {
  const visible = new Set();
  for (const cell of Object.values(deployedCells)) {
    visible.add(cell.nodeId);
    //only provide adjascent visibility when still
    if (cell.phase !== 'arrived') continue;
    if (CELL_CONFIG[cell.type]?.coversAdjacentNodes) {
      for (const adjId of (NODES[cell.nodeId]?.connections ?? [])) {
        visible.add(adjId);
      }
    }
  }
  return visible;
}


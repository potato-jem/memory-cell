// The 9 body nodes.
// Production leaves connect only to Spleen.
// Spleen is HQ — all cells deploy from here.

export const NODES = {

  // ── Production nodes (leaves) ─────────────────────────────────────────────
  // THYMUS: {
  //   id: 'THYMUS',
  //   label: 'Thymus',
  //   position: { x: 60, y: 100 },
  //   connections: ['SPLEEN'],
  //   signalSpeed: 2,
  //   damageWeight: 1.8,
  //   isBottleneck: false,
  //   isCellSource: true,
  //   isHQ: false,
  //   isSystemic: false,
  // },
  BONE_MARROW: {
    id: 'BONE_MARROW',
    label: 'Bone Marrow',
    position: { x: 0, y: 200 },
    connections: ['SPLEEN'],
    signalSpeed: 3,
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
    position: { x: 60, y: 200 },
    connections: ['BONE_MARROW', 'CHEST', 'LIVER', 'BLOOD'],
    signalSpeed: 1,
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
    position: { x: 255, y: 135 },
    connections: ['CHEST'],
    signalSpeed: 1,
    damageWeight: 1.2,
    isBottleneck: false,
    isCellSource: false,
    isHQ: false,
    isSystemic: false,
  },
  CHEST: {
    id: 'CHEST',
    label: 'Chest',
    position: { x: 160, y: 135 },
    connections: ['SPLEEN', 'THROAT', 'BLOOD'],
    signalSpeed: 1,
    damageWeight: 1.5,
    isBottleneck: false,
    isCellSource: false,
    isHQ: false,
    isSystemic: false,
  },
  LIVER: {
    id: 'LIVER',
    label: 'Liver',
    position: { x: 160, y: 270 },
    connections: ['GUT', 'SPLEEN', 'BLOOD'],
    signalSpeed: 2,
    damageWeight: 1.8,
    isBottleneck: false,
    isCellSource: false,
    isHQ: false,
    isSystemic: false,
  },
  BLOOD: {
    id: 'BLOOD',
    label: 'Blood',
    position: { x: 160, y: 200 },
    connections: ['SPLEEN', 'CHEST', 'LIVER', 'PERIPHERY'],
    signalSpeed: 1,
    damageWeight: 2.0,
    isBottleneck: false,
    isCellSource: false,
    isHQ: false,
    isSystemic: true,
  },
  GUT: {
    id: 'GUT',
    label: 'Gut',
    position: { x: 255, y: 270 },
    connections: ['LIVER'],
    signalSpeed: 2,
    damageWeight: 1.3,
    isBottleneck: false,
    isCellSource: false,
    isHQ: false,
    isSystemic: false,
  },
  PERIPHERY: {
    id: 'PERIPHERY',
    label: 'Periphery',
    position: { x: 255, y: 200 },
    connections: ['BLOOD'],
    signalSpeed: 2,
    damageWeight: 0.8,
    isBottleneck: false,
    isCellSource: false,
    isHQ: false,
    isSystemic: false,
  },
};

export const NODE_IDS = Object.keys(NODES);
export const HQ_NODE_ID = 'SPLEEN'; // all cells deploy from here
export const getNode = (id) => NODES[id];
export const getConnectedNodes = (id) => NODES[id]?.connections.map(cid => NODES[cid]) ?? [];

// BFS shortest-path hop distances between all node pairs — computed once at load.
function computeAllHopDistances() {
  const distances = {};
  for (const startId of Object.keys(NODES)) {
    distances[startId] = { [startId]: 0 };
    const queue = [startId];
    while (queue.length > 0) {
      const nodeId = queue.shift();
      for (const connId of NODES[nodeId].connections) {
        if (distances[startId][connId] === undefined) {
          distances[startId][connId] = distances[startId][nodeId] + 1;
          queue.push(connId);
        }
      }
    }
  }
  return distances;
}

const HOP_DISTANCES = computeAllHopDistances();

export function getHopDistance(fromId, toId) {
  return HOP_DISTANCES[fromId]?.[toId] ?? 99;
}

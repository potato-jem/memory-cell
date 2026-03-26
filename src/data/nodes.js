// The 10 body nodes of the lymphatic network.
// Positions updated for 320x520 viewBox (larger map).

export const NODES = {
  THROAT: {
    id: 'THROAT',
    label: 'Throat',
    position: { x: 160, y: 80 },
    connections: ['LUNGS', 'LEFT_LYMPH', 'RIGHT_LYMPH'],
    signalSpeed: 1,
    damageWeight: 1.2,
    isBottleneck: false,
    isCellSource: false,
    isHQ: false,
    isSystemic: false,
  },
  LUNGS: {
    id: 'LUNGS',
    label: 'Lungs',
    position: { x: 160, y: 155 },
    connections: ['THROAT', 'LEFT_LYMPH', 'RIGHT_LYMPH', 'BLOOD'],
    signalSpeed: 1,
    damageWeight: 1.5,
    isBottleneck: false,
    isCellSource: false,
    isHQ: false,
    isSystemic: false,
  },
  LEFT_LYMPH: {
    id: 'LEFT_LYMPH',
    label: 'L. Lymph',
    position: { x: 85, y: 190 },
    connections: ['THROAT', 'LUNGS', 'SPLEEN', 'PERIPHERAL'],
    signalSpeed: 1,
    damageWeight: 1.0,
    isBottleneck: true,
    isCellSource: false,
    isHQ: false,
    isSystemic: false,
  },
  RIGHT_LYMPH: {
    id: 'RIGHT_LYMPH',
    label: 'R. Lymph',
    position: { x: 235, y: 190 },
    connections: ['THROAT', 'LUNGS', 'SPLEEN', 'PERIPHERAL'],
    signalSpeed: 1,
    damageWeight: 1.0,
    isBottleneck: true,
    isCellSource: false,
    isHQ: false,
    isSystemic: false,
  },
  LIVER: {
    id: 'LIVER',
    label: 'Liver',
    position: { x: 105, y: 265 },
    connections: ['GUT', 'SPLEEN', 'BLOOD'],
    signalSpeed: 2,
    damageWeight: 1.8,
    isBottleneck: false,
    isCellSource: false,
    isHQ: false,
    isSystemic: false,
  },
  SPLEEN: {
    id: 'SPLEEN',
    label: 'Spleen',
    position: { x: 215, y: 265 },
    connections: ['GUT', 'LIVER', 'LEFT_LYMPH', 'RIGHT_LYMPH', 'BLOOD', 'BONE_MARROW'],
    signalSpeed: 1,
    damageWeight: 2.0,
    isBottleneck: false,
    isCellSource: false,
    isHQ: true,
    isSystemic: false,
  },
  GUT: {
    id: 'GUT',
    label: 'Gut',
    position: { x: 160, y: 310 },
    connections: ['LIVER', 'SPLEEN', 'BLOOD'],
    signalSpeed: 2,
    damageWeight: 1.3,
    isBottleneck: false,
    isCellSource: false,
    isHQ: false,
    isSystemic: false,
  },
  BLOOD: {
    id: 'BLOOD',
    label: 'Blood',
    position: { x: 160, y: 370 },
    connections: ['LUNGS', 'GUT', 'LIVER', 'SPLEEN', 'BONE_MARROW', 'PERIPHERAL'],
    signalSpeed: 1,
    damageWeight: 2.0,
    isBottleneck: false,
    isCellSource: false,
    isHQ: false,
    isSystemic: true,
  },
  BONE_MARROW: {
    id: 'BONE_MARROW',
    label: 'Bone Marrow',
    position: { x: 160, y: 440 },
    connections: ['SPLEEN', 'BLOOD'],
    signalSpeed: 3,
    damageWeight: 2.5,
    isBottleneck: false,
    isCellSource: true,
    isHQ: false,
    isSystemic: false,
  },
  PERIPHERAL: {
    id: 'PERIPHERAL',
    label: 'Peripheral',
    position: { x: 160, y: 500 },
    connections: ['LEFT_LYMPH', 'RIGHT_LYMPH', 'BLOOD'],
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

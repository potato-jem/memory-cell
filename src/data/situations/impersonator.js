// Situation: "The Impersonator" — molecular mimic
// A bacterial pathogen that has learned to present self-antigens.
// Early signals look clean. Then the cover breaks suddenly around turn 10-12.
// Key learning: a pattern of clean signals from a patrolled area that then suddenly
// shifts to threat signals is the mimic's tell.

export const IMPERSONATOR = {
  id: 'impersonator',
  name: 'The Impersonator',
  description: 'Periphery patrol returning clean. All clear. All clear. All— wait.',

  pathogen: {
    type: 'mimic',
    startingNode: 'PERIPHERY',
    startingStrength: 10,
    growthRatePerTurn: 4,
    spreadThreshold: 50,
    clearanceRatePerResponder: 12,
    spreadNodes: ['BLOOD'],
    mimicRevealThreshold: 40,   // strength at which mimic drops cover
  },

  signalAccuracyRate: 0.70,    // accuracy after reveal; before reveal, getSignalAccuracyForType returns 0.05

  falseAlarmRate: 0.10,

  availableResponders: ['responder', 'killer_t', 'b_cell', 'nk_cell'],

  turnLimit: 38,

  seededEvents: [
    {
      turn: 2,
      type: 'signal',
      nodeId: 'PERIPHERY',
      signalType: 'patrol_clear',
      confidence: 'medium',
      description: 'Patrol returns clean — mimic is hiding',
    },
    {
      turn: 4,
      type: 'signal',
      nodeId: 'PERIPHERY',
      signalType: 'patrol_clear',
      confidence: 'high',
      description: 'Another clean sweep — all self-markers verified',
    },
    {
      turn: 7,
      type: 'signal',
      nodeId: 'PERIPHERY',
      signalType: 'patrol_clear',
      confidence: 'medium',
      description: 'Third clean return — pattern seems safe',
    },
    {
      turn: 11,
      type: 'signal',
      nodeId: 'PERIPHERY',
      signalType: 'anomaly_detected',
      confidence: 'medium',
      description: 'Something changed — prior clean signals now suspect',
    },
    {
      turn: 12,
      type: 'signal',
      nodeId: 'PERIPHERY',
      signalType: 'threat_confirmed',
      confidence: 'high',
      description: 'Mimic cover blown — real pathogen signature now readable',
    },
    {
      turn: 16,
      type: 'spread_check',
      description: 'Mimic spreads to blood if peripheral strength >= spreadThreshold',
    },
    {
      turn: 20,
      type: 'signal',
      nodeId: 'BLOOD',
      signalType: 'anomaly_detected',
      confidence: 'low',
      description: 'Systemic signal if spread has occurred',
    },
  ],

  decisionPoints: [
    {
      turns: [2, 11],
      label: 'Clean Signal Phase',
      description: 'Three consecutive clean signals from a patrolled node should be reassuring — but for an experienced player, periodic clean patrol returns from the same node with no variation is itself a pattern.',
    },
    {
      turns: [11, 15],
      label: 'Reveal Response Window',
      description: 'Once the mimic drops cover, the pathogen is at significant strength. Immediate dendritic confirmation followed by Killer T deployment is the optimal response. You\'re behind.',
    },
    {
      turns: [15, 30],
      label: 'Spread Prevention',
      description: 'If the pathogen reached blood before you responded, it has systemic reach. Prioritise blood and both lymph clusters simultaneously.',
    },
  ],
};

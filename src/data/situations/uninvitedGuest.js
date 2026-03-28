// Situation: "Uninvited Guest"
// A bacterial infection taking hold in the gut.
// Designed to introduce all four failure modes as reachable paths.
// This is the only situation in Layer 1.

export const UNINVITED_GUEST = {
  id: 'uninvitedGuest',
  name: 'Uninvited Guest',
  description: 'Something has slipped through the gut lining. Early signals are weak. The question is whether you catch it before it spreads.',

  // Pathogen starting state
  pathogen: {
    type: 'bacterial',
    startingNode: 'GUT',
    startingStrength: 8,        // out of 100
    growthRatePerTurn: 4,       // strength added per turn at active node if unchecked
    spreadThreshold: 45,        // strength at which spread to adjacent node triggers
    clearanceRatePerResponder: 12, // strength removed per turn per responder present
    spreadNodes: ['LIVER', 'BLOOD'], // adjacent nodes it can spread to (in order of preference)
  },

  // Signal accuracy: probability a real threat generates a signal this turn
  signalAccuracyRate: 0.70,

  // False alarm rate: probability a patrolled clean node generates a false alarm
  falseAlarmRate: 0.15,

  // Responder deployment options for this situation
  availableResponders: ['responder'],

  // Turn limit — run ends in loss if coherence still positive but turns exhausted
  turnLimit: 40,

  // Win condition: pathogen fully cleared (strength 0 everywhere)
  // Lose conditions:
  //   - coherence drops to 0 (catastrophic system failure)
  //   - turn limit reached with active pathogen (slow collapse)

  // Seeded events — mutate ground truth at specific turns to shape the narrative arc.
  // Signals emerge naturally when cells visit and roll detection against this ground truth.
  //
  // Types:
  //   strengthen_pathogen  — add `amount` strength to an existing infected node
  //   spawn_pathogen       — create a new infection site (only if node is currently clean)
  seededEvents: [
    {
      turn: 6,
      type: 'strengthen_pathogen',
      nodeId: 'GUT',
      amount: 15,
      description: 'Infection accelerates — gut bacteria overwhelm initial defences',
    },
    {
      turn: 14,
      type: 'spawn_pathogen',
      nodeId: 'LIVER',
      strength: 12,
      description: 'Infection breaches gut lining and seeds the liver',
    },
  ],

  // Narrative annotations for post-mortem
  // Maps turn ranges to key decision windows
  decisionPoints: [
    {
      turns: [2, 6],
      label: 'Early Signal Window',
      description: 'The gut anomaly signal arrived early. Deploying a dendritic cell here for ground truth would have given you confirmed intelligence by turn 6.',
    },
    {
      turns: [7, 14],
      label: 'Investigation vs Response Window',
      description: 'Between turns 7-14 you had time to investigate before the infection hit its spread threshold. Deploying a responder without dendritic confirmation here risks collateral damage.',
    },
    {
      turns: [14, 22],
      label: 'Spread Window',
      description: 'If the infection crossed the spread threshold, it moved to the liver around turn 14. Two active nodes now requires resource split.',
    },
    {
      turns: [23, 40],
      label: 'Late Game',
      description: 'By now the situation is either under control or escalating toward coherence collapse. Suppressing valid signals in this window is the key over-suppression error.',
    },
  ],
};

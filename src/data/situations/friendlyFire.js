// Situation: "Friendly Fire" — autoimmune event
// The immune response itself is the threat. Triggered by prior over-response.
// Key learning: suppress, don't amplify. Recall cells. The correct action is inaction.
// This is the hardest situation for players who have learned to always respond aggressively.

export const FRIENDLY_FIRE = {
  id: 'friendlyFire',
  name: 'Friendly Fire',
  description: 'Something is activating your own cells at the left lymph cluster. The signals look like clearance. They\'re not.',

  pathogen: {
    type: 'autoimmune',
    startingNode: 'LEFT_LYMPH',
    startingStrength: 15,        // starts higher — autoimmune is already active
    growthRatePerTurn: 3,        // grows with each responder deployed
    spreadThreshold: 60,
    clearanceRatePerResponder: 0, // "pathogen" cannot be cleared by responders — only by recalling them
    spreadNodes: ['THROAT', 'LUNGS', 'SPLEEN'],
    // Special: autoimmune strength INCREASES when responders are deployed
    respondsToDeployment: true,
  },

  signalAccuracyRate: 0.90,      // autoimmune signals well — your own cells are causing it
  falseAlarmRate: 0.05,

  availableResponders: ['responder', 'killer_t', 'b_cell', 'nk_cell'],

  turnLimit: 30,

  seededEvents: [
    {
      turn: 1,
      type: 'signal',
      nodeId: 'LEFT_LYMPH',
      signalType: 'anomaly_detected',
      confidence: 'medium',
      description: 'NK cell activation signal — looks like a real threat initially',
    },
    {
      turn: 2,
      type: 'signal',
      nodeId: 'LEFT_LYMPH',
      signalType: 'collateral_damage',
      confidence: 'low',
      description: 'First self-damage signal — could be normal response residue',
    },
    {
      turn: 4,
      type: 'signal',
      nodeId: 'LEFT_LYMPH',
      signalType: 'collateral_damage',
      confidence: 'medium',
      description: 'Self-damage increasing — the pattern is becoming clear',
    },
    {
      turn: 6,
      type: 'signal',
      nodeId: 'LEFT_LYMPH',
      signalType: 'anomaly_detected',
      confidence: 'high',
      description: 'Self-antigen conflict signal — your cells are the problem',
    },
    {
      turn: 10,
      type: 'signal',
      nodeId: 'THROAT',
      signalType: 'collateral_damage',
      confidence: 'medium',
      description: 'Autoimmune cascade spreading if not suppressed',
    },
  ],

  decisionPoints: [
    {
      turns: [1, 5],
      label: 'Recognition Window',
      description: 'Collateral damage signals appearing without a confirmed threat is the key pattern. The autoimmune cascade is happening — additional deployment makes it worse.',
    },
    {
      turns: [5, 12],
      label: 'Suppress vs Respond',
      description: 'Forwarding or amplifying these signals makes the situation worse. Suppress them. Recall any deployed responders. Inaction is correct action here.',
    },
    {
      turns: [12, 25],
      label: 'Cascade Control',
      description: 'If the cascade has spread, suppressing signals at all active nodes is needed. B-cells can help coordinate a de-escalation response.',
    },
  ],

  // Win condition hint for autoimmune: player must suppress/recall rather than respond
  winHint: 'Suppress signals, recall responders, do not amplify. The threat is your own immune system.',
};

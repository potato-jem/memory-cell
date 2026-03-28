// Situation: "Silent Invader" — viral infection
// Virus enters through throat, spreads faster than bacteria, hides during replication.
// Key learning: viral signals are intracellular and go QUIET during peak replication.
// The silence around turns 5-12 is the tell — experienced players learn to respond during it.

export const SILENT_INVADER = {
  id: 'silentInvader',
  name: 'Silent Invader',
  description: 'Cellular distress signals from the throat. Then silence. The silence is what should worry you.',

  pathogen: {
    type: 'viral',
    startingNode: 'THROAT',
    startingStrength: 6,
    growthRatePerTurn: 5,        // faster than bacterial
    spreadThreshold: 35,          // lower threshold — viral spreads earlier
    clearanceRatePerResponder: 12, // standard clearance
    spreadNodes: ['CHEST', 'SPLEEN', 'BLOOD'],
  },

  signalAccuracyRate: 0.65,      // generally moderate
  falseAlarmRate: 0.12,

  availableResponders: ['responder', 'killer_t', 'nk_cell'],

  turnLimit: 35,                 // slightly shorter — viral is faster

  seededEvents: [
    {
      turn: 2,
      type: 'signal',
      nodeId: 'THROAT',
      signalType: 'anomaly_detected',
      confidence: 'low',
      description: 'First cellular stress signal — faint, intracellular character',
    },
    {
      turn: 3,
      type: 'signal',
      nodeId: 'THROAT',
      signalType: 'anomaly_detected',
      confidence: 'medium',
      description: 'Interferon marker — classic viral early signal',
    },
    // Turns 5-12: viral goes quiet (signalAccuracyRate drops to 0.35 via getSignalAccuracyForType)
    {
      turn: 8,
      type: 'signal',
      nodeId: 'CHEST',
      signalType: 'patrol_clear',
      confidence: 'medium',
      description: 'Lungs appear clear — but virus may already be there',
      isFalseAlarm: false, // accurate clear (virus hasn't spread yet if caught early)
    },
    {
      turn: 13,
      type: 'signal',
      nodeId: 'THROAT',
      signalType: 'threat_expanding',
      confidence: 'high',
      description: 'Viral load threshold crossed — cells now screaming',
    },
    {
      turn: 16,
      type: 'spread_check',
      description: 'Spread to lungs if throat strength >= spreadThreshold',
    },
    {
      turn: 22,
      type: 'signal',
      nodeId: 'CHEST',
      signalType: 'threat_confirmed',
      confidence: 'medium',
      description: 'Lungs now infected if spread occurred',
    },
  ],

  decisionPoints: [
    {
      turns: [2, 5],
      label: 'Early Interferon Window',
      description: 'The early interferon signal is your best warning. Deploying a dendritic cell here gives you high-confidence intel before the virus goes quiet.',
    },
    {
      turns: [5, 13],
      label: 'The Silence',
      description: 'Viral replication goes silent during this window. No signal does not mean no threat. This is when to act, not wait.',
    },
    {
      turns: [13, 20],
      label: 'Escalation Response',
      description: 'Once the virus resurfaces at high signal strength, spread is imminent. NK cells are effective here — they don\'t need dendritic confirmation.',
    },
  ],
};

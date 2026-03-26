// Situation: "Shadow Growth" — early cancer detection
// A malignant mass forming in the gut. Extremely quiet signals. Dendritic cell is essential.
// Key learning: cancer barely signals. The rare low-confidence anomalies are the only tells.
// Dendritic scout is the diagnostic breakthrough. Over-response causes autoimmune damage.

export const SHADOW_GROWTH = {
  id: 'shadowGrowth',
  name: 'Shadow Growth',
  description: 'The macrophages in the gut keep sending something. It\'s almost nothing. Almost.',

  pathogen: {
    type: 'cancer',
    startingNode: 'GUT',
    startingStrength: 5,
    growthRatePerTurn: 2,        // very slow — this is what makes it dangerous
    spreadThreshold: 70,          // high threshold — cancer spreads late but catastrophically
    clearanceRatePerResponder: 8, // lower — cancer hides from immune cells
    spreadNodes: ['LIVER', 'BLOOD', 'SPLEEN'],
  },

  signalAccuracyRate: 0.30,      // cancer barely signals
  falseAlarmRate: 0.20,          // macrophage noise is higher (gut is busy)

  availableResponders: ['responder', 'killer_t', 'b_cell', 'nk_cell'],

  turnLimit: 45,                 // longer window — but slow detection costs you

  seededEvents: [
    {
      turn: 3,
      type: 'signal',
      nodeId: 'GUT',
      signalType: 'anomaly_detected',
      confidence: 'low',
      description: 'First macrophage ambient signal — metabolic irregularity, probably nothing',
    },
    {
      turn: 6,
      type: 'signal',
      nodeId: 'LIVER',
      signalType: 'patrol_clear',
      confidence: 'medium',
      description: 'Liver clear — red herring patrol signal',
      isFalseAlarm: false,
    },
    {
      turn: 9,
      type: 'signal',
      nodeId: 'GUT',
      signalType: 'anomaly_detected',
      confidence: 'low',
      description: 'Second faint growth marker — still easy to dismiss',
    },
    {
      turn: 15,
      type: 'signal',
      nodeId: 'GUT',
      signalType: 'anomaly_detected',
      confidence: 'medium',
      description: 'Third signal, slightly clearer — atypical division pattern',
    },
    {
      turn: 25,
      type: 'signal',
      nodeId: 'GUT',
      signalType: 'threat_confirmed',
      confidence: 'medium',
      description: 'Growth now large enough to confirm — late but still treatable',
    },
    {
      turn: 35,
      type: 'spread_check',
      description: 'Cancer spreads if strength reaches threshold',
    },
  ],

  decisionPoints: [
    {
      turns: [3, 12],
      label: 'Pattern Recognition Window',
      description: 'Three low-confidence gut signals in 12 turns is a pattern. Deploy a dendritic cell. The absence of a dendritic confirmation here is the most common failure mode.',
    },
    {
      turns: [13, 25],
      label: 'Investigation vs Wait',
      description: 'The cancer is growing slowly. A dendritic cell dispatched here returns with high-confidence confirmation before the spread threshold. Waiting is not safe.',
    },
    {
      turns: [26, 40],
      label: 'Response Calibration',
      description: 'Cancer hides from NK cells (they look for stressed markers, not malignancy). Killer T-cells with dendritic backing are most effective. B-cells can coordinate clearance.',
    },
  ],
};

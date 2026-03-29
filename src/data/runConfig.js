// Run configuration — replaces individual situation files.
// Endless mode: pathogens spawn probabilistically rather than from a fixed script.
// Signal accuracy and false alarm rates are now global, not per-situation.

export const DEFAULT_RUN_CONFIG = {
  id: 'endless',
  name: 'Endless Run',

  // Signal accuracy: probability a real threat generates a signal this turn
  signalAccuracyRate: 0.70,

  // False alarm rate: probability a patrolled clean node generates a false alarm
  falseAlarmRate: 0.15,

  // Cell types the player can deploy (all available in endless mode)
  availableResponders: ['responder', 'killer_t', 'b_cell', 'nk_cell'],

  // Starting roster — provided ready at game start (token cost still applies)
  startingUnits: [
    { type: 'neutrophil', count: 2 },
    { type: 'macrophage', count: 1 },
  ],

  // Spawn schedule — probability spikes at specific turns.
  // These are defined in spawner.js directly. This field is for documentation
  // and future narrative event hooks.
  spawnSchedule: [
    { turn: 3,  note: 'Early bacterial spike — first real threat likely here' },
    { turn: 7,  note: 'General escalation window' },
    { turn: 15, note: 'Viral surge — killer T cells become important' },
    { turn: 25, note: 'Late-game pressure spike' },
  ],
};

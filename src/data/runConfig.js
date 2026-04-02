// Run configuration — replaces individual situation files.
// Endless mode: pathogens spawn probabilistically rather than from a fixed script.
// Signal accuracy and false alarm rates are now global, not per-situation.

export const DEFAULT_RUN_CONFIG = {
  id: 'endless',
  name: 'Endless Run',

  // Cell types the player can deploy (all available in endless mode)
  availableResponders: ['responder', 'killer_t', 'b_cell', 'nk_cell'],

  // Starting roster: defaults derive from CELL_CONFIG[type].startingCount.
  // Override here or via the start screen to customise. See gameState.js initGameState.

};

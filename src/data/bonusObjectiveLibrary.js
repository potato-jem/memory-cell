// Bonus Objective Library — optional challenges presented at the start of each run.
//
// Each objective:
//   id             — unique string
//   name           — short display name
//   description    — shown to player at run start and in MetaHUD
//   eligibleFor    — (metaState) => boolean — whether to include in selection pool
//   initTracking   — () => object — initial tracking state (stored on gameState)
//   updateTracking — (tracking, partialGameState) => object — called each turn in handleEndTurn
//   failedEarly    — (tracking, partialGameState) => boolean — mark failed before run ends
//   isComplete     — (tracking, finalGameState) => boolean — evaluated at run end
//
// Rewards are always modifier picks (canBeChosenAs: ['bonusObjectiveReward']).
// The BetweenRunScreen presents 1-of-3 picks for each completed objective.

export const BONUS_OBJECTIVE_LIBRARY = [

  {
    id: 'no_fever',
    name: 'Cool Head',
    description: 'Win without activating Fever',
    eligibleFor: () => true,
    initTracking: () => ({ feverUsed: false }),
    updateTracking: (tracking, gs) => ({
      feverUsed: tracking.feverUsed || gs.fever?.active === true,
    }),
    failedEarly: (tracking) => tracking.feverUsed,
    isComplete: (tracking, gs) => gs.phase === 'won' && !tracking.feverUsed,
  },

  {
    id: 'speed_run',
    name: 'Swift Response',
    description: 'Win within 20 turns',
    eligibleFor: () => true,
    initTracking: () => ({}),
    updateTracking: (t) => t,
    failedEarly: (_, gs) => gs.phase === 'playing' && gs.turn > 20,
    isComplete: (_, gs) => gs.phase === 'won' && gs.turn <= 20,
  },

  {
    id: 'no_dendritic',
    name: 'Self-Reliant',
    description: 'Win without deploying any Dendritic cells',
    eligibleFor: () => true,
    initTracking: () => ({ used: false }),
    updateTracking: (tracking, gs) => ({
      used: tracking.used ||
        Object.values(gs.deployedCells ?? {}).some(
          c => c.type === 'dendritic' && c.phase !== 'ready'
        ),
    }),
    failedEarly: (tracking) => tracking.used,
    isComplete: (tracking, gs) => gs.phase === 'won' && !tracking.used,
  },

  {
    id: 'no_scars',
    name: 'Untouched',
    description: 'Win without acquiring any scars',
    eligibleFor: () => true,
    initTracking: () => ({}),
    updateTracking: (t) => t,
    failedEarly: (_, gs) => (gs.scars?.length ?? 0) > 0,
    isComplete: (_, gs) => gs.phase === 'won' && (gs.scars?.length ?? 0) === 0,
  },

  {
    id: 'high_integrity',
    name: 'Pristine',
    description: 'Win with systemic integrity above 80',
    eligibleFor: () => true,
    initTracking: () => ({}),
    updateTracking: (t) => t,
    failedEarly: () => false,
    isComplete: (_, gs) => gs.phase === 'won' && (gs.systemicIntegrity ?? 0) >= 80,
  },

];

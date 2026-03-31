# Simulation Harness — Architecture

## What this is

A headless Node-runnable harness for balance testing. Runs complete games programmatically,
records structured logs, and produces summary reports. No browser, no React, no Vite.

---

## Game Loop (from source audit)

The full end-turn sequence in `src/state/actions.js::handleEndTurn`:

1. **Token capacity regen** — every `TOKEN_CAPACITY_REGEN_INTERVAL` ticks, capacity +1 (cap 20)
2. **`advanceCells`** — cells advance along paths; emits `{updatedCells, events, nodesVisited}`
3. **`runDetectionPhase`** — recon cells fire detection rolls against current GT, updating
   `detected_level` / `perceived_type` on pathogen instances *before* GT advances
4. **`rollSpawns`** — probabilistic new pathogen spawns
5. **`advanceGroundTruth`** — pathogen growth/clearance/spread, inflammation, tissue integrity
6. **`startReturnForClearedNodes`** — attack cells at cleared nodes begin returning to HQ
7. **Visibility stamp** — `lastKnownInflammation`, `lastKnownLoad`, `turnsSinceLastVisible` stamped
8. **`assignPatrolDestinations`** — patrols route toward stalest nodes
9. **`computeSystemicStress`** — new stress from inflammation, low integrity, fever, toxins
10. **`applySystemicIntegrityHits`** — integrity -= 1/3/5 when stress ≥ 80/90/100
11. **`computeNewScars`** — permanent scarring when integrity drops
12. **Token accounting** — recalculate `tokensInUse` / `attentionTokens`
13. **Loss check** — `isSystemCollapsed(integrity)` → phase = 'lost'

**Player actions (pre-turn):** `TRAIN_CELL`, `DEPLOY_FROM_ROSTER`, `RECALL_UNIT`,
`DECOMMISSION_CELL`, `TOGGLE_FEVER`, `APPLY_MODIFIER`. These update state immediately
(no turn advance). The strategy interface calls `gameReducer(state, action)` for each.

**Win condition:** None — the game is an endless survival run. Outcomes are `loss`
(systemic integrity ≤ 0) or `timeout` (hit the turn ceiling).

---

## State Shape

```
GameState {
  runConfig,
  groundTruth: {
    nodeStates: { [nodeId]: NodeState },
    spreadHistory: [],
  },
  deployedCells: { [cellId]: CellState },
  tick, turn,
  tokenCapacity, tokensInUse, attentionTokens,
  systemicStress,      // 0-100 pressure input (NOT health)
  systemicIntegrity,   // 0-100 actual loss condition
  systemicStressHistory: [{ turn, stress, integrity }],
  fever: { active: bool },
  scars,
  runModifiers,
  phase,               // 'playing' | 'lost'
  lossReason,
  postMortem,
  selectedNodeId,
}

NodeState {
  pathogens: PathogenInstance[],
  immune: uid[],
  inflammation: 0-100,
  tissueIntegrity: 0-100,
  tissueIntegrityCeiling: 0-100,
  lowestIntegrityReached: 0-100,
  isWalledOff: bool,
  immuneSuppressed: bool,
  transitPenalty: int,
  lastKnownInflammation?: number,
  lastKnownLoad?: number,
  turnsSinceLastVisible?: number,
}

PathogenInstance {
  uid,
  type,
  actualLoad,          // 0-100
  detected_level,      // 'none' | 'unknown' | 'threat' | 'misclassified' | 'classified'
  perceived_type,      // string | null
}

CellState {
  id, type, phase,     // 'training' | 'ready' | 'outbound' | 'arrived' | 'returning'
  nodeId,              // current position
  destNodeId,          // final destination (transit only)
  path, pathIndex,
  ...
}
```

---

## Modules Relevant to the Harness

### Directly importable (pure JS, no React)

| Module | Used for |
|---|---|
| `src/state/gameState.js` | `initGameState()`, `GAME_PHASES` |
| `src/state/actions.js` | `gameReducer()`, `ACTION_TYPES` |
| `src/data/cellConfig.js` | `CELL_CONFIG`, cost/role lookups for strategy logic |
| `src/data/nodes.js` | `NODE_IDS`, `NODES`, `HQ_NODE_ID` for strategy logic |
| `src/data/pathogens.js` | `PATHOGEN_REGISTRY`, `nodeHasActivePathogen` |
| `src/engine/cells.js` | `nodeHasClassifiedPathogen` (for Killer T gating) |

### No extraction needed

All game logic in `src/engine/` and `src/data/` is pure functions with zero React or browser
dependencies. The React `useReducer` in `GameShell.jsx` is the only integration point.
The harness bypasses it entirely and calls `gameReducer` directly.

---

## RNG and Reproducibility

`Math.random` is called directly (not passed as a parameter) in:
- `src/data/detection.js` — `performDetection`, `upgradeDetectionLevel`, `getWrongId`
- `src/engine/spawner.js` — `rollSpawns` accepts an `rng` param but `actions.js` passes
  `Math.random` to it

**Approach:** `simulation/engine.js` monkey-patches `Math.random` for the duration of each
game run using a seeded PRNG (`simulation/rng.js`), then restores the original. This is the
minimal approach that achieves seed-reproducibility without touching any existing modules.

**Assumption:** Module-level mutable state in `cells.js` (`_cellIdCounter`) increments
globally across runs. Cell IDs are not reproducible across separate `runGame` calls with the
same seed. This is acceptable — cell IDs are identifiers, not balance-relevant values.

---

## Extraction Plan

No extraction needed. The harness imports directly from `src/`:

```
simulation/
  ARCHITECTURE.md   ← this file
  rng.js            ← seeded PRNG (mulberry32)
  engine.js         ← runGame() + state summarizers
  strategies.js     ← random, greedy, conservative
  run.js            ← CLI entry point + reporter
```

---

## Ambiguities and Assumptions

1. **No win condition.** The game is an endless run. Outcomes are `loss` or `timeout`.
   `timeout` is treated as "survived" for reporting purposes.

2. **Strategy receives full game state**, including `groundTruth` (the hidden simulation).
   This is intentional for balance testing — strategies *should* be omniscient so they
   exercise the mechanics, not the information-hiding. Real players only see `detected_level`.
   A future extension could wrap state to expose only the perceived view.

3. **Pre-turn action limit of 100** per turn prevents infinite loops from misbehaving
   strategies. After 100 non-END_TURN actions, the engine forces END_TURN.

4. **Fever actions are included in legal moves** but strategies must manage their own
   fever toggle logic to avoid oscillating every turn.

5. **`APPLY_MODIFIER` and `SELECT_NODE` are excluded** from legal actions in the harness —
   they are UI/narrative actions not relevant to headless balance testing.

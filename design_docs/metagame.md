# Memory Cell — Metagame Design

---

## Overview

The metagame wraps the core gameplay loop in a **full life arc**: a sequence of sub-runs linked by modifier choices (life events), producing a narrative progression across life stages. Modifiers that are marked persistent carry over across sub-runs, so each run is shaped by the accumulation of a lifetime's immune history.

Losing a sub-run ends the lifetime — start a new one.

---

## Structure

```
META-RUN  (one lifetime)
├── Life Stage 0
│   ├── Sub-run 1  →  [Win] → bonus objective rewards → mini reward (pick 1 of 3)
│   ├── Sub-run 2  →  [Win] → bonus objective rewards → mini reward (pick 1 of 3)
│   └── Sub-run 3  →  [Win] → bonus objective rewards → MAJOR reward (pick 1 of 3) → Stage 1
│                     [Lose at any run] → GAME OVER — start new lifetime
├── Life Stage 1
│   └── ... (same pattern)
└── Life Stage 2
    └── Sub-run 9 (final)  →  META-RUN COMPLETE
```

**Mini rewards** are offered after every won run within a stage — smaller, often run-scoped modifiers, framed as life events.
**Major rewards** are offered at stage transitions — larger, persistent modifiers with more narrative weight.

---

## Life Stage Config (`src/data/lifeStageConfig.js`)

Life stages are defined as an **ordered array**. All code references a stage by its **index** (`lifeStageIndex: number`); names and details are looked up from the config.

Starting config for playtesting — tweak freely:

```js
export const LIFE_STAGES = [
  { name: 'Youth',     runsInStage: 3, flavourText: '...' },
  { name: 'Adult',     runsInStage: 3, flavourText: '...' },
  { name: 'Elderly',   runsInStage: 3, flavourText: '...' },
];
```

To get total run count: `LIFE_STAGES.reduce((s, l) => s + l.runsInStage, 0)`.
To get the current stage config: `LIFE_STAGES[lifeStageIndex]`.

---

## Unified Modifier Concept

**There is one concept: a modifier.** Upgrades, scars, life-event effects, bonus objective rewards, and stage-transition rewards are all modifiers from the same library (`modifierLibrary.js`). The key new fields are:

| Field | Type | Purpose |
|---|---|---|
| `canBeChosenAs` | `string[]` | Which selection contexts this modifier can appear in |
| `persistent` | `boolean` | Whether it carries into future sub-runs (default: `false`) |

### `canBeChosenAs` values

| Value | When it appears | Weight |
|---|---|---|
| `'upgrade'` | Offered after a pathogen is cleared (existing trigger) | run-scoped |
| `'scar'` | Offered after tissue integrity crosses a threshold (existing trigger) | run-scoped |
| `'miniReward'` | Offered after every won run (pick 1 of 3) | typically run-scoped or mildly persistent |
| `'majorReward'` | Offered at life stage transitions (pick 1 of 3) | typically persistent, stronger |
| `'bonusObjectiveReward'` | Offered when a bonus objective is completed (pick 1 of 3) | varies |

A modifier can appear in multiple contexts, e.g. `canBeChosenAs: ['upgrade', 'miniReward']`.

### Persistence

- `persistent: false` (default) — applies to the current run's `runModifiers`; dropped at run end
- `persistent: true` — also written to `metaState.persistentModifiers`; merged into every future run's `runModifiers` at init

**Existing upgrades and scars default to `persistent: false`** — no behaviour change. Life-event modifiers that should carry over are flagged `persistent: true`.

### `immediateEffect` — extension point for non-patch effects

`immediateEffect` is the general escape hatch for effects that can't be expressed as a `runModifiers` patch. The `APPLY_MODIFIER` reducer handles whatever effect types are enumerated there. New effect types are added to the reducer when needed — no new mechanism required, just new keys.

Currently supported:
```js
immediateEffect: (_ctx, _value) => ({
  tokenCapacityBonus: 1,
})
```

Can be extended for any structural effect, e.g.:
```js
immediateEffect: (_ctx, _value) => ({
  unlockCellTypes: ['neutrophil'],
  unlockPathogenTypes: ['virus'],
  addNodeConnections: [['LIVER', 'CHEST']],   // add edges to body map
  removeNodeConnections: [['THROAT', 'CHEST']],
  tokenCapacityBonus: 1,
})
```

Adding a new effect type = add the key to the return value and handle it in the reducer. The modifier definition and all other infrastructure stays unchanged.

### Modifier history entry (extended)

```js
{
  id: 'clearance_surge',
  chosenAs: 'lifeEvent',     // which context it was chosen in
  persistent: true,           // carried to future runs
  rarity: 'common',
  value: 1.15,
  patch: { cells: { macrophage: { clearanceRateMultiplier: 1.15 } } },
  appliedAt: { lifeStageIndex: 1, runIndex: 3, turn: null },  // turn null = between runs
}
```

### Example modifier with life event support

```js
{
  id: 'early_immune_memory',
  category: 'upgrade',
  name: 'Early Immune Memory',
  description: 'Childhood vaccination builds lasting macrophage strength',
  canBeChosenAs: ['miniReward'],
  persistent: true,
  baseProbability: 1.0,
  eligibleFor: (ctx) =>
    ctx.chosenAs === 'miniReward' &&
    ctx.lifeStageIndex === 0 &&                          // Youth stage
    !ctx.completedModifierIds.includes('early_immune_memory'),
  rarityLevels: [{ rarity: 'common', probability: 1.0, value: 1.1 }],
  getPatch: (_ctx, value, mods) => {
    const current = mods?.cells?.macrophage?.clearanceRateMultiplier ?? 1.0;
    return { cells: { macrophage: { clearanceRateMultiplier: +(current * value).toFixed(4) } } };
  },
  immediateEffect: () => ({ unlockPathogenTypes: ['virus'] }),
}
```

---

## Eligibility Context (extended for meta)

When selecting modifiers for `lifeEvent` or `bonusObjectiveReward` contexts, the context includes meta fields:

```js
{
  chosenAs: 'lifeEvent',          // selection context
  lifeStageIndex: 1,              // current life stage number
  runIndexInStage: 2,             // which run within the current stage
  subRunIndex: 4,                 // total sub-runs completed
  completedModifierIds: [],       // modifier ids already chosen this lifetime (for one-time gating)
  persistentModifiers: {},        // current accumulated persistent modifier state
  lastRunScarsAcquired: [],       // scar ids acquired in last run
  lastRunTurn: 45,                // how long the last run lasted
  // Standard fields still available:
  runModifiers, cellConfig, pathogenConfig, nodeConfig, ...
}
```

---

## Meta State (`src/state/metaState.js`)

```js
{
  metaRunId: uuid,
  lifeStageIndex: 1,            // current life stage (index into LIFE_STAGES)
  runIndexInStage: 2,           // runs completed within current stage
  subRunIndex: 4,               // total runs completed this lifetime
  subRunHistory: [
    {
      subRunIndex: 0,
      lifeStageIndex: 0,
      outcome: 'won',           // 'won' only — loss ends the lifetime
      turn: 45,
      bonusObjectivesCompleted: ['no_dendritic_used'],
    }
  ],
  completedModifierIds: [],     // modifier ids chosen this lifetime (for eligibility checks)
  completedBonusObjectiveIds: [],
  persistentModifiers: {},      // accumulated runModifiers patch from persistent modifiers
  unlockedCellTypes: [],        // from immediateEffect unlockCellTypes
  unlockedPathogenTypes: [],    // from immediateEffect unlockPathogenTypes
  pendingBonusRewards: [],      // modifier choices queued for between-run resolution
  pendingNextRunModifiers: {},  // one-off modifier patch for next run only (non-persistent lifeEvent effects)
}
```

`metaState` is saved to localStorage under `memory-cell-meta`.

---

## Run Initialisation with Meta State

When `initGameState` is called for a new sub-run:
1. Deep-merge `metaState.persistentModifiers` into `runModifiers`
2. Apply `metaState.pendingNextRunModifiers` (one-off for this run) → clear from meta after applying
3. Add `metaState.unlockedCellTypes` to `runConfig.availableResponders`
4. Enable `metaState.unlockedPathogenTypes` in spawn weight tables
5. Select 2–3 bonus objectives from eligible pool → store in `gameState.activeBonusObjectives`

---

## Run End

On a **win**:
1. Evaluate bonus objectives → queue rewards into `metaState.pendingBonusRewards`
2. Drop non-persistent modifiers from this run (they're not written to `persistentModifiers`)
3. Advance `runIndexInStage`; if stage complete, advance `lifeStageIndex`
4. Show between-run screen

On a **loss**:
1. Show game-over screen with lifetime summary (stages reached, modifiers accumulated, cause of death)
2. Reset `metaState` → start new lifetime

---

## Bonus Objectives (`src/data/bonusObjectiveLibrary.js`)

Separate from the modifier library since they define tracking logic, not modifier effects. Their **rewards** are modifiers from the library (selected via `canBeChosenAs: ['bonusObjectiveReward']`).

```js
{
  id: 'no_dendritic',
  name: 'Self-Reliant',
  description: 'Win without deploying any Dendritic cells',
  eligibleFor: (metaCtx) => true,
  failedEarly: (gameState) =>             // checked each turn — mark failed before run ends
    Object.values(gameState.deployedCells).some(c => c.type === 'dendritic'),
  isComplete: (finalGameState) =>
    finalGameState.phase === 'won',        // failedEarly already ruled out failure case
  rewardContext: { chosenAs: 'bonusObjectiveReward' },  // passed to modifier selector
}
```

### Tracking

`gameState.bonusObjectiveTracking` holds per-objective state (pass/fail/in-progress). Each objective can define a `failedEarly` check — once failed, it's marked so in-run (no suspense about a doomed objective). Updated each turn by `advanceBonusObjectives` in `handleEndTurn`.

### Selection

2–3 objectives selected at run start from the eligible pool. Objectives requiring a win are always at risk if the run is lost (rewards simply not granted).

---

## Between-Run Screen

Shown only after a **won** sub-run:

1. **Outcome card** — turns taken, pathogens cleared, worst stress, scars taken this run
2. **Bonus objective results** — pass/fail for each; player picks 1 of 3 for any completed objectives
3. **Mini reward** — player picks 1 of 3 from `canBeChosenAs: ['miniReward']` pool (life event flavour text wraps the choice)
4. *(If final run of stage)* **Major reward** — stage transition screen; player picks 1 of 3 from `canBeChosenAs: ['majorReward']` pool
5. **Start next run**

If nothing is eligible for mini reward (unlikely but possible), show a "Quiet period" card with no mechanical effect.

---

## In-Run Meta UI (`src/components/MetaHUD.jsx`)

Compact persistent element showing:
- Life stage name + index (e.g. "Child — Stage 2 of 7")
- Run progress within stage (e.g. "Run 2 of 3")
- Active bonus objectives with live pass/fail/in-progress indicators
- Persistent modifier count (tooltip with breakdown)

---

## Implemented Files

| File | Purpose |
|---|---|
| `src/data/lifeStageConfig.js` | `LIFE_STAGES` array + `isLastRunInStage`, `isLastLifeStage`, `isMetaComplete` helpers |
| `src/data/bonusObjectiveLibrary.js` | 5 bonus objective definitions with tracking logic |
| `src/state/metaState.js` | `initMetaState()` and shape definition |
| `src/state/metaActions.js` | `metaReducer`: `END_RUN`, `CHOOSE_BETWEEN_RUN_MODIFIER`, `SELECT_BONUS_OBJECTIVES`, `NEW_LIFETIME` |
| `src/state/metaPersistence.js` | `saveMeta` / `loadMeta` / `clearMeta` (localStorage key `memorycell_meta_v1`) |
| `src/components/BetweenRunScreen.jsx` | Between-run UI: stats → bonus results → modifier choice → start next run |
| `src/components/MetaHUD.jsx` | In-run header overlay: stage name, run pips, bonus objective status dots |

### Modified Files

| File | Change |
|---|---|
| `src/data/modifierLibrary.js` | Added `META_MODIFIER_LIBRARY` (9 entries: 6 miniReward/bonusObjectiveReward, 5 majorReward); updated `MODIFIER_LIBRARY` to include it |
| `src/data/modifierSelector.js` | Added `makeMetaContext` and `selectMetaOptions` |
| `src/state/gameState.js` | `initGameState(runConfig, metaContext)` — applies persistent modifiers, token bonus, bonus objectives |
| `src/state/actions.js` | `handleEndTurn` updates `bonusObjectiveTracking` each turn; preserves `activeBonusObjectives` |
| `src/components/GameShell.jsx` | Added `metaState` useReducer, `appPhase` state machine, `BetweenRunScreen`, `MetaHUD`, `handleStartNextRun`, `handleNewLifetime` |

---

## Key Design Rules

- **Life stages referenced by index** — all code uses `lifeStageIndex: number`; display name looked up from `LIFE_STAGES[lifeStageIndex].name`
- **One modifier concept** — no separate life event library; all choices come from `modifierLibrary.js` tagged with `canBeChosenAs`
- **Persistence is per-modifier** — `persistent: false` (default) = run-scoped; `persistent: true` = written to `metaState.persistentModifiers` and merged into every future run
- **Loss ends the lifetime** — no fail-forward; game over screen → new lifetime
- **Graceful absent meta** — no `metaState` in localStorage = standard endless run with no meta framing
- **Eligibility by properties, not hardcoded IDs** — use `ctx.lifeStageIndex`, `ctx.completedModifierIds`, etc.
- **Patch-at-apply-time** — `getPatch` is called when the modifier is chosen, using then-current `runModifiers` for correct stacking

---

## Design Questions & Open Issues

These are worth resolving before or during playtesting:

- **Bonus objective timing**: Selected at run start, before any spawns. Some objectives (e.g. "no infection at Throat") may become impossible on turn 1. Should objectives have a grace period, or are they explicitly stretch goals that may fail early?
- **Modifier accumulation ceiling**: Over 9 runs (3×3) with persistent upgrades stacking, late-game power could escalate significantly. The scar counter-pressure helps, but consider whether some persistent modifiers need a max-stack cap.
- **Mini/major reward pool depth**: With `completedModifierIds` preventing repetition, pool depth limits replayability across second and third lifetimes. Target ~5 mini and ~3 major modifiers per stage.

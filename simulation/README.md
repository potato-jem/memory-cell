# Simulation Harness — Agent Guide

This guide is for Claude running balance simulations. It covers how to run games, how to read the report, and how to adjust strategies or config to test specific hypotheses.

---

## Running simulations

```bash
node simulation/run.js --strategy random --runs 20
node simulation/run.js --strategy greedy --runs 50 --seed 42
node simulation/run.js --strategy conservative --runs 30 --seed 42 --output results.json
```

**Options:**

| Flag | Default | Purpose |
|---|---|---|
| `--strategy` | `random` | `random`, `greedy`, or `conservative` |
| `--runs` | `20` | Number of complete games to simulate |
| `--seed` | `1` | Integer seed — same seed + same strategy = same results |
| `--maxTurns` | `500` | Turn ceiling per game (hit = `timeout`, not `loss`) |
| `--output` | _(none)_ | Write full JSON log to this path |
| `--quiet` | _(off)_ | Suppress per-run lines; only print the summary report |

**Recommended run counts:**
- Quick sanity check: 10–20 runs
- Directional balance signal: 50 runs
- Statistical confidence: 100–200 runs

Always fix `--seed` when comparing strategies or config changes so differences reflect the change, not RNG variance.

---

## Reading the report

### OUTCOMES

```
Loss        18 / 20   (90.0%)
Timeout      2 / 20   (10.0%)
```

`Timeout` means the game hit `--maxTurns` without the system collapsing — treat it as "survived". The game has no win condition; timeout rate is the survival rate. All strategies currently produce near-100% loss rates, which is expected for dumb baselines. A meaningful player should produce measurable timeout rates.

### TURN COUNTS

```
Mean   34   Median 32   p10 31   p90 36
```

How long games last. A tight p10–p90 band (e.g. 5 turns wide) means the game reaches a similar outcome via a similar path regardless of play — the system may be on rails. A wide band suggests variance from RNG or strategy decisions. Compare mean turn counts across strategies to see whether a strategy extends survival at all.

**Loss runs only** shows the same stats filtered to losing games. If all runs are losses, this equals the full set.

### ACTION FREQUENCY

```
DEPLOY_FROM_ROSTER       1878   (70.9%)
END_TURN                  647   (24.4%)
TRAIN_CELL                125    (4.7%)
```

What the strategy actually did. For balance purposes:
- A strategy that does almost nothing but END_TURN is passive and will lose quickly — if it still survives, the game may be too easy.
- A strategy spending >50% on DEPLOY but still losing fast suggests cells aren't effective, or spawning outruns clearance.
- Very low TRAIN_CELL suggests the strategy isn't building roster depth — check if token economy is working.

### PATHOGEN ACTIVITY

```
extracellular_bacteria   spawned   81   cleared    0   (0%)
virus                    spawned  144   cleared    8   (6%)
fungi                    spawned   39   cleared    3   (8%)
```

The most diagnostic section. For each type: how often it spawned across all runs, how often it was cleared, and the clearance rate.

**Low clearance rate** has two distinct causes — diagnose before acting:
1. **No capable cells deployed** — the strategy isn't sending the right cell types. Check the strategy logic and action frequency for relevant cell types.
2. **Cells deployed too late** — pathogen load grew past the point where cells can keep up. Check turn counts when pathogens first appear vs when cells arrive.
3. **Mechanical gap** — parasite has `clearableBy: []` by design (no eosinophil yet). 0% clearance is expected and correct. Document this rather than treating it as a bug.

**High clearance rate on benign** (the false-positive pathogen) is fine — it means the strategy is wasting cells on non-threats, which is the intended cost of over-response.

### POTENTIAL DEAD CONTENT

```
! parasite
! intracellular_bacteria
! cancer
```

Pathogen types that spawned at least once but were never cleared across all runs. Possible interpretations:

- **By design** (parasite): no cell type can clear it yet. Expected. Not dead content.
- **Strategy gap**: cells that could clear this type exist but the strategy never deploys them. Run a targeted strategy that always deploys the relevant cell type to verify.
- **Balance gap**: the clearance window closes too fast, or the clearing cell takes too long to train and arrive. This is the actionable finding.

If a type spawns fewer than 5 times across all runs, the sample is too small to draw conclusions — increase `--runs`.

### SYSTEMIC EVENTS

```
Runs with integrity damage : 20 / 20
Runs with stress ≥ 80      : 20 / 20
```

Whether the systemic stress / integrity systems are engaging at all. If stress never reaches 80, the game may be ending for a different reason (or the systems aren't firing). These should both be non-zero for any strategy that plays past turn ~15.

---

## Comparing strategies

Always use the same `--seed` and `--runs` when comparing. Example:

```bash
node simulation/run.js --strategy random      --runs 50 --seed 42
node simulation/run.js --strategy greedy      --runs 50 --seed 42
node simulation/run.js --strategy conservative --runs 50 --seed 42
```

Key comparisons:
- **Mean turn count** — does the strategy extend survival? Even +5 turns is meaningful signal.
- **Pathogen clearance rates** — does targeted strategy actually clear the pathogens it targets?
- **Action frequency** — is the strategy doing what you intended?

If greedy and random produce identical mean turn counts, the greedy strategy may not be doing useful work — inspect the action frequency to verify it's actually deploying cells differently.

---

## Tweaking strategies

Strategies live in `simulation/strategies.js`. Each is a function `(gameState) => action`.

**To adjust an existing strategy**, find the relevant function and edit the logic. The game state the strategy receives includes:
- `groundTruth.nodeStates[nodeId].pathogens[]` — all pathogens with `actualLoad`, `detected_level`, `type`
- `deployedCells` — all cells with `phase`, `type`, `nodeId`
- `attentionTokens` — tokens available to spend
- `systemicStress`, `systemicIntegrity` — systemic health
- `fever.active` — current fever state

**To add a new strategy:**

1. Write a function `myStrategy(gameState) { ... return { type: 'ACTION_TYPE', ... }; }`
2. Add it to the `STRATEGIES` registry at the bottom of `strategies.js`:
   ```js
   export const STRATEGIES = {
     random:       () => randomStrategy,
     greedy:       () => greedyThreatStrategy,
     conservative: () => makeConservativeStrategy(),
     myStrategy:   () => myStrategy,   // stateless — return the function directly
     // or for stateful: myStrategy: () => makeMy Strategy(),
   };
   ```
3. Run: `node simulation/run.js --strategy myStrategy --runs 20`

**Available action types** (`ACTION_TYPES` from `src/state/actions.js`):

| Action | Payload fields | When to use |
|---|---|---|
| `END_TURN` | _(none)_ | Advance the simulation |
| `TRAIN_CELL` | `cellType` | Queue a cell for training |
| `DEPLOY_FROM_ROSTER` | `cellId`, `nodeId` | Send a ready/arrived cell to a node |
| `RECALL_UNIT` | `cellId` | Return outbound/arrived cell to HQ |
| `TOGGLE_FEVER` | _(none)_ | Toggle fever on/off |

**Helper functions in `strategies.js`** (not exported, but available inside the file):
- `getLegalDeployActions(state)` — all valid DEPLOY_FROM_ROSTER actions
- `getLegalTrainActions(state)` — all TRAIN_CELL actions the current token pool can afford
- `getLegalRecallActions(state)` — all RECALL_UNIT actions for deployed cells

---

## Adjusting game balance

Balance values live in `src/data/gameConfig.js`. Edit that file to change a value, then re-run the simulation with the same seed to isolate the effect.

Common levers:

| What you want to change | Where |
|---|---|
| How fast pathogens spawn | `SPAWN_BASE_CHANCE`, `SPAWN_DECAY_PER_TURN` in `gameConfig.js` |
| How fast stress builds | `STRESS_*` constants in `gameConfig.js` |
| When integrity starts taking hits | `INTEGRITY_HIT_STRESS_*` in `gameConfig.js` |
| Pathogen growth speed | `replicationRate` per type in `src/data/pathogens.js` |
| Cell training time / cost | `trainingTicks`, `deployCost` per type in `src/data/cellConfig.js` |
| Spawn distribution (which nodes, which types) | `BASE_WEIGHTS`, `TYPE_BASE_WEIGHT` in `src/data/spawnConfig.js` |

For a balance change hypothesis: run 50+ games before and after with the same seed, compare mean turn counts and pathogen clearance rates.

---

## Limitations to keep in mind

- **Strategies are omniscient** — they see `groundTruth` directly, including `actualLoad` on every pathogen and `detected_level`. A real player only sees what cells have detected. Survival rates from these strategies overestimate what a blind player could achieve.
- **No upgrades or modifiers** — `runModifiers` starts empty and nothing applies `APPLY_MODIFIER`. Upgrade/scar system is not exercised.
- **Parasite is unclearable by design** — `clearablePathogens` is empty pending eosinophil implementation. 0% clearance is correct.
- **Prion and cancer are stubs** — their mechanics are partially implemented. Low clearance rates for these may reflect that rather than a balance problem.

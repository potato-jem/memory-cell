# Memory Cell — Engine Layer (`src/engine/`)

Pure simulation functions. No React, no side effects.

---

## `cells.js`
All cell lifecycle logic. Pure functions only.

**Cell lifecycle:** `training → ready → outbound → arrived → returning → ready`

**Cell state shape:**
```js
{
  id: 'cell_3',
  type: 'dendritic',          // see CELL_TYPES; all type properties read from CELL_CONFIG
  phase: 'outbound',          // lifecycle phase
  nodeId: 'BLOOD',            // current position (intermediate node during transit)
  destNodeId: 'GUT',          // final destination (outbound/returning only)
  path: ['SPLEEN','BLOOD','LIVER','GUT'],  // full path
  pathIndex: 1,               // position in path (nodeId = path[pathIndex])
  deployedAtTick: 5,
  scoutDwellUntilTick: null,  // isScout cells only: when to stop dwelling (from CELL_CONFIG.isScout)
  patrolConnectionIdx: 0,     // isPatrol cells only: which connection to move to next
  patrolNextMoveTick: 10,     // isPatrol cells only: when to move to next node
}
```

Note: `effectiveness` and `hasDendriticBacking` are no longer stored on cell state. Clearance effectiveness is computed dynamically in `pathogen.js` using `CELL_CONFIG[type].effectivenessByLevel[detected_level]` at the time of clearance. `coversAdjacentNodes` is read from `CELL_CONFIG[type].coversAdjacentNodes`.

Cell config and modifier-aware accessors live in `src/data/cellConfig.js`. `cells.js` re-exports `DEPLOY_COSTS`, `CLEARANCE_RATES`, `CELL_DISPLAY_NAMES` for backward compatibility.

**Key exports:**
| Function | Purpose |
|---|---|
| `CELL_TYPES` | String constants for all cell types |
| `DEPLOY_COSTS` | Token cost per type (re-exported from cellConfig) |
| `CLEARANCE_RATES` | Clearance power per type (re-exported from cellConfig) |
| `CELL_DISPLAY_NAMES` | UI labels (re-exported from cellConfig) |
| `makeReadyCell(type)` | Create a pre-trained cell (for starting roster) |
| `trainCell(type, ..., modifiers?)` | Create a cell in training; uses effective training ticks from modifiers |
| `deployFromRoster(cellId, nodeId, ..., modifiers?)` | Move cell to a node; uses `computePathWithModifiers` |
| `recallUnit(cellId, ..., modifiers?)` | Outbound → cancel; arrived → compute return path with modifiers |
| `decommissionCell(cellId, ...)` | Remove from roster (only ready/training) |
| `advanceCells(deployedCells, tick, modifiers?)` | **Main tick function.** Returns `{updatedCells, events, nodesVisited}` |
| `startReturnForClearedNodes(..., modifiers?)` | Auto-returns attack cells when their node is clear |
| `computeTokensInUse(deployedCells, modifiers?)` | Sum of effective token costs across all cells |
| `nodeHasClassifiedPathogen(nodeId, nodeStates)` | True if any pathogen at node has `detected_level === 'classified'` — used to gate deployment of cells with `requiresClassified: true` |

**`advanceCells` returns:**
- `updatedCells` — new deployedCells dict
- `events` — `[{type, cellId, nodeId, cellType}]` — `cell_ready`, `cell_arrived`, `scout_arrived`, `cell_returned`
- `nodesVisited` — `[{cellId, cellType, nodeId}]` — all intermediate nodes touched this tick (used for en-route detection)

**Path movement rules:**
- Budget = 1 per turn
- Exit cost = `signalTravelCost` of node being left
- While budget > 0 and path not complete: subtract exit cost, advance pathIndex, add to nodesVisited
- 0-cost exit (SPLEEN only) keeps budget at 1, allowing a free extra hop
- `isScout` cells (`CELL_CONFIG[type].isScout`) dwell at destination for `SCOUT_DWELL_TICKS` then auto-return
- `isPatrol` cells cycle through adjacent nodes every `PATROL_DWELL_TICKS`

---

## `groundTruth.js`
Hidden simulation. Advances all pathogen instances, inflammation, tissue integrity.

**Key exports:**
| Function | Purpose |
|---|---|
| `makeCleanSiteState()` | Empty node state (no pathogens, inflammation=0, integrity=100) |
| `initGroundTruth()` | All nodes start clean |
| `advanceGroundTruth(gt, cells, turn, stress, spawns, modifiers?)` | **Main turn function.** Returns `{newGroundTruth, events, perSiteOutputs}` |

**`advanceGroundTruth` events:** `pathogen_cleared`, `pathogen_spread`

**`perSiteOutputs`:** `{ [nodeId]: { toxinOutput } }` — passed to `systemicValues.js`

**Site state shape:**
```js
{
  pathogens: [],                  // PathogenInstance[] — each has uid, type, tracked value, detected_level, perceived_type
  immune: [],                     // uid[] — cleared pathogen lineages; blocks re-spread of same uid
  inflammation: 0,                // 0-100
  tissueIntegrity: 100,           // 0-100
  tissueIntegrityCeiling: 100,    // permanent cap after scarring
  lowestIntegrityReached: 100,
  isWalledOff: false,             // fungi granuloma — blocks spread but not clearance
  immuneSuppressed: false,        // parasite — halves clearance
  transitPenalty: 0,              // parasite — extra turn cost to enter this node
}
```

---

## `pathogen.js`
Per-instance pathogen advancement and spread. Called by `groundTruth.js`.

**Key exports:**
| Function | Purpose |
|---|---|
| `generatePathogenUid()` | Returns a unique `'path_N'` string; used when creating new instances |
| `getClearancePower(instance, nodeId, cells, nodeState, modifiers?)` | Clearance power for a specific pathogen instance. Uses `CELL_CONFIG[type].clearablePathogens[pathogenType]` to check eligibility and `effectivenessByLevel[detected_level]` for the effectiveness factor. |
| `advanceInstance(instance, nodeId, cells, nodeState, stress, modifiers?)` | One-turn advancement: growth, clearance, damage output; respects all pathogen modifiers |
| `computeSpreads(nodeStates, modifiers?)` | Determine spread events; child inherits parent `uid`; checks target `immune[]` to block re-spread |
| `shouldWallOff(instance)` | True if fungi above granuloma threshold |

**Growth models:**
- `logistic`: `load += load × rate × (1 - load/100)` — bacteria
- `exponential`: `value += value × rate` — virus
- `linear`: `value += rate` — prion

---

## `signalGenerator.js`
Removed. Detection state now lives directly on pathogen instances (`detected_level`, `perceived_type`). See `src/data/detection.js` (`performDetection`) and `src/state/actions.js` (`runDetectionPhase`).

---

## `spawner.js`
Probabilistic pathogen spawning each turn.

`rollSpawns(nodeStates, turn, systemicStress, rng?, modifiers?)` → `[{type, nodeId, initialLoad}]`

Spawn weights, unlock turns, and schedule are in `src/data/spawnConfig.js`. Edit that file to tune spawn distributions without touching engine logic. Modifiers can further scale per-type weights (`spawn[type].weightMultiplier`) and per-node weights (`nodes[nodeId].spawnWeightMultiplier`).

---

## `systemicValues.js`
Computes SystemicStress (pressure, not health) and SystemicIntegrity (the actual loss condition).

**Key exports:**
| Function | Purpose |
|---|---|
| `computeSystemicStress(nodeStates, perSiteOutputs, fever, currentStress, modifiers?)` | New stress value; respects `feverStressMultiplier` and `stressDecayBonus` |
| `applySystemicIntegrityHits(integrity, stress)` | Reduces integrity when stress ≥ 80 |
| `computeNewScars(nodeStates, existingScars, integrity, prevIntegrity)` | Generates scar objects when integrity drops |
| `isSystemCollapsed(integrity)` | True if integrity ≤ 0 (loss condition) |
| `identifyFailureMode(stressHistory)` | Post-mortem: dominant stress pattern |

**Stress sources:** inflamed sites, low-integrity sites, multi-infection bonus, fever, toxin output.
**Integrity hits:** 1/turn at stress 80-89, 3/turn at 90-99, 5/turn at 100.

---
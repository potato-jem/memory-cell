# Memory Cell — Data Layer (`src/data/`)

Static definitions: no logic, no React. All tunable constants and registries live here.

---

## `gameConfig.js`
All tunable numeric constants. **If you want to change a balance value, look here first.**

Key constants:
| Constant | Used by | Purpose |
|---|---|---|
| `TICKS_PER_TURN` | everywhere | 5 ticks per turn |
| `PATROL_DWELL_TICKS` | `cells.js` | How long a patrol stays at a node before cycling (10 ticks = 2 turns) |
| `SCOUT_DWELL_TICKS` | `cells.js` | How long a scout stays at destination before auto-returning (10 ticks = 2 turns) |
| `TOKEN_CAPACITY_*` | `actions.js`, `gameState.js` | Starting capacity, max, regen interval |
| `INITIAL_TOKEN_CAPACITY` | `gameState.js` | Starting token capacity (12) |
| `INFLAMMATION_*` | `groundTruth.js` | Thresholds and rates for inflammation damage |
| `TISSUE_*` | `groundTruth.js` | Recovery rate, scar thresholds |
| `STRESS_*` | `systemicValues.js` | All stress computation parameters |
| `INTEGRITY_HIT_STRESS_*` | `systemicValues.js` | Integrity damage at stress thresholds |
| `SPAWN_*` | `spawner.js` | Pathogen spawn probability parameters |
| `INFLAMMATION_DECAY_RATE_*` | `groundTruth.js` | How fast inflammation decays per turn (infected vs clear) |
| `ATTACK_CELL_INFLAMMATION_*` | `groundTruth.js` | Inflammation added by attack cells each turn |
| `KILLER_T_INFLAMMATION_ON_CLEAN` | `groundTruth.js` | Killer T cascade risk on clean sites |
| `PARASITE_TRANSIT_PENALTY_PER_BURDEN` | `groundTruth.js` | Burden threshold for each +1 turn transit penalty |

---

## `cellConfig.js`
Single source of truth for all per-type cell properties. **This is the only place you need to edit to add or change a cell type.**

**`CELL_CONFIG[type]` fields:**
| Field | Purpose |
|---|---|
| `displayName` | UI label |
| `deployCost` | Tokens held for cell's lifetime |
| `clearanceRate` | Base pathogen clearance power per turn |
| `trainingTicks` | Manufacturing duration (ticks) |
| `displayOrder` | Sort order for roster lists and start screen |
| `color` | Hex colour for SVG cell dots (BodyMap) |
| `textClass` | Tailwind text colour class (UI labels) |
| `dotClass` | Tailwind background class (roster/detail dots) |
| `startingCount` | Default units of this type at run start (0 = none) |
| `isRecon` / `isAttack` / `isPatrol` / `isScout` | Role flags |
| `requiresClassified` | Cannot deploy without a classified pathogen at target (Killer T) |
| `coversAdjacentNodes` | Grants fog-of-war visibility to adjacent nodes (Macrophage) |
| `detectionRolls` | Detection rolls per node visit (recon cells); 0 for non-recon |
| `detectionUpgradeProbs` | Per-level upgrade probabilities `{ [detected_level]: { upgradeChance, misclassifyChance? } }` (null for non-recon) |
| `clearablePathogens` | `{ [pathogenType]: effectivenessMultiplier }` — pathogens this cell can clear and how effectively. Not listed = cannot clear (effectively 0). |
| `effectivenessByLevel` | `{ [detected_level]: 0–1 }` — clearance effectiveness at each detection level. Higher detection = better intel = higher effectiveness. |

**Effectiveness model:** Clearance effectiveness now scales with the pathogen's `detected_level`. For example, Responder has 0.6× at `none/unknown/threat/misclassified` and 1.0× at `classified`. Killer T has 0 at all non-classified levels (enforced by `requiresClassified` at deploy time as well). NK Cell is 1.0× at all levels.

**Derived exports:**
- `CELL_TYPE_ORDER` — cell type strings sorted by `displayOrder`
- `ATTACK_CELL_TYPES`, `RECON_CELL_TYPES`, `PATROL_CELL_TYPES` — convenience Sets
- `DEPLOY_COSTS`, `CLEARANCE_RATES`, `CELL_DISPLAY_NAMES` — flat lookup tables (backward compat)

**Modifier-aware accessors (use in engine code):**
- `getEffectiveClearanceRate(cellType, modifiers)` — base × `clearanceRateMultiplier`
- `getEffectiveDeployCost(cellType, modifiers)` — base + `deploymentCostDelta`
- `getEffectiveTrainingTicks(cellType, modifiers)` — base + `trainingTicksDelta`
- `getEffectiveEffectiveness(cellType, detectedLevel, modifiers)` — `effectivenessByLevel[level]` + `effectivenessLevelBonus[level]`

---

## `spawnConfig.js`
All spawn probability data extracted from `spawner.js` so it's tunable without touching engine logic.

| Export | Purpose |
|---|---|
| `BASE_WEIGHTS` | `{ [pathogenType]: { [nodeId]: weight } }` — spatial distribution |
| `TYPE_BASE_WEIGHT` | `{ [pathogenType]: weight }` — relative frequency across types |
| `UNLOCK_TURN` | `{ [pathogenType]: turn }` — minimum turn for each type to spawn |
| `SPAWN_SCHEDULE` | `[{ turn, typeBoost, typeMultiplier, globalBoost }]` — scripted spikes |

---

## `runModifiers.js`
Runtime modifier system. Accumulates effects from upgrades, scars, and decisions.

**`makeRunModifiers()`** — creates an empty modifier set. Lives in `state.runModifiers`.

**Modifier schema:**
```js
{
  cells: {
    [cellType]: {
      clearanceRateMultiplier,      // scales clearanceRate from cellConfig
      trainingTicksDelta,           // added to trainingTicks (negative = faster)
      deploymentCostDelta,          // added to deployCost (clamped to min 1)
      effectivenessLevelBonus,      // { [detected_level]: bonus } — added to effectivenessByLevel
                                    //   e.g. { classified: 0.1 } gives +10% when classified
      autoimmuneSurchargeMultiplier,// scales inflammation on clean-site attacks
    }
  },
  nodes: {
    [nodeId]: {
      addedConnections,    // new edges from this node (array of nodeIds)
      removedConnections,  // blocked edges (array of nodeIds)
      exitCostDelta,       // added to signalTravelCost
      spawnWeightMultiplier, // scales spawn weight for this node
    }
  },
  pathogens: {
    [pathogenType]: {
      growthRateMultiplier,    // scales replicationRate
      spreadThresholdDelta,    // added to spreadThreshold
      damageRateMultiplier,    // scales tissueDamageRate
      clearanceRateMultiplier, // scales how fast this type is cleared
    }
  },
  detection: {
    [cellType]: { [threatType]: { accuracyBonus } }  // added to correctId probability
  },
  systemic: {
    stressDecayBonus,         // added to STRESS_DECAY_RATE
    feverStressMultiplier,    // scales STRESS_FEVER_PER_TURN
    integrityRecoveryBonus,   // added to TISSUE_RECOVERY_RATE
    tokenCapacityBonus,       // added to INITIAL_TOKEN_CAPACITY at run start
  },
  spawn: {
    [pathogenType]: { weightMultiplier }  // scales TYPE_BASE_WEIGHT
  }
}
```

**`applyModifierPatch(runModifiers, patch)`** — deep-merges a patch onto current modifiers. Scalars replace; arrays (connections) union-merge. Dispatch `APPLY_MODIFIER` to apply during play.

**Stacking upgrades:** read the current value first, then compute the combined value:
```js
const current = state.runModifiers.cells?.responder?.clearanceRateMultiplier ?? 1.0;
dispatch({ type: 'APPLY_MODIFIER', patch: { cells: { responder: { clearanceRateMultiplier: current * 1.3 } } } });
```

---

## `nodes.js`
Defines all body nodes and the movement graph.

**Node fields:**
- `id`, `label`, `position: {x, y}` — identity and SVG position
- `connections: string[]` — adjacent nodes (undirected edge)
- `signalTravelCost: number` — exit cost when leaving this node (SPLEEN = 0, all others = 1)
- `damageWeight` — how much systemic stress this node contributes when inflamed
- `isHQ` — only SPLEEN; all cells deploy from here
- `isSystemic` — only BLOOD; global-spread type node
- `isCellSource` — BONE_MARROW; cosmetic/informational

**Node topology:**
```
SPLEEN (HQ) ─── BLOOD ─── BONE_MARROW
                  │
           ┌──────┼──────┬──────┐
         CHEST  LIVER  MUSCLE  SPLEEN
           │      │      │
         THROAT  GUT  PERIPHERY
```

**Exports used:**
- `NODES` — the full node dictionary
- `NODE_IDS` — `Object.keys(NODES)`
- `HQ_NODE_ID` — `'SPLEEN'`
- `computePath(fromId, toId)` — Dijkstra shortest path using base topology
- `computePathCost(path, fromIndex?)` — sum of exit costs along a path
- `computePathWithModifiers(fromId, toId, modifiers)` — respects `addedConnections`, `removedConnections`, `exitCostDelta` from runModifiers
- `computePathCostWithModifiers(path, modifiers, fromIndex?)` — modifier-aware cost sum
- `computeVisibility(deployedCells)` — returns Set of visible nodeIds; uses `CELL_CONFIG[type].coversAdjacentNodes` to extend to adjacent nodes

**Movement budget:** 1 per turn. A 0-cost origin (SPLEEN) means the cell moves to the first intermediate node for free, then spends 1 to reach the next. So SPLEEN → GUT takes 2 turns (SPLEEN→BLOOD for free + BLOOD→LIVER for 1 + LIVER→GUT for 1 = cost 2).

---

## `pathogens.js`
Static registry of all pathogen types: growth models, damage rates.

Which cells can clear each pathogen is defined **on the cell** (`CELL_CONFIG[type].clearablePathogens`) rather than on the pathogen. This makes adding cell types self-contained.

**Exports used:**
- `PATHOGEN_REGISTRY` — full per-type configuration (includes `detectionModifier` per type)
- `PATHOGEN_TYPES` — string constants
- `PATHOGEN_DISPLAY_NAMES` — UI labels
- `isInstanceCleared(inst)` — returns true if tracked value ≤ 0
- `getPrimaryLoad(inst)` — reads the tracked value from an instance
- `getDominantPathogen(nodeState)` — returns the highest-load pathogen at a node (iterates array)
- `nodeHasActivePathogen(nodeState)` — true if any pathogen is present
- `allNodesClear(nodeStates)` — true if no active pathogens anywhere

**PathogenInstance shape:**
```js
{
  uid: 'path_7',                   // unique ID; inherited by spread children
  type: 'extracellular_bacteria',
  infectionLoad: 45,               // primary tracked value (name varies by type)
  detected_level: 'none',          // 'none' | 'unknown' | 'threat' | 'classified' | 'misclassified'
  perceived_type: null,            // string | null — set when classified/misclassified
}
```

**`detectionModifier` per pathogen type** (scales detection upgrade probability):
| Type | Modifier |
|---|---|
| extracellular_bacteria | 1.0 |
| intracellular_bacteria | 0.8 |
| virus | 0.8 |
| fungi | 1.0 |
| parasite | 0.9 |
| toxin_producer | 0.9 |
| prion | 0.5 |
| cancer | 0.6 |
| autoimmune | 0.7 |
| benign | 0.7 |

---

## `signals.js`
Minimal constants retained for `memory.js`. No signal objects exist at runtime.

**Exports used:**
- `THREAT_TYPES` — `bacterial`, `viral`, `cancer`, `autoimmune`, `mimic`
- `CONFIDENCE_LEVELS` — `low`, `medium`, `high`
- `bumpConfidence(confidence)` — bumps up one band (used by memory bonus)

---

## `detection.js`
Detection probability tables and the `performDetection` pure function. Operates directly on pathogen instances — no perceived state involved.

**`performDetection(cellType, nodePathogens, nodeInflammation, modifiers?)`** → updated `nodePathogens[]`

Detection rolls and upgrade probabilities are read from `CELL_CONFIG[cellType]`:
- `detectionRolls` — how many rolls per node visit
- `detectionUpgradeProbs` — per-level `{ upgradeChance, misclassifyChance? }` table

Each roll targets the highest-priority unclassified pathogen and attempts to upgrade its `detected_level`. Returns a new array with updated detection state on affected instances.

**Level priority** (rolls target highest-priority first): `misclassified` > `threat` > `unknown` > `none` > `classified` (already done).

**`WRONG_ID_MAP`** — per pathogen type, likely misidentification targets (other type strings).

Used by `actions.js` (`runDetectionPhase`) for all detection — arrived recon cells, macrophage adjacents, and en-route visits.

---

## `runConfig.js`
Default run configuration.

- `availableResponders` — attack cell types available for training in this run
- Starting roster defaults derive from `CELL_CONFIG[type].startingCount`. Override via `runConfig.startingUnits` (e.g. from the start screen) or edit `startingCount` in `cellConfig.js`.

`GameShell.jsx` lets the player adjust starting counts on the start screen.

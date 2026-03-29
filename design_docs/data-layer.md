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
| `TRAINING_TICKS` | `cells.js` | Per-cell-type manufacturing time |
| `TOKEN_CAPACITY_*` | `actions.js`, `gameState.js` | Starting capacity, max, regen interval |
| `INITIAL_TOKEN_CAPACITY` | `gameState.js` | Starting token capacity (12) |
| `INFLAMMATION_*` | `groundTruth.js` | Thresholds and rates for inflammation damage |
| `TISSUE_*` | `groundTruth.js` | Recovery rate, scar thresholds |
| `STRESS_*` | `systemicValues.js` | All stress computation parameters |
| `INTEGRITY_HIT_STRESS_*` | `systemicValues.js` | Integrity damage at stress thresholds |
| `SPAWN_*` | `spawner.js` | Pathogen spawn probability parameters |
| `WARNING/ALERT/INFO_SIGNAL_TIMEOUT` | `signalGenerator.js` | Signal expiry in ticks |
| `INFLAMMATION_DECAY_RATE_*` | `groundTruth.js` | How fast inflammation decays per turn (infected vs clear) |
| `ATTACK_CELL_INFLAMMATION_*` | `groundTruth.js` | Inflammation added by attack cells each turn |
| `KILLER_T_INFLAMMATION_ON_CLEAN` | `groundTruth.js` | Killer T cascade risk on clean sites |
| `PARASITE_TRANSIT_PENALTY_PER_BURDEN` | `groundTruth.js` | Burden threshold for each +1 turn transit penalty |

---

## `cellConfig.js`
Single source of truth for all per-type cell properties.

**`CELL_CONFIG[type]` fields:**
| Field | Purpose |
|---|---|
| `displayName` | UI label |
| `deployCost` | Tokens held for cell's lifetime |
| `clearanceRate` | Pathogen clearance power per turn |
| `isRecon` / `isAttack` / `isPatrol` | Role flags |
| `requiresScoutConfirmation` | Killer T: cannot deploy without scout confirmation |
| `effectivenessWithBacking` | Clearance effectiveness when scout has confirmed threat |
| `effectivenessWithoutBacking` | Clearance effectiveness without scout confirmation (null = N/A) |

**Derived tables:** `DEPLOY_COSTS`, `CLEARANCE_RATES`, `CELL_DISPLAY_NAMES` — re-exported from `cells.js` for backward compat.

**Convenience sets:** `ATTACK_CELL_TYPES`, `RECON_CELL_TYPES`, `PATROL_CELL_TYPES`

**Modifier-aware accessors (use in engine code):**
- `getEffectiveClearanceRate(cellType, modifiers)` — base × `clearanceRateMultiplier`
- `getEffectiveDeployCost(cellType, modifiers)` — base + `deploymentCostDelta`
- `getEffectiveTrainingTicks(cellType, baseTicks, modifiers)` — baseTicks + `trainingTicksDelta`
- `getEffectiveEffectiveness(cellType, hasBacking, modifiers)` — base + bonus

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
      effectivenessBackedBonus,     // added to effectiveness when scout-confirmed
      effectivenessUnbackedBonus,   // added to effectiveness without backing
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
- `computePathWithModifiers(fromId, toId, modifiers)` — respects `addedConnections`, `removedConnections`, `exitCostDelta` from runModifiers. Used by cells.js for all path computation during play.
- `computePathCostWithModifiers(path, modifiers, fromIndex?)` — modifier-aware cost sum

**Movement budget:** 1 per turn. A 0-cost origin (SPLEEN) means the cell moves to the first intermediate node for free, then spends 1 to reach the next. So SPLEEN → GUT takes 2 turns (SPLEEN→BLOOD for free + BLOOD→LIVER for 1 + LIVER→GUT for 1 = cost 2).

---

## `pathogens.js`
Static registry of all pathogen types: growth models, damage rates, clearable-by lists.

**Exports used:**
- `PATHOGEN_REGISTRY` — full per-type configuration
- `PATHOGEN_TYPES` — string constants
- `PATHOGEN_SIGNAL_TYPE` — maps pathogen type → signal vocabulary (`'bacterial'`, `'viral'`, etc.)
- `PATHOGEN_DISPLAY_NAMES` — UI labels
- `isInstanceCleared(inst)` — returns true if tracked value ≤ 0
- `getPrimaryLoad(inst)` — reads the tracked value from an instance
- `getDominantPathogen(nodeState)` — returns the highest-load pathogen at a node
- `nodeHasActivePathogen(nodeState)` — true if any pathogen is present
- `allNodesClear(nodeStates)` — true if no active pathogens anywhere

**PathogenInstance shape:**
```js
{ type: 'extracellular_bacteria', infectionLoad: 45 }
{ type: 'virus', cellularCompromise: 30 }
{ type: 'fungi', hyphaeLoad: 20, isWalledOff: false }
```
Each type tracks exactly one primary value (`trackedValue` from registry). Stored at `nodeStates[nodeId].pathogens[pathogenType]`.

---

## `signals.js`
Signal type constants and confidence levels. No logic.

**Exports used:**
- `SIGNAL_TYPES` — `anomaly_detected`, `threat_confirmed`, `patrol_clear`, `collateral_damage`, etc.
- `SIGNAL_SOURCES` — `neutrophil`, `macrophage`, `dendritic`
- `CONFIDENCE_LEVELS` — `low`, `medium`, `high`
- `ROUTING_COSTS` — used by `SignalConsole` to show cost hints

---

## `detection.js`
Detection roll logic — given cell type, threat type, threat strength, and inflammation, returns an outcome.

**Outcomes:** `MISS`, `ANOMALY`, `THREAT_UNCLASSIFIED`, `CORRECT_ID`, `WRONG_ID`, `CLEAR`, `FALSE_ALARM`

Only used by `signalGenerator.js` (via `rollDetection`).

---

## `runConfig.js`
Default run configuration. Specifies starting units.

```js
{ startingUnits: [{ type: 'neutrophil', count: 2 }, { type: 'macrophage', count: 1 }] }
```

`GameShell.jsx` lets the player override `startingUnits` from the start screen.

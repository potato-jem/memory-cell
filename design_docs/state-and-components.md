# Memory Cell — State & Components

## State Layer (`src/state/`)

### `gameState.js`
Game state shape and `initGameState(runConfig)`.

**Top-level state fields:**
```js
{
  runConfig,                   // active run config
  groundTruth,                 // hidden simulation
  perceivedState,              // player's working model
  deployedCells,               // { [cellId]: CellState }
  tick, turn,                  // time
  tokenCapacity, tokensInUse, attentionTokens,
  systemicStress,              // 0-100 pressure input
  systemicIntegrity,           // 0-100 loss condition
  systemicStressHistory,       // [{turn, stress, integrity}] — for charts/postmortem
  fever: { active: bool },
  scars,                       // [{nodeId, integrityFloor, turn}]
  memoryBank,                  // cross-run immune memory
  runModifiers,                // accumulated upgrades/scars/decisions — see data-layer.md
  lastKnownNodeStates,         // fog-of-war snapshot per node
  phase,                       // 'playing' | 'lost'
  lossReason,
  postMortem,
  selectedNodeId,              // which node is shown in NodeDetail
}
```

---

### `perceivedState.js`
Player's working model of the body. Detection outcomes update this directly — there are no signal objects.

**Key exports:**
| Function | Purpose |
|---|---|
| `initPerceivedState(nodeIds)` | All nodes start clean |
| `applyDetectionOutcome(ps, nodeId, outcome, reportedType, turn)` | Map a `DETECTION_OUTCOMES` value directly to threat level + entity list |
| `applyCollateralDamageObservation(ps, nodeId, turn)` | Mark high-inflammation node when no threat is detected |
| `applyDendriticReturn(ps, nodeId, foundThreat, threatType, turn)` | Scout result upgrades entity to CLASSIFIED or resolves to BENIGN |
| `applyResponderDeployed(ps, nodeId)` | Increments responseLevel |
| `applyNeutrophilDeployed(ps, nodeId)` | Sets minimum responseLevel |
| `dismissEntity(ps, nodeId, entityId)` | Player manually dismisses an entity |
| `entityDisplayLabel(perceivedClass, classifiedType)` | UI label for an entity |

**Detection outcome → perceived state mapping:**
| Outcome | threatLevel | Entity class |
|---|---|---|
| `anomaly` / `false_alarm` | SUSPECTED | UNKNOWN |
| `threat_unclassified` | CONFIRMED | PATHOGEN |
| `correct_id` / `wrong_id` | CONFIRMED | CLASSIFIED (reportedType, may be wrong) |
| `clear` | NONE | existing entities resolved |

**Foreign entity classes (ENTITY_CLASS):**
- `UNKNOWN` — anomaly detected, unclassified (visibility B)
- `PATHOGEN` — confirmed threat, type unknown (visibility C)
- `CLASSIFIED` — has `classifiedType`; set by CORRECT_ID/WRONG_ID rolls or scout return (visibility D)
- `SELF_LIKE` — appears normal (clear result)
- `BENIGN` — scout confirmed no threat
- `INFLAMMATORY` — high inflammation, no active threat

**Entity upgrade path:** UNKNOWN → PATHOGEN → CLASSIFIED (via `classRank`; never downgrades).

**Perceived node state shape:**
```js
{
  threatLevel: 1,       // THREAT_LEVELS enum (0-3)
  responseLevel: 0,
  scoutConfirmed: false,
  lastSeenTurn: 3,
}
```

---

### `actions.js`
The `gameReducer` and all action handlers. **This is the only place state mutations happen.**

**Actions:**
| Action | Handler |
|---|---|
| `END_TURN` | Full simulation tick: advance cells, detection rolls → perceived state, spawn, advance GT, systemic values |
| `TOGGLE_FEVER` | Toggle fever on/off |
| `TRAIN_CELL` | Add cell to roster in training |
| `DEPLOY_FROM_ROSTER` | Deploy cell to a node |
| `DECOMMISSION_CELL` | Remove cell from roster |
| `RECALL_UNIT` | Return cell to HQ |
| `RESTART` | Replace state with new `initialState` |
| `SELECT_NODE` | Set `selectedNodeId` |
| `APPLY_MODIFIER` | Deep-merge a `patch` object into `state.runModifiers` (upgrades, scars, decisions) |

**END_TURN sequence:**
1. Token capacity regen
2. `advanceCells` → updatedCells + events + nodesVisited
3. Detection rolls for scout arrivals (against current GT, before it advances)
4. `rollSpawns`
5. `advanceGroundTruth`
6. `startReturnForClearedNodes`
7. Fog-of-war snapshot of visible nodes → `lastKnownNodeStates`
8. Detection rolls for arrived patrol/macrophage → `applyDetectionOutcome` / `applyCollateralDamageObservation`
9. Detection rolls for en-route visits (nodesVisited) → `applyDetectionOutcome`
10. `applyDendriticReturn` for scout arrivals
11. `computeSystemicStress`, `applySystemicIntegrityHits`, `computeNewScars`
12. `recordEncounter` for cleared pathogens
13. Token accounting
14. Loss check (`isSystemCollapsed`)

---

## Components Layer (`src/components/`)

### `GameShell.jsx`
Top-level game shell. Owns the `useReducer` with `gameReducer`. Handles:
- Start screen with unit picker (per-type +/- controls, token total)
- Playing layout: `CellRoster` (left) + `BodyMap` (centre) + `OverviewPanel` or `NodeDetail` (right)
- Lost screen → `PostMortem`
- Dispatches all player actions

**`OverviewPanel`** (inline component): derives alert/warning node lists from `perceivedState.nodes[x].threatLevel` (≥ CONFIRMED = alert, SUSPECTED = warning). Shows node label + active entity display label per row.

**Key props passed down:**
- `state` — full game state (read-only to children)
- `dispatch` — for action dispatch

---

### `BodyMap.jsx`
SVG map of all nodes. Shows:
- Node circles with integrity fill (clip-path based)
- Pathogen rings (orange dashed = PATHOGEN class, red = CLASSIFIED)
- Inflammation arc rings
- Cell dots at each node:
  - **Arrived** cells: full-opacity colored dots
  - **Outbound/returning** cells at their current intermediate `nodeId`: dimmed (35% opacity, smaller)
- Right-click on node → deploy selected cell
- Left-click → `SELECT_NODE` action

**Cell dot positions:** ring around inner edge of node circle, evenly spaced.

**To change:** visual node layout, ring styling, cell dot appearance.

---

### `CellRoster.jsx`
Left panel. Shows all cells in the roster grouped by phase. Per-cell:
- Type label, status line, recall button
- Status line:
  - `training`: `training XT`
  - `outbound`: `→ DestNode XT (via IntermediateNode)` (ETA from `computePathCost`)
  - `arrived`: current node label
  - `returning`: `↩ XT`
- Train buttons for each cell type (shows cost, disabled if insufficient tokens)

**To change:** add cell types, change status display, add new training buttons.

---

### `NodeDetail.jsx`
Right panel slide-in when a node is selected. Three sections:
1. **Site Status** — GT inflammation bar, tissue integrity bar, status badges (WALLED OFF, SUPPRESSED, TRANSIT –N)
2. **Threats** — one row per foreign entity; visibility-level-aware:
   - No data: "No surveillance data"
   - Empty: "Clear"
   - B (UNKNOWN): ghost bar + turns-at-level counter
   - C (PATHOGEN): orange ghost bar + turns-at-level counter
   - D (CLASSIFIED): type name + real GT load bar
3. **Your Cells Here** — arrived cells with recall buttons; "Passing through" sub-section for outbound/returning cells with destination + ETA

**Props:** `nodeId`, `perceivedState`, `groundTruthNodeState`, `deployedCells`, `currentTurn`, `onRecall`, `onClose`

**To change:** add more GT data display, change entity visibility rules.

---

### `PostMortem.jsx`
End-of-run screen. Shows final systemic integrity/stress, timeline chart, dominant failure mode, per-node state summary. Uses `postMortem` object from game state.

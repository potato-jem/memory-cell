# Memory Cell — State & Components

## State Layer (`src/state/`)

### `gameState.js`
Game state shape and `initGameState(runConfig)`.

**Top-level state fields:**
```js
{
  runConfig,                   // active run config
  groundTruth,                 // hidden simulation; detection state lives on pathogen instances here
  deployedCells,               // { [cellId]: CellState }
  tick, turn,                  // time
  tokenCapacity, tokensInUse, attentionTokens,
  systemicStress,              // 0-100 pressure input
  systemicIntegrity,           // 0-100 loss condition
  systemicStressHistory,       // [{turn, stress, integrity}] — for charts/postmortem
  fever: { active: bool },
  scars,                       // [{nodeId, integrityFloor, turn}]
  runModifiers,                // accumulated upgrades/scars/decisions — see data-layer.md
  cellTypeState,               // per-type runtime cell state — see below
  phase,                       // 'playing' | 'lost'
  lossReason,
  postMortem,
  selectedNodeId,              // which node is shown in NodeDetail
}
```

#### `cellTypeState`
Global per-type runtime state for behavioural properties that emerge from gameplay. Lives at `state.cellTypeState` and is updated each turn. Distinct from `runModifiers` (not upgrade/scar driven).

```js
cellTypeState = {
  b_cell: {
    specialization: { virus: 1.0, extracellular_bacteria: 1.0, ... }
    // clearance multipliers per pathogen type; all cells of this type share one score
    // ranges: 0.2 (specializationMin) → 2.5 (specializationMax)
  },
  killer_t: {
    specializedType: null | 'virus' | ...
    // locked pathogen type after first successful encounter; null = not yet specialised
  },
}
```

**Why global, not per-cell:** B-cell specialization was previously stored on each individual cell, but new cells inherited from existing ones (fungibility). The global design makes this explicit — all B-cells of the current run share one memory, which develops based on what any stationed B-cell encounters.

**Engine integration:**
- `updateCellSpecializations(cells, nodeStates, cellTypeState)` in `cells.js` returns updated `cellTypeState` — called in `handleEndTurn` after `advanceGroundTruth`
- `getCellClearablePathogens(cellType, modifiers, cellTypeState)` reads `specializedType` from `cellTypeState` first (killer_t lock), falling back to `runModifiers` for legacy saves
- All pathogen clearance functions (`computeNodeClearanceAllocations`, `advanceInstance`, `computePathogenBreakdown`) accept `cellTypeState` as a final optional parameter and use `cellTypeState[cell.type].specialization[pathogenType]` for the specialization multiplier

---

### `perceivedState.js`
Dead code — zero imports. All detection state now lives on pathogen instances in `groundTruth.nodeStates[nodeId].pathogens[].detected_level`. Do not use or revive.

---

### `actions.js`
The `gameReducer` and all action handlers. **This is the only place state mutations happen.**

**Actions:**
| Action | Handler |
|---|---|
| `END_TURN` | Full simulation tick: advance cells, detection phase, spawn, advance GT, systemic values |
| `TOGGLE_FEVER` | Toggle fever on/off |
| `TRAIN_CELL` | Add cell to roster in training |
| `DEPLOY_FROM_ROSTER` | Deploy cell to a node; takes `groundTruth.nodeStates` for Killer T confirmation check |
| `DECOMMISSION_CELL` | Remove cell from roster |
| `RECALL_UNIT` | Return cell to HQ |
| `RESTART` | Replace state with new `initialState` |
| `SELECT_NODE` | Set `selectedNodeId` |
| `APPLY_MODIFIER` | Deep-merge a `patch` object into `state.runModifiers` (upgrades, scars, decisions) |

**END_TURN sequence:**
1. Token capacity regen
2. `advanceCells(cells, tick, mods, nodeStates)` → updatedCells + events + nodesVisited (nodeStates used by patrol wait-for-clear)
3. `runDetectionPhase(deployedCells, nodesVisited, groundTruth, modifiers)` → `{ groundTruth, nodesWithClearRoll }` — deterministic detection, updates `detected_level` / `perceived_type`
4. `rollSpawns`
5. `advanceGroundTruth`
6. `startReturnForClearedNodes`
7. Stamp `turnsSinceLastClear` onto all nodeStates (reset for nodes in `nodesWithClearRoll`, increment otherwise)
8. `assignPatrolDestinations` — targets nodes by `turnsSinceLastClear` descending
9. `computeSystemicStress`, `applySystemicIntegrityHits`, `computeNewScars`
10. Token accounting
11. Loss check (`isSystemCollapsed`)

**`runDetectionPhase` logic:**
- Builds a `nodeId → [cellType, ...]` map: arrived recon cells at their node; cells with `coversAdjacentNodes` also cover adjacent nodes; en-route cells via `nodesVisited`
- Calls `performDetection(cellType, nodePathogens)` per (node, cellType) pair — deterministic: `isDetector` upgrades `none`→`unknown`, `isClassifier` upgrades `unknown`→`classified`
- Returns `{ groundTruth, nodesWithClearRoll }` — `nodesWithClearRoll` is Set of nodes where a detector found nothing new

---

## Components Layer (`src/components/`)

### `GameShell.jsx`
Top-level game shell. Owns the `useReducer` with `gameReducer`. Handles:
- Start screen with unit picker (per-type +/- controls, token total)
- Playing layout: `CellRoster` (left) + `BodyMap` (centre) + `OverviewPanel` or `NodeDetail` (right)
- Lost screen → `PostMortem`
- Dispatches all player actions

**`OverviewPanel`** (inline component): derives alert/warning node lists directly from `groundTruth.nodeStates`. Alerts = nodes with any pathogen at `detected_level` in `{classified, misclassified, threat}`; warnings = nodes with only `unknown`-level pathogens. Shows node label + `PATHOGEN_DISPLAY_NAMES[perceived_type]` per row.

**Key props passed down:**
- `state` — full game state (read-only to children)
- `dispatch` — for action dispatch

---

### `BodyMap.jsx`
SVG map of all nodes. All nodes always visible. Shows:
- Node circles: fill colour = inflammation (navy → olive → amber → orange → red); fill level = tissue integrity (clip-path)
- Pathogen arc rings per instance, based on `detected_level`:
  - `classified`: solid ring in perceived-type colour; arc = load %
  - `unknown`: thin dashed grey ring, fixed arc
  - Yellow badge = count of `unknown`-level pathogens at node
- **Surveillance pips**: small white dots around inside of node circle (1 per `turnsSinceLastClear`, max 8)
- Cell dots at each node:
  - **Arrived** cells: full-opacity colored dots
  - **Outbound/returning** cells at their current intermediate `nodeId`: dimmed (35% opacity, smaller)
- Right-click on node → deploy selected cell
- Left-click → `SELECT_NODE` action

**Props:** `groundTruthNodeStates`, `deployedCells`, `selectedNodeId`, `onSelectNode`, `onNodeContextMenu`

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
1. **Site Status** — inflammation bar, tissue integrity bar, status badges (WALLED OFF, SUPPRESSED, TRANSIT –N)
2. **Threats** — one row per pathogen with `detected_level !== 'none'`:
   - `unknown`: "Unknown presence" + ghost bar
   - `classified`: `PATHOGEN_DISPLAY_NAMES[perceived_type]` + real load bar + delta badge
   - No detected pathogens: "No threats detected."
3. **Your Cells Here** — arrived cells with recall buttons; "Passing through" sub-section for outbound/returning cells with destination + ETA

**Props:** `nodeId`, `groundTruthNodeState`, `deployedCells`, `currentTurn`, `onRecall`, `onClose`

**To change:** add more GT data display, change detection level display rules.

---

### `PostMortem.jsx`
End-of-run screen. Shows final systemic integrity/stress, timeline chart, dominant failure mode, per-node state summary. Uses `postMortem` object from game state.

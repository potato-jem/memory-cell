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
  lastKnownNodeStates,         // fog-of-war snapshot per node
  phase,                       // 'playing' | 'lost'
  lossReason,
  postMortem,
  selectedNodeId,              // which node is shown in NodeDetail
}
```

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
2. `advanceCells` → updatedCells + events + nodesVisited
3. `runDetectionPhase(deployedCells, nodesVisited, groundTruth, modifiers)` — updates `detected_level` / `perceived_type` on pathogen instances in GT before it advances
4. `rollSpawns`
5. `advanceGroundTruth`
6. `startReturnForClearedNodes`
7. Fog-of-war snapshot of visible nodes → `lastKnownNodeStates`
8. `computeSystemicStress`, `applySystemicIntegrityHits`, `computeNewScars`
9. Token accounting
10. Loss check (`isSystemCollapsed`)

**`runDetectionPhase` logic:**
- Builds a `nodeId → [cellType, ...]` map: arrived recon cells at their node; macrophages also cover adjacent nodes; en-route cells via `nodesVisited`
- Calls `performDetection(cellType, nodePathogens, inflammation, modifiers)` per (node, cellType) pair
- Returns updated groundTruth with mutated `detected_level` / `perceived_type` on instances

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
SVG map of all nodes. Shows:
- Node circles: fill colour = inflammation (navy → olive → amber → orange → red); fill level = tissue integrity (clip-path)
- Pathogen arc rings per instance, based on `detected_level`:
  - `classified` / `misclassified`: solid ring in perceived-type colour; arc = load % (or 85% when fogged)
  - `threat`: dashed orange ring, fixed 55% arc
  - `unknown`: thin dashed grey ring, fixed 25% arc
  - Yellow badge = count of `unknown`-level pathogens at node
- Cell dots at each node:
  - **Arrived** cells: full-opacity colored dots
  - **Outbound/returning** cells at their current intermediate `nodeId`: dimmed (35% opacity, smaller)
- Right-click on node → deploy selected cell
- Left-click → `SELECT_NODE` action

**Props:** `groundTruthNodeStates`, `deployedCells`, `selectedNodeId`, `onSelectNode`, `onNodeContextMenu`, `visibleNodes`, `lastKnownNodeStates` (no `perceivedState`)

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
1. **Site Status** — inflammation bar, tissue integrity bar, status badges (WALLED OFF, SUPPRESSED, TRANSIT –N); fog-aware (real-time when visible, last-known when not)
2. **Threats** — one row per pathogen with `detected_level !== 'none'`:
   - `unknown`: "Unknown anomaly" + ghost bar
   - `threat`: "Unclassified threat" + ghost bar
   - `classified` / `misclassified`: `PATHOGEN_DISPLAY_NAMES[perceived_type]` + real load bar
   - No detected pathogens: "No surveillance data"
3. **Your Cells Here** — arrived cells with recall buttons; "Passing through" sub-section for outbound/returning cells with destination + ETA

**Props:** `nodeId`, `groundTruthNodeState`, `deployedCells`, `currentTurn`, `onRecall`, `onClose`, `visibleNodes`, `lastKnownNodeStates` (no `perceivedState`)

**To change:** add more GT data display, change detection level display rules.

---

### `PostMortem.jsx`
End-of-run screen. Shows final systemic integrity/stress, timeline chart, dominant failure mode, per-node state summary. Uses `postMortem` object from game state.

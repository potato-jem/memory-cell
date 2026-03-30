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
  activeSignals,               // unactioned signals
  signalHistory,               // all signals ever seen
  silenceNotices,              // informational patrol messages
  runModifiers,                // accumulated upgrades/scars/decisions — see data-layer.md
  phase,                       // 'playing' | 'lost'
  lossReason,
  postMortem,
  selectedNodeId,              // which node is shown in NodeDetail
}
```

---

### `perceivedState.js`
Player's working model of the body. Updated by signals and routing decisions.

**Key exports:**
| Function | Purpose |
|---|---|
| `initPerceivedState(nodeIds)` | All nodes start clean |
| `applySignalToPerceivedState(ps, signal)` | Update threat level + entity list from a signal |
| `applyRoutingDecision(ps, signal, decision)` | 'dismiss' or 'hold' — adjusts threat levels |
| `applyDendriticReturn(ps, nodeId, foundThreat, threatType, turn)` | Scout result upgrades entity to CLASSIFIED or resolves to BENIGN |
| `applyResponderDeployed(ps, nodeId)` | Marks node as RESPONDING |
| `applyNeutrophilDeployed(ps, nodeId)` | Marks node as WATCHING |
| `dismissEntity(ps, nodeId, entityId)` | Player manually dismisses an entity |
| `entityDisplayLabel(perceivedClass, classifiedType, confidence)` | UI label for an entity |

**Foreign entity classes (ENTITY_CLASS):**
- `UNKNOWN` — anomaly signal only (visibility level B)
- `PATHOGEN` — confirmed threat, unclassified (visibility level C)
- `CLASSIFIED` — scout-confirmed; has `classifiedType` (visibility level D)
- `SELF_LIKE` — appears normal (patrol_clear result)
- `BENIGN` — scout confirmed no threat
- `INFLAMMATORY` — collateral damage signal

**Entity upgrade path:** UNKNOWN → PATHOGEN → CLASSIFIED (via `classRank` ordering; never downgrades).

**Perceived node state shape:**
```js
{
  threatLevel: 1,               // THREAT_LEVELS (0-3)
  responseLevel: 0,
  scoutConfirmed: false,
  signalsReceived: ['sig_1'],
  lastSignalTurn: 3,
  quarantinedSignalIds: [],
  dismissedSignalIds: [],
}
```

---

### `actions.js`
The `gameReducer` and all action handlers. **This is the only place state mutations happen.**

**Actions:**
| Action | Handler |
|---|---|
| `END_TURN` | Full simulation tick: advance cells, spawn, advance GT, generate signals, update perceived state, compute systemic values |
| `TOGGLE_FEVER` | Toggle fever on/off |
| `DISMISS_SIGNAL` / `HOLD_SIGNAL` | Route a signal; update perceived state |
| `DISMISS_ENTITY` | Player dismisses a foreign entity |
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
3. Scout arrival events → `makeDendriticReturnSignal` for each
4. `rollSpawns`
5. `advanceGroundTruth`
6. `startReturnForClearedNodes`
7. `generateSignals` (arrived recon cells) + `generateSignalsForVisits` (en-route via nodesVisited)
8. `applySignalToPerceivedState` for all new signals + `applyDendriticReturn` for scout returns
9. Expire old signals, append new ones to history
10. `computeSystemicStress`, `applySystemicIntegrityHits`, `computeNewScars`
11. `recordEncounter` for cleared pathogens
12. Token accounting
13. Loss check (`isSystemCollapsed`)

---

## Components Layer (`src/components/`)

### `GameShell.jsx`
Top-level game shell. Owns the `useReducer` with `gameReducer`. Handles:
- Start screen with unit picker (per-type +/- controls, token total)
- Playing layout: `BodyMap` (left) + `SignalConsole` panels + `CellRoster` (right) + `NodeDetail` (slide-in)
- Lost screen → `PostMortem`
- Dispatches all player actions

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

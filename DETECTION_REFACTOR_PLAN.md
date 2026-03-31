# Detection Refactor Plan

## Goal

Move detection state onto individual pathogen objects rather than a separate `perceivedState` layer. Each pathogen instance carries its own `detected_level` and `perceived_type`. Detection is a roll-based upgrade process that runs as a discrete phase during the turn. Spread is constrained by per-node immunity memory (uid-based).

---

## New Data Structures

### PathogenInstance (on node, in groundTruth)
```js
{
  uid: 'path_001',              // unique ID — persists as lineage for spread + immunity
  type: 'extracellular_bacteria',
  actualLoad: 45,            // 
  detected_level: 'none',       // 'none' | 'unknown' | 'threat' | 'misclassified' | 'classified'
  perceived_type: null,         // string | null — what the immune system thinks it is
}
```

### Node state (`groundTruth.nodeStates[nodeId]`)
```js
{
  pathogens: [],               // CHANGED: array of PathogenInstances (was dict keyed by type)
  immune: [],                  // ADDED: UIDs of pathogens cleared from this node
  inflammation: 0,
  tissueIntegrity: 100,
  tissueIntegrityCeiling: 100,
  lowestIntegrityReached: 100,
  isWalledOff: false,
  immuneSuppressed: false,
  transitPenalty: 0,
}
```

**Why array?** Allows multiple pathogens of the same type (e.g. two separate viral lineages). Also enables each instance to have its own uid and detected_level.

### Detection levels (ordered upgrade path)
```
none → unknown → threat → classified
                         ↗
                  misclassified  (can be corrected back to classified via later rolls)
```

---

## What to Remove

### `src/state/perceivedState.js`
- Delete entirely (or gut to an empty export shell if still imported anywhere)
- `THREAT_LEVELS` — remove
- `ENTITY_CLASS` — remove
- `initPerceivedState` — remove
- `applyDetectionOutcome` — remove
- `applyCollateralDamageObservation` — remove
- `applyDendriticReturn` — remove
- `applyResponderDeployed` / `applyNeutrophilDeployed` — remove

### `src/state/gameState.js`
- Remove `perceivedState` from state shape and `initGameState`
- Keep `lastKnownNodeStates` (still needed for fog-of-war — stores which nodes are visible)

### `src/state/actions.js`
- Remove `scoutDetections` array (lines ~83-93)
- Remove detection block step 8a (arrived patrol/macrophage → `applyDetectionOutcome`) lines ~135-155
- Remove detection block step 8b (en-route → `applyDetectionOutcome`) lines ~157-173
- Remove step 8c (`applyDendriticReturn` for scout arrivals) lines ~175-179
- Remove `applyCollateralDamageObservation` calls
- Replace all of the above with a single new `runDetectionPhase(...)` call (see below)

### `src/data/detection.js`
- Remove `DETECTION_OUTCOMES` constants
- Remove threat/clean detection profile matrices
- Remove `WRONG_ID_MAP`
- Remove `rollDetection` function
- Replace entirely with new detection probability tables + `performDetection` (see below)

### `src/engine/cells.js`
- Remove `hasDendriticConfirmation(nodeId, perceivedState)` — no longer meaningful

### `src/components/GameShell.jsx`
- Remove `OverviewPanel` derivation from `perceivedState.nodes[x].threatLevel`
- Replace with derivation from node pathogens' `detected_level`

### `src/components/NodeDetail.jsx`
- Remove props: `perceivedState`
- Remove entity-based Threats section
- Replace with per-pathogen display based on `detected_level`

### `src/components/BodyMap.jsx`
- Remove entity-class-based ring logic (orange dashed = PATHOGEN, red = CLASSIFIED)
- Replace with per-pathogen rings based on `detected_level`

---

## New System Design

### Detection rolls per cell type
| Cell type | Rolls per detection opportunity |
|---|---|
| `macrophage` | 1 |
| `neutrophil` (patrol) | 2 |
| `dendritic` (scout) | 3 |

Add `detectionRolls: N` to each cell type in `src/data/cellConfig.js`.

### Roll priority
Rolls are allocated to pathogens on the node ordered by **highest detected_level first** (upgrade existing knowledge before discovering new threats). Within the same level, order by highest load (more active = easier to detect).

Priority order: `classified/misclassified` → `threat` → `unknown` → `none`

If a cell has more rolls than pathogens, remaining rolls are wasted.

### Upgrade probabilities (base rates, per cell type)

```js
// DETECTION_UPGRADE_PROBS[cellType][from_level] = { upgradeChance, misclassifyChance }
// upgradeChance: probability the detected_level increases
// misclassifyChance: (only relevant for threat→classified) chance it becomes 'misclassified' instead
{
  macrophage: {
    none:          { upgradeChance: 0.40 },
    unknown:       { upgradeChance: 0.45 },
    threat:        { upgradeChance: 0.30, misclassifyChance: 0.40 },
    misclassified: { upgradeChance: 0.20 },  // correct a wrong ID
  },
  neutrophil: {
    none:          { upgradeChance: 0.50 },
    unknown:       { upgradeChance: 0.50 },
    threat:        { upgradeChance: 0.20, misclassifyChance: 0.50 },
    misclassified: { upgradeChance: 0.15 },
  },
  dendritic: {
    none:          { upgradeChance: 0.70 },
    unknown:       { upgradeChance: 0.75 },
    threat:        { upgradeChance: 0.60, misclassifyChance: 0.15 },
    misclassified: { upgradeChance: 0.50 },  // scouts are good at correcting misclassifications
  },
}
```

Rolls against `classified` are wasted (already fully known).

### Per-pathogen detection modifier
Add `detectionModifier: number` to each pathogen type in `src/data/pathogens.js`. Applied as a multiplier to `upgradeChance`:

| Type | Modifier | Rationale |
|---|---|---|
| `extracellular_bacteria` | 1.0 | Standard |
| `intracellular_bacteria` | 0.8 | Hides in cells |
| `virus` | 0.8 | Hides inside cells |
| `fungi` | 1.0 | Visible structures |
| `parasite` | 0.9 | Somewhat hidden |
| `toxin_producer` | 0.9 | Indirect evidence |
| `prion` | 0.5 | Very hard to detect |
| `cancer` | 0.6 | Mimics normal cells |
| `autoimmune` | 0.7 | Appears self-like |
| `benign` | 0.7 | Looks normal |

Also apply modifiers from `runModifiers.detection[cellType][pathogenType]` (already wired in modifier schema).

### Misclassification target
When a roll produces `misclassified`, pick a wrong type from the existing `WRONG_ID_MAP` (keep this from `detection.js`). Set `perceived_type` to that wrong type.

When a `misclassified` pathogen is re-rolled and succeeds, set `detected_level = 'classified'` and `perceived_type = instance.type` (the true type).

### `performDetection(cellType, nodePathogens, modifiers)` — new function in `detection.js`
```
Input: cell type string, array of PathogenInstances at a node, modifiers
Output: updated array of PathogenInstances (immutable — returns new array)

1. Get rolls = CELL_DETECTION_ROLLS[cellType]
2. Sort pathogens by level priority (classified first, none last), then by load desc
3. For each roll (up to rolls count):
   a. Take the next pathogen in priority order
   b. Skip if detected_level === 'classified'
   c. Look up upgradeChance for (cellType, detected_level)
   d. Apply pathogen's detectionModifier
   e. Apply runModifiers.detection bonus if present
   f. Roll Math.random() < adjustedChance
   g. If success:
      - If from 'threat': roll misclassifyChance; if miss → classified (perceived_type = true type); if hit → misclassified (perceived_type = WRONG_ID_MAP pick)
      - Otherwise: upgrade level by one step
4. Return updated instances
```

---

## Spreading Changes (`src/engine/pathogen.js`)

### UID lineage for spread
When pathogen A (uid=`path_001`) at nodeX spreads to nodeY, the new instance at nodeY also gets uid=`path_001` (same lineage). This allows nodeY to record immunity to `path_001` if it later clears it.

### Spread check (updated)
Before spreading pathogen (uid=X, type=T) from nodeA to nodeB:
1. ~~No existing pathogen of type T at nodeB~~ (keep existing)
2. **NEW**: nodeB's `immune` array does not contain uid X
3. **NEW**: nodeB's active pathogens array does not already contain uid X

In practice (3) is covered by (1) since a node won't have two active instances of the same uid, but it's good to be explicit.

### Clearance → immunity
In `advanceInstance` (or the clearance block in `advanceGroundTruth`), when a pathogen instance's actualLoad drops to ≤ 0:
- Emit `pathogen_cleared` event (already happens)
- **NEW**: Add `instance.uid` to `nodeState.immune` array

---

## Spawning Changes (`src/engine/spawner.js`)

When spawning a new pathogen at a node, check that the node's `immune` array does not already contain the uid of the new instance. Since new spawns generate fresh uids, this is a non-issue — immune only blocks spread of existing lineages. **No changes needed to spawner.**

---

## UID Generation

Add `generatePathogenUid()` utility (simple counter or `crypto.randomUUID()` fallback):
```js
let _uidCounter = 0;
export function generatePathogenUid() {
  return `path_${++_uidCounter}`;
}
```
Place in `src/engine/pathogen.js` or a new `src/engine/uid.js`.

---

## Turn Order Changes (`src/state/actions.js`)

Replace steps 3, 8a, 8b, 8c with:

**New step 3 (after advanceCells, before advanceGroundTruth):**
```
runDetectionPhase(deployedCells, nodesVisited, groundTruth, modifiers)
→ returns updated groundTruth (with modified detected_levels on pathogen instances)
```

`runDetectionPhase`:
1. Build a map of `nodeId → Set<cellId>` for all cells that detect this turn:
   - Arrived cells: their current nodeId; macrophages also cover adjacent nodes
   - nodesVisited (en-route): each entry's nodeId
2. For each (nodeId, cells) pair:
   - Collect the node's pathogens array
   - For each detecting cell, call `performDetection(cellType, pathogens, modifiers)`
   - Merge results (take highest detected_level for each uid across all cells' results — detection never downgrades)
3. Write updated pathogen instances back into groundTruth

Note: run BEFORE `advanceGroundTruth` so detection sees current pathogen state. (Scouts detect before GT advances, same as now.)

**Remove** the now-redundant `lastKnownNodeStates` update to `perceivedState` (step 8c). Fog-of-war still snapshots via `lastKnownNodeStates` but those snapshots now include the pathogen array with detected_levels rather than perceived entities.

---

## Display Changes

### Fog-of-war
- `lastKnownNodeStates` continues to hold the last-seen snapshot of each visible node
- For invisible nodes: show nothing (no rings, no pathogen info)
- For visible nodes: read pathogens array directly from groundTruth

### Per-pathogen rings (`BodyMap.jsx`)
Replace entity-class-based ring with per-pathogen ring:
| detected_level | Ring style |
|---|---|
| `none` | Not shown |
| `unknown` | Thin dashed grey ring |
| `threat` | Dashed orange ring |
| `misclassified` | Solid red ring (labelled with wrong type) |
| `classified` | Solid red ring (labelled with true type) |

If multiple pathogens at the same node, show concentric rings (or stack rings offset).

### NodeDetail Threats section
Replace foreign entities list with per-pathogen rows:
- For each pathogen with `detected_level !== 'none'`:
  - `unknown`: "Unknown anomaly" + no load bar (load is hidden)
  - `threat`: "Unclassified threat" + no load bar
  - `misclassified`: `[perceived_type label]` + load bar (load shown — player acts on wrong info)
  - `classified`: `[type label]` + real load bar

### OverviewPanel alert derivation (`GameShell.jsx`)
Replace `perceivedState.nodes[x].threatLevel` with: node has any pathogen with `detected_level !== 'none'`.
- Alert (red): any `threat | classified | misclassified`
- Warning (yellow): any `unknown`

---

## Implementation Order

Work in this sequence to keep the game runnable at each step:

### Step 1 — UID + immune array (groundTruth + pathogen)
- Add `generatePathogenUid()` to `pathogen.js`
- Add `uid`, `detected_level: 'none'`, `perceived_type: null` to pathogen instance creation
- Change `nodeState.pathogens` from dict to array in `makeCleanSiteState`, `initGroundTruth`
- Add `immune: []` to `makeCleanSiteState`
- Update all code that reads/writes `nodeState.pathogens[type]` to iterate the array:
  - `pathogen.js`: `getClearancePower`, `advanceInstance`, `computeSpreads`, `shouldWallOff`
  - `groundTruth.js`: `advanceGroundTruth` (all pathogen iteration, spread application, spawn application)
  - `systemicValues.js`: `nodeHasActivePathogen` calls
  - `spawner.js`: existing pathogen check before spawn
- Add uid-to-immune on clearance in `groundTruth.js`
- Update spreading to check uid in target node's `immune` array and active pathogens
- When spreading, child instance gets same uid as parent

### Step 2 — New detection system
- Replace `src/data/detection.js` with new probability tables + `performDetection`
- Add `detectionRolls` to each cell type in `cellConfig.js`
- Add `detectionModifier` to each pathogen type in `pathogens.js`

### Step 3 — Wire detection into turn order
- Add `runDetectionPhase` function (can live in `detection.js` or `actions.js`)
- Replace steps 3/8a/8b/8c in `handleEndTurn` with `runDetectionPhase`
- Remove `scoutDetections` array, `applyDetectionOutcome`, `applyDendriticReturn`, `applyCollateralDamageObservation` calls

### Step 4 — Remove perceivedState
- Remove `perceivedState` from `gameState.js` / `initGameState`
- Remove `hasDendriticConfirmation` from `cells.js`
- Delete/gut `perceivedState.js`

### Step 5 — Update display components
- Update `BodyMap.jsx`: pathogen rings from `detected_level`
- Update `NodeDetail.jsx`: remove perceivedState prop, rewrite Threats section
- Update `GameShell.jsx` OverviewPanel: derive alerts from pathogens

### Step 6 — Update `lastKnownNodeStates` fog-of-war
- Ensure snapshot stores full node state including pathogen array with detected_levels
- Confirm display still works for not-yet-visited nodes

### Step 7 — Cleanup
- Remove old imports across all files
- Update design docs

---

## Files Changed Summary

| File | Change |
|---|---|
| `src/data/detection.js` | Full rewrite — new probability tables + `performDetection` |
| `src/data/pathogens.js` | Add `detectionModifier` to each type |
| `src/data/cellConfig.js` | Add `detectionRolls` to each cell type |
| `src/engine/pathogen.js` | Add uid generation; update instance shape; update spread/clearance; change pathogens array iteration |
| `src/engine/groundTruth.js` | pathogens array (not dict); immune array; uid-on-clearance; spread uid check |
| `src/engine/cells.js` | Remove `hasDendriticConfirmation` |
| `src/engine/spawner.js` | Minor: update pathogen existence check for array format |
| `src/engine/systemicValues.js` | Update `nodeHasActivePathogen` / any pathogen iteration |
| `src/state/gameState.js` | Remove `perceivedState`; update `initGameState` |
| `src/state/perceivedState.js` | Delete or gut |
| `src/state/actions.js` | Replace detection steps 3/8a/8b/8c with `runDetectionPhase`; remove perceivedState refs |
| `src/components/GameShell.jsx` | OverviewPanel alerts from pathogen detected_level |
| `src/components/BodyMap.jsx` | Rings from pathogen detected_level |
| `src/components/NodeDetail.jsx` | Threats section from pathogen detected_level; remove perceivedState prop |

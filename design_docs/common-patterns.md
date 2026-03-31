# Memory Cell — Common Patterns

How-to recipes for common feature additions and changes.

---

## Adding a new cell type

1. Add entry to `CELL_CONFIG` in `cellConfig.js` with all fields:
   - `displayName`, `deployCost`, `clearanceRate`, `trainingTicks`, `displayOrder`, `color`, `textClass`, `dotClass`, `startingCount`
   - Role flags: `isRecon`, `isAttack`, `isPatrol`, `isScout`, `requiresClassified`, `coversAdjacentNodes`
   - `detectionRolls`, `detectionUpgradeProbs` (null for non-recon)
   - `clearablePathogens: { [pathogenType]: effectivenessMultiplier }` — what it can clear
   - `effectivenessByLevel: { none, unknown, threat, misclassified, classified }` — effectiveness at each intel level
2. Add type constant to `CELL_TYPES` in `cells.js`
3. If the cell has unique arrival behaviour (e.g. dwell timer), add a flag to `CELL_CONFIG` and handle it in `advanceCells` in `cells.js`
4. If the cell type should be available to the player for training, add it to `availableResponders` in `runConfig.js`

All UI (roster, body map, start screen, node detail) derives colours, labels, and ordering from `CELL_CONFIG` automatically.

---

## Adding a new pathogen type

1. `PATHOGEN_TYPES` + `PATHOGEN_SIGNAL_TYPE` + `PATHOGEN_DISPLAY_NAMES` in `pathogens.js`
2. Entry in `PATHOGEN_REGISTRY` in `pathogens.js` (actualLoad, growth, rates — **no clearableBy**)
3. Add the pathogen type to `clearablePathogens` on each cell that should be able to clear it in `cellConfig.js`
4. `BASE_WEIGHTS` entry in `spawnConfig.js` to control spawn frequency
5. Optionally: special behaviour hook in `advanceInstance` in `pathogen.js`

---

## Changing which cells can clear a pathogen

Edit `clearablePathogens` on the relevant cell entries in `CELL_CONFIG` (`cellConfig.js`). The value is an effectiveness multiplier (1.0 = full clearance rate; 0.5 = half; absent = cannot clear).

---

## Changing clearance effectiveness by detection level

Edit `effectivenessByLevel` on the cell entry in `CELL_CONFIG`. This controls how much of the cell's clearance rate applies based on how well the pathogen has been detected:

```js
effectivenessByLevel: {
  none:          0.5,   // no intel — low effectiveness
  unknown:       0.5,
  threat:        0.7,   // confirmed threat — moderate
  misclassified: 0.7,
  classified:    1.0,   // fully identified — full effectiveness
}
```

Modifier upgrades can boost per-level effectiveness via `cells[type].effectivenessLevelBonus[level]`.

---

## Applying an upgrade / scar / decision

Dispatch `APPLY_MODIFIER` with a `patch` — it deep-merges into `state.runModifiers` and all engine functions pick it up automatically on the next turn.

```js
// Boost responder clearance 30%:
const current = state.runModifiers.cells?.responder?.clearanceRateMultiplier ?? 1.0;
dispatch({ type: 'APPLY_MODIFIER', patch: { cells: { responder: { clearanceRateMultiplier: current * 1.3 } } } });

// Improve scout classification accuracy:
dispatch({ type: 'APPLY_MODIFIER', patch: { cells: { dendritic: { trainingTicksDelta: 10 } } } });

// Boost B-Cell effectiveness when classified:
dispatch({ type: 'APPLY_MODIFIER', patch: { cells: { b_cell: { effectivenessLevelBonus: { classified: 0.05 } } } } });

// Open a new route (decision):
dispatch({ type: 'APPLY_MODIFIER', patch: { nodes: { LIVER: { addedConnections: ['CHEST'] } } } });

// Make bacteria grow faster (hard mode modifier):
dispatch({ type: 'APPLY_MODIFIER', patch: { pathogens: { extracellular_bacteria: { growthRateMultiplier: 1.4 } } } });
```

For numeric stacking: always read the current value from `state.runModifiers` before computing the new combined value.

---

## Adding a new node

1. Add entry to `NODES` in `nodes.js` (include `connections`, `signalTravelCost: 1`)
2. Update `connections` arrays of adjacent nodes
3. Update SVG position — `position: {x, y}` in the 0-400 coordinate space

---

## Changing movement speed

- Node exit cost: `signalTravelCost` in `nodes.js`
- Turn budget (always 1): `advanceCells` in `cells.js`

---

## Changing signal detection quality

- Per-cell detection probabilities: `detectionUpgradeProbs` in `CELL_CONFIG` (`cellConfig.js`)
- Detection rolls per visit: `detectionRolls` in `CELL_CONFIG`

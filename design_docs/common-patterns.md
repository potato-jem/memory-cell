# Memory Cell — Common Patterns

How-to recipes for common feature additions and changes.

---

## Adding a new cell type

1. Add entry to `CELL_CONFIG` in `cellConfig.js` (deployCost, clearanceRate, role flags, effectiveness values)
2. Add type constant to `CELL_TYPES` in `cells.js`
3. `TRAINING_TICKS` entry in `gameConfig.js`
4. `_deployExtra` in `cells.js` for any type-specific cell fields (patrol index, dwell tick, etc.)
5. `CELL_DOT_COLORS` + `CELL_TYPE_ORDER` in `BodyMap.jsx`
6. Train button in `CellRoster.jsx`

---

## Adding a new pathogen type

1. `PATHOGEN_TYPES` + `PATHOGEN_SIGNAL_TYPE` + `PATHOGEN_DISPLAY_NAMES` in `pathogens.js`
2. Entry in `PATHOGEN_REGISTRY` in `pathogens.js` (trackedValue, growth, rates, clearableBy)
3. `BASE_WEIGHTS` entry in `spawnConfig.js` to control spawn frequency
4. Optionally: special behaviour hook in `advanceInstance` in `pathogen.js`

---

## Applying an upgrade / scar / decision

Dispatch `APPLY_MODIFIER` with a `patch` — it deep-merges into `state.runModifiers` and all engine functions pick it up automatically on the next turn.

```js
// Boost responder clearance 30%:
const current = state.runModifiers.cells?.responder?.clearanceRateMultiplier ?? 1.0;
dispatch({ type: 'APPLY_MODIFIER', patch: { cells: { responder: { clearanceRateMultiplier: current * 1.3 } } } });

// Slow scout training (scar):
dispatch({ type: 'APPLY_MODIFIER', patch: { cells: { dendritic: { trainingTicksDelta: 10 } } } });

// Open a new route (decision):
dispatch({ type: 'APPLY_MODIFIER', patch: { nodes: { LIVER: { addedConnections: ['CHEST'] } } } });

// Make bacteria grow faster (hard mode modifier):
dispatch({ type: 'APPLY_MODIFIER', patch: { pathogens: { extracellular_bacteria: { growthRateMultiplier: 1.4 } } } });
```

For numeric stacking: always read the current value from `state.runModifiers` before computing the new combined value (see `runModifiers.js` in `data-layer.md` — Stacking upgrades pattern).

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

- Per-cell detection probabilities: `detection.js`
- En-route vs arrived detection: `signalGenerator.js` (`generateSignals` = arrived only, `generateSignalsForVisits` = en-route)

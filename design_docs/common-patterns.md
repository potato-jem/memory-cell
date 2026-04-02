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

1. `PATHOGEN_TYPES` +  `PATHOGEN_DISPLAY_NAMES` in `pathogens.js`
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

## Upgrade and Scar system

### Overview

The modifier system presents choices to the player at two trigger points:

- **Upgrades** — triggered when a pathogen is cleared; player selects a beneficial modifier from 3 options
- **Scars** — triggered when node tissue integrity crosses a threshold (50%, 25%, 0%); player selects which negative consequence to accept

All available upgrades are defined in `src/data/modifierLibrary.js` (`UPGRADE_LIBRARY`) and scars in `SCAR_LIBRARY`. The player's choice is dispatched as `CHOOSE_MODIFIER` which applies it to `runModifiers`.

### Pending choices

After `END_TURN`, new choices are queued in `state.pendingModifierChoices[]`. Each entry has `{ id, category, options: [...] }`. The UI should show the first pending choice and dispatch `CHOOSE_MODIFIER` to resolve it before the player can end the next turn.

The simulation auto-resolves pending choices randomly after each `END_TURN`.

### Adding a new modifier (upgrade or scar)

Add an entry to `UPGRADE_LIBRARY` or `SCAR_LIBRARY` in `src/data/modifierLibrary.js`:

```js
{
  id: 'my_upgrade',
  category: 'upgrade',             // or 'scar'
  name: 'My Upgrade',
  description: '{clearingCellType} becomes more effective',  // template vars supported
  baseProbability: 1.0,            // relative weight in selection pool
  eligibleFor: (ctx) => ctx.clearingCellType && ctx.cellConfig?.clearanceRate > 0,
  rarityLevels: [
    { rarity: 'common', probability: 0.60, value: 1.15 },
    { rarity: 'rare',   probability: 0.30, value: 1.25 },
    { rarity: 'epic',   probability: 0.10, value: 1.40 },
  ],
  getPatch: (ctx, value, mods) => {
    // value = the selected rarity's value; mods = current runModifiers for stacking
    const current = mods?.cells?.[ctx.clearingCellType]?.clearanceRateMultiplier ?? 1.0;
    return { cells: { [ctx.clearingCellType]: { clearanceRateMultiplier: current * value } } };
  },
  // Optional: applied immediately to state when chosen (not via runModifiers)
  immediateEffect: (_ctx, value) => ({ tokenCapacityBonus: value }),
}
```

**Key design rules:**
- `eligibleFor` should check **properties** (e.g. `clearanceRate > 0`, `isRecon === true`), not hardcoded IDs. This ensures the modifier pool remains valid as cell/pathogen configs evolve.
- `getPatch` is called at **apply time** (not generation time) with the then-current `runModifiers`, ensuring correct multiplier stacking even when multiple choices are queued.
- Single-rarity modifiers set `probability: 1.0` on the one entry.
- `baseProbability` controls how often this modifier appears relative to others in the pool.

### Eligibility context

**Upgrade context** (`ctx`):
```js
{
  category: 'upgrade',
  clearingCellType: 'responder',      // null if no clear-contributing cell found
  clearedPathogenType: 'virus',
  nodeId: 'CHEST',
  cellConfig: CELL_CONFIG['responder'],
  pathogenConfig: PATHOGEN_REGISTRY['virus'],
  runModifiers: { ... },
}
```

**Scar context** (`ctx`):
```js
{
  category: 'scar',
  nodeId: 'CHEST',                    // null for systemic scars
  scarType: 'site_integrity',         // or 'systemic_integrity'
  threshold: 50,                      // 50 | 25 | 0
  isMinor: true,                      // threshold === 50
  isCritical: false,                  // threshold === 0
  nodeConfig: NODES['CHEST'],
  runModifiers: { ... },
}
```

### Modifier schema quick-reference

New fields added alongside existing ones (see `runModifiers.js` for full schema):

| Path | Effect |
|---|---|
| `cells[type].detectionRollsBonus` | Extra detection rolls per visit (integer) |
| `pathogens[type].inflammationRateMultiplier` | Scales inflammation output per turn |
| `nodes[nodeId].cellClearanceMultiplier` | Scales all cell clearance at this node |
| `nodes[nodeId].inflammationDecayMultiplier` | Scales inflammation decay rate at this node |
| `systemic.globalSpawnWeightMultiplier` | Scales all pathogen type spawn weights globally |

### Applying a modifier directly (bypasses choice system)

For testing or scripted events, dispatch `APPLY_MODIFIER` with a `patch`:

```js
// Boost responder clearance 30%:
const current = state.runModifiers.cells?.responder?.clearanceRateMultiplier ?? 1.0;
dispatch({ type: 'APPLY_MODIFIER', patch: { cells: { responder: { clearanceRateMultiplier: current * 1.3 } } } });

// Improve scout classification accuracy:
dispatch({ type: 'APPLY_MODIFIER', patch: { cells: { dendritic: { trainingTicksDelta: 10 } } } });

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

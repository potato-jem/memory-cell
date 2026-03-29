# Implementation Plan — Design Doc v2 Health & Pathogen Redesign

## Scope

Replace the coherence/health system with the new systemic values model (SystemicStress, SystemicIntegrity, Fever). Add per-site pathogen load tracking with type-specific behaviour. Replace seeded situation events with probabilistic spawning. Update all UI to reflect the new model.

**Out of scope for this pass:** Roguelite upgrade picker (pick-from-3 after clearing), narrative events UI, intracellular bacteria / cancer / prion full implementations (stubs only), parasite specialist cells (eosinophil).

---

## Step 1 — `gameConfig.js`: New constants

Add all numeric constants for the new systems:
- `PATHOGEN_TYPES` enum replacing old THREAT_TYPES references in config
- Inflammation thresholds (25 / 50 / 75 for damage tiers)
- Tissue integrity recovery rate (2/turn when clear + inflation < 30)
- Scar ceiling drop threshold (falls below 40 → max = lowestPoint + 25)
- Systemic stress sources (per-site inflammation threshold, multi-site penalty, fever bonus, toxin contribution)
- Systemic integrity hit amounts per stress threshold band
- Spawn system constants (base spawn chance, per-turn decay, min floor)
- Token capacity regen interval (keep existing)

---

## Step 2 — `src/data/pathogens.js` (new file): Pathogen type definitions

Create a central registry of all pathogen types with their parameters:

```
PATHOGEN_REGISTRY = {
  extracellular_bacteria: {
    trackedValue: 'infectionLoad',
    replicationRate: 0.25,       // load × rate per turn
    spreadThreshold: 80,
    spreadStrength: 10,
    tissueDamagePerTurn: 1,      // per 10 load
    inflammationPerTurn: 0.5,    // per 10 load
    clearableBy: ['neutrophil', 'macrophage', 'responder'],
  },
  virus: {
    trackedValue: 'cellularCompromise',
    replicationRate: 0.50,       // exponential: compromise × rate
    spreadThreshold: 60,
    tissueDamageOnClearance: true,  // 1 integrity per 5 compromise cleared
    clearableBy: ['killer_t', 'nk_cell'],
    immuneToAntibody: true,
  },
  fungi: {
    trackedValue: 'infectionLoad',
    replicationRate: 0.10,
    spreadThreshold: null,       // does not spread actively
    granulomaThreshold: 60,      // triggers Walled Off state
    thrivesAboveSystemicStress: 70,  // replication doubles
    clearableBy: ['macrophage', 'responder'],  // + antifungal ability (future)
  },
  parasite: {
    trackedValue: 'parasiticBurden',
    replicationRate: 0.15,
    immuneSuppression: true,     // reduces local inflammation generation by 50% above burden 50
    movementPenalty: true,       // transit to/from site takes +1T per 25 burden
    tissueDamagePerTurn: 0.5,
    clearableBy: [],             // requires eosinophil (future)
  },
  toxin_producer: {
    trackedValue: 'infectionLoad',
    replicationRate: 0.08,
    spreadThreshold: null,
    toxinOutputPerLoad: 0.5,     // feeds directly into systemicStress
    clearableBy: ['macrophage', 'responder'],
  },
  prion: {
    trackedValue: 'corruptionLevel',
    replicationRate: 0.12,
    hiddenUntil: 50,             // invisible to player below this value
    tissueDamageAbove: 50,       // 2 integrity/turn when corruption > 50
    clearableBy: [],             // cannot be cleared, only slowed
  },
  // Stubs:
  intracellular_bacteria: { trackedValue: 'cellularCompromise', replicationRate: 0.08, clearableBy: ['killer_t'] },
  cancer: { trackedValue: 'cellularCompromise', replicationRate: 0.05, clearableBy: ['nk_cell', 'killer_t'] },
  autoimmune: { trackedValue: 'infectionLoad', replicationRate: 0.05, clearableBy: [] },
}
```

---

## Step 3 — `src/engine/pathogen.js`: Rewrite for multi-type model

Replace the single `strength` value system with type-dispatch per-site:

- `advancePathogenInstance(instance, siteDef, deployedCellsAtSite, systemicStress)` — returns `{ newInstance, tissueIntegrityDelta, inflammationDelta, toxinOutput }`
- Each pathogen type runs its own growth/clearance/effect logic
- Clearance now checks which cell types are present and if they can clear this pathogen type
- Spread: bacteria spread at infectionLoad > 80, virus at cellularCompromise > 60, others as per registry
- `isInstanceCleared(instance)` — all tracked values <= 0

Keep: `getInfectedNodes`, `getTotalPathogenLoad` (replacing getTotalPathogenStrength)

---

## Step 4 — `src/engine/groundTruth.js`: New site state structure + advancement

**New per-site state:**
```js
{
  // Pathogen loads (one entry per active pathogen type)
  pathogens: {}, // { [pathogenId]: { type, infectionLoad?, cellularCompromise?, parasiticBurden?, corruptionLevel? } }

  // Local values
  inflammation: 0,           // 0-100
  tissueIntegrity: 100,      // 0-100
  tissueIntegrityCeiling: 100, // drops permanently if integrity < 40

  // State flags
  isWalledOff: false,        // fungi granuloma
  immuneSuppressed: false,   // parasite suppression
  transitPenalty: 0,         // extra turns for deployment
}
```

**New `initGroundTruth(runConfig)`:**
- All sites start clean with integrity 100
- No starting pathogen (spawner handles first spawn)

**New `advanceGroundTruth(groundTruth, deployedCells, turn, systemicStress, pendingSpawns)`:**
1. For each site, advance all pathogen instances → collect tissueIntegrityDeltas, inflammationDeltas, toxinOutputs
2. Apply clearance from present immune cells (type-matched)
3. Update inflammation: pathogen contribution + immune cell contribution − decay
4. Apply tissue integrity damage: from pathogens + inflammation above 25 threshold
5. Apply tissue integrity recovery: +2/turn if no infection and inflammation < 30
6. Update tissueIntegrityCeiling: if integrity drops below 40, ceiling = max(ceiling, lowestPoint + 25)
7. Apply pending spawns from spawner
8. Remove cleared pathogen instances
9. Return `{ newGroundTruth, events }` — events include 'pathogen_cleared', 'site_walled_off', 'pathogen_spread'

Remove: seeded event processing (handled in spawner now)

---

## Step 5 — `src/engine/spawner.js` (new file): Probabilistic pathogen events

Replaces seeded situation events. Two layers:

**Layer A — Base spawn probability (per turn):**
```js
baseSpawnChance(turn, activeInfections) {
  // Starts at 0.6, decays toward 0.2 over ~20 turns
  // Increases if activeInfections === 0 (nothing is happening)
  // Decreases if activeInfections >= 3 (player already overwhelmed)
}
```

**Layer B — Given spawn, select (pathogen type × node):**
```js
SPAWN_WEIGHTS = {
  // [pathogenType][nodeId] = base weight
  extracellular_bacteria: { GUT: 30, LIVER: 20, THROAT: 15, CHEST: 15, BLOOD: 10, PERIPHERY: 10 },
  virus:                  { THROAT: 35, CHEST: 25, BLOOD: 20, GUT: 10, LIVER: 5, PERIPHERY: 5 },
  fungi:                  { CHEST: 30, LIVER: 25, BLOOD: 20, GUT: 15, THROAT: 5, PERIPHERY: 5 },
  toxin_producer:         { GUT: 40, LIVER: 30, BLOOD: 20, CHEST: 5, THROAT: 3, PERIPHERY: 2 },
  parasite:               { BLOOD: 30, GUT: 25, LIVER: 20, PERIPHERY: 15, CHEST: 7, THROAT: 3 },
  // prion, intracellular_bacteria, cancer: low weights, unlocked at higher turns
}
```

**Layer C — Conditional modifiers:**
- Existing high inflammation at node: × 1.5 chance for bacteria/fungi (inflamed tissue is vulnerable)
- Existing pathogen at node: ×0 (no double-spawning same node)
- Systemic stress > 70: fungi weight × 2.0
- Turn < 10: prion/cancer weight × 0 (too early)

**Scheduled spikes:**
```js
SPAWN_SCHEDULE = [
  { turn: 3, boostType: 'extracellular_bacteria', boostMultiplier: 2.0 },
  { turn: 8, boostType: null, boostMultiplier: 1.5 }, // general spike
  // etc — these make "something happens early" more likely without guaranteeing
]
```

Returns `pendingSpawns: [{ type, nodeId, initialLoad }]` for groundTruth to apply.

---

## Step 6 — `src/engine/systemicValues.js` (new file): Replace coherence.js

```js
computeSystemicStress(groundTruth, fever, turn) → { stress, sources }
  // Inputs:
  // - sites with inflammation > 40: +8 each (first), +12 each (subsequent — non-linear)
  // - fever active: +5/turn
  // - toxin output across all sites: direct contribution
  // - any site tissueIntegrity < 30: +6
  // - 3+ active infected sites simultaneously: +10
  // Decay: -5/turn baseline when no active infections

applySystemicIntegrityHits(systemicIntegrity, systemicStress) → newIntegrity
  // systemicStress 80-90: -1/turn
  // systemicStress 90-100: -3/turn
  // systemicStress 100 (cap): -5/turn

isFeverAppropriate(groundTruth) → bool (hint for player)

computeScars(groundTruth) → Scar[]
  // Check all sites for integrity thresholds crossed
  // Check systemicIntegrity history for 50% crossing
```

---

## Step 7 — `src/data/runConfig.js` (new file): Replace situationDef

Single endless run config (replaces all situation files and SituationSelector):
```js
export const DEFAULT_RUN_CONFIG = {
  id: 'endless',
  name: 'Endless Run',
  spawnSchedule: [...],          // scheduled probability spikes
  availableResponders: ['responder', 'killer_t', 'b_cell', 'nk_cell'],
  unlockTurn: {                  // when harder pathogens become available
    prion: 30, cancer: 25, intracellular_bacteria: 15,
  },
};
```

Keep `SituationSelector` as a thin wrapper or remove it; show a simple "Start Run" screen.

---

## Step 8 — `gameState.js`: New initial state

Replace:
- `healthScore` / `coherenceScore` / `coherenceHistory` → `systemicStress`, `systemicIntegrity`, `systemicStressHistory`
- `situationStates: []` → single `groundTruth` + `perceivedState` at top level (or keep array with 1 element)
- Add: `fever: { active: false, intensity: 0 }`
- Add: `scars: []`
- Add: `turn: 0` (keep existing)

---

## Step 9 — `actions.js`: Rewrite END_TURN handler

Replace `handleEndTurn` pathogen/health logic:
1. Advance cells (existing — keep)
2. Run spawner → get `pendingSpawns`
3. Run `advanceGroundTruth(groundTruth, deployedCells, turn, systemicStress, pendingSpawns)`
4. Run `computeSystemicStress(groundTruth, fever, turn)` → `newSystemicStress`
5. Run `applySystemicIntegrityHits(systemicIntegrity, newSystemicStress)` → `newSystemicIntegrity`
6. Generate signals (existing signal generator — keep, adapt to new pathogen values)
7. Update perceived state (keep existing)
8. Check loss: `systemicIntegrity <= 0`
9. Token capacity regen (keep existing)

Remove: `computeCoherence`, `isCoherenceCollapsed`, all `situationStates` array mapping

Add: `TOGGLE_FEVER` action (player ability)

---

## Step 10 — UI updates

**GameShell.jsx header:**
- Replace `TokenPool` with `SystemicBar` showing: stress gauge (0-100, colour-coded) + integrity value + fever toggle button
- Remove concurrent situation tabs

**NodeDetail.jsx:**
- Replace deploy hint section with proper pathogen display
- Add: inflammation bar, tissue integrity bar (with ceiling indicator)
- Show per-pathogen-type loads at this node
- Show `Walled Off` flag for fungi granuloma
- Show tissue integrity ceiling if it has dropped

**BodyMap.jsx:**
- Node colour now based on: worst of (infection load, inflammation level, integrity loss)
- New status: WALLED_OFF (grey/contained look)
- Show integrity as subtle fill level inside node circle

**CellRoster.jsx:**
- No changes needed (cell lifecycle unchanged)

**OverviewPanel in GameShell.jsx:**
- Show systemic stress trend (last 5 turns)
- Show systemic integrity bar
- Show fever status + suppress button
- Show scar list

---

## Execution Order

1. gameConfig.js (constants only, no logic)
2. src/data/pathogens.js (new registry)
3. src/engine/pathogen.js (rewrite)
4. src/engine/groundTruth.js (rewrite)
5. src/engine/spawner.js (new)
6. src/engine/systemicValues.js (new, replaces coherence.js)
7. src/data/runConfig.js (new, replaces situation files)
8. gameState.js (new initial state)
9. actions.js (rewrite END_TURN)
10. UI updates (GameShell, NodeDetail, BodyMap, OverviewPanel)

Build and smoke-test after each step where possible (steps 1-7 are pure logic, steps 8-10 are wired in).

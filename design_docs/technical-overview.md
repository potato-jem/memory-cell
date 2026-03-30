# Memory Cell — Technical Overview

This document covers the high-level architecture, file map, and end-to-end information flow. See the other technical docs for per-layer detail.

**Related docs:** `data-layer.md`, `engine-layer.md`, `state-and-components.md`, `common-patterns.md`

---

## Overview

Memory Cell is a turn-based strategy game set inside the human immune system. The player controls immune cells deployed to body nodes, responding to pathogens detected via imperfect surveillance.

**Tech stack:** React + Vite, Tailwind CSS v3, `useReducer` for game state.

**Core design principles:**
- **Information asymmetry**: the simulation ("ground truth") is hidden. Players perceive it only through detection rolls made by deployed cells, which update perceived state directly — there are no intermediate signal objects.
- **Pure functions everywhere**: all game logic is in pure functions outside React. Components only dispatch actions.
- **Turn-based**: the player clicks "End Turn". Each turn = 5 ticks of simulation time.

---

## File Map

```
src/
  data/           — static definitions (no logic, no React)
    gameConfig.js    — ALL tunable numeric constants (balance live here)
    cellConfig.js    — cell type registry (costs, rates, behaviors)
    spawnConfig.js   — spawn weights, unlock turns, schedule
    runModifiers.js  — runtime modifier system (upgrades/scars/decisions)
    nodes.js         — body map topology + path computation
    pathogens.js     — pathogen registry
    detection.js     — detection probability matrix
    signals.js       — minimal constants (THREAT_TYPES, CONFIDENCE_LEVELS) used by memory.js
    runConfig.js     — default starting units
  engine/         — pure simulation functions
  state/          — game state shape + reducer
  components/     — React UI
```

---

## Information Flow Summary

```
Player clicks "End Turn"
        │
        ▼
actions.js :: handleEndTurn
        │
        ├─ cells.js :: advanceCells
        │       └─► nodesVisited (intermediate nodes touched)
        │       └─► events (scout_arrived)
        │
        ├─ detection rolls against current GT for scout arrivals (before GT advances)
        │
        ├─ spawner.js :: rollSpawns
        │
        ├─ groundTruth.js :: advanceGroundTruth
        │       └─► pathogen.js :: advanceInstance (per pathogen per node)
        │       └─► pathogen.js :: computeSpreads
        │
        ├─ detection.js :: rollDetection — arrived patrol/macrophage cells (per node)
        │       └─► perceivedState.js :: applyDetectionOutcome / applyCollateralDamageObservation
        │
        ├─ detection.js :: rollDetection — en-route via nodesVisited
        │       └─► perceivedState.js :: applyDetectionOutcome
        │
        ├─ perceivedState.js :: applyDendriticReturn (scout arrivals)
        │
        ├─ systemicValues.js :: computeSystemicStress
        ├─ systemicValues.js :: applySystemicIntegrityHits
        │
        └─ Loss check → phase = 'lost' if integrity ≤ 0
```

```
Player right-clicks node → deploy
        │
        ▼
actions.js :: handleDeployFromRoster
        │
        ├─ cells.js :: deployFromRoster
        │       └─► nodes.js :: computePath (Dijkstra)
        │       └─► perceivedState.js :: hasDendriticConfirmation
        │
        └─ perceivedState.js :: applyNeutrophilDeployed / applyResponderDeployed
```

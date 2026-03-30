Always use git -C <path> instead of cd <path> && git

## Design docs

If uesful, read the relevant file from `design_docs/`. Please also update the relevant design doc at the conclusion of editing as necessary.

- `game-design.md` — game concept, design pillars, all mechanics (cells, pathogens, site system, systemic values, spawn, visibility, token economy)
- `technical-overview.md` — architecture, file map, end-to-end turn flow diagrams
- `data-layer.md` — `src/data/` files: gameConfig, cellConfig, spawnConfig, runModifiers, nodes, pathogens, signals, detection
- `engine-layer.md` — `src/engine/` files: cells, groundTruth, pathogen, signalGenerator, spawner, systemicValues
- `state-and-components.md` — `src/state/` (gameState, perceivedState, actions/reducer) and `src/components/`
- `common-patterns.md` — how to add a cell type, pathogen type, modifier, or node
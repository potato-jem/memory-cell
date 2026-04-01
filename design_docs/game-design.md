# Memory Cell — Game Design Document

---

## What This Game Is

You are the coordination intelligence of a human immune system

---

## Design Pillars

**Every decision is legible.** When you take damage, it should be clear why. Pathogens behave consistently. Systemic consequences follow from traceable causes. Death teaches.

**Wins leave marks.** Clearing an infection always costs something. Runs feel cumulative even within a single playthrough.

**Triage, not optimisation.** Multiple simultaneous threats are qualitatively more dangerous than one large threat. The game rewards sequencing and prioritisation.

---

## Four Failure Modes

1. **You didn't know the threat was there** — missed detection, inadequate surveillance coverage
2. **You knew but couldn't respond fast enough** — correct intelligence, wrong prioritisation or slow deployment
3. **Your response caused more damage than the threat** — over-response, collateral inflammation, autoimmune cascade
4. **You were actively deceived** — a threat mimicking healthy tissue or suppressing its own signal

Each failure is legible in retrospect. Each teaches something true about how complex systems fail.

---

## The Cellular Cast

### Scout (Dendritic Cell)
Slow, expensive, high-value. Travels to a specific node, dwells for 2 turns sampling it, returns with definitive intelligence — a single high-accuracy detection roll that upgrades the entity to **classified** (full type identification). Does not fight. Scouts provide en-route visibility at intermediate nodes on the way to their destination.

### Patrol (Neutrophil)
Fast, cheap, continuous. Deploys to a node and cycles through adjacent nodes. Makes a detection roll each turn from wherever it currently is — broad coverage, moderate accuracy. Also makes en-route detection rolls when travelling through intermediate nodes.

### Macrophage
Static coverage with adjacent node awareness. Higher detection quality than patrol. Can provide en-route detection when redeployed.

### Responder / Killer T / B-Cell / NK Cell
Attack cells. Follow the path system to their destination but only fight at the final node — en-route they contribute no combat. Responders and B-Cells benefit from prior scout confirmation (full effectiveness vs 60%). Killer T requires scout confirmation to deploy. NK Cell operates without prior intelligence but carries higher autoimmune risk.

### Memory Bank
After a pathogen is cleared, a memory entry is recorded. In subsequent runs, previously encountered pathogen types arrive pre-classified — you become more literate, not more powerful.

---

## The Body Map

Seven nodes connected by a movement graph. Each connection is traversable; movement cost is determined by the **exit cost** of the node being left.

```
BLOOD (HQ, cost 0)
        │
┌───────┼───────┐
CHEST  LIVER  MUSCLE
  │      │      │
THROAT  GUT  PERIPHERY
```

Blood is the immune headquarters — cells are built and deployed from here (thematically: bone marrow produces cells, spleen releases them into circulation). The Deploy section represents the spleen's role as the launch point.

**Movement budget:** 1 per turn. Because BLOOD has cost 0, cells leaving HQ always advance at least one additional hop in the same turn (BLOOD→any costs 1 = 1 turn total to reach an immediate neighbour of BLOOD).

Cells are always visible at their current intermediate position on the body map, dimmed when in transit. Right-clicking any node deploys the selected cell, computing the shortest path from wherever the cell currently is.

---

## Turn Structure

1. **Player phase** — review perceived state, deploy/recall cells, toggle fever
2. **End turn** — player clicks End Turn; the following sequence runs automatically:
   - Cells advance along paths; recon cells passing through nodes fire en-route detection rolls
   - Scout arrivals fire a definitive detection roll against current ground truth
   - Pathogens spawn (probabilistic)
   - Ground truth advances: pathogen growth/clearance, inflammation, tissue integrity
   - Cleared-node attack cells begin returning
   - Arrived patrol/macrophage cells fire detection rolls; outcomes update perceived state directly
   - Systemic stress and integrity update
   - Loss check

---

## Site System

Each node tracks these values independently:

| Value | Range | Description |
|---|---|---|
| **Inflammation** | 0–100 | Rises from pathogen presence and immune activity. Begins damaging tissue integrity above 25. |
| **Tissue Integrity** | 0–100 | Structural health. Damaged by pathogens and inflammation. Recovers slowly when clear and calm. |
| **Tissue Integrity Ceiling** | 0–100 | Permanent cap. Drops when integrity falls below 40: new ceiling = lowestPoint + 25. The scar mechanic. |
| **Pathogens** | dict | One entry per active pathogen type: `{ type, [trackedValue]: number }` |
| **isWalledOff** | bool | Fungi granuloma: infection contained but blocked; normal clearance fails |
| **immuneSuppressed** | bool | Parasite effect: all clearance at this node halved |
| **transitPenalty** | int | Parasite effect: extra turns to enter this node |

---

## Pathogen Types

All implemented in `src/data/pathogens.js` (PATHOGEN_REGISTRY) and `src/engine/pathogen.js`.

### Extracellular Bacteria
Logistic growth (slows near 100). Spreads at load > 80. Direct tissue damage and inflammation. Cleared by neutrophil, macrophage, responder, b_cell.

### Virus
Exponential growth (fast, uncapped). Spreads at compromise > 60. Does NOT directly damage tissue — but clearing it does (cytotoxic response destroys compromised cells). Requires killer_t or nk_cell. Early intervention dramatically cheaper than late.

### Fungi
Slow logistic growth. Does not spread between sites. At load ≥ 60: **Walled Off** — infection contained but normal clearance blocked; tissue integrity ceiling drops to 50. Replication doubles when systemic stress > 70. Cleared by macrophage, responder.

### Parasite
Moderate growth. **Immune suppression** above burden 50 (halves clearance at this node). **Transit penalty** (extra turns to reach this node). Cannot be cleared by current cell types — **requires eosinophil (not yet implemented)**.

### Toxin Producer
Slow growth. Minimal local symptoms. Each turn, toxin output contributes **directly to systemic stress**, bypassing local inflammation. The site may look healthy while systemic stress climbs. Cleared by macrophage, responder.

### Prion *(stub)*
Linear growth. Hidden to player until corruption > 50. Causes direct tissue integrity damage above threshold. **Cannot be cleared** — only progression can be slowed. No cell types can clear it.

### Cancer *(stub)*
Slow exponential. Mimics self-signals (low detection quality). Cleared by nk_cell, killer_t.

### Benign
A false-positive pathogen type. Generates signals but causes no damage. Tests whether the player over-responds.

---

## Systemic Values

### Systemic Stress (0–100)
A pressure value representing the body's total crisis load. **Not a health bar** — it is the input to consequences.

**Raises stress:**
- Each site with inflammation > 40: +8 (first), +12 (each additional — non-linear)
- Fever active: +5/turn
- Any site integrity < 30: +6
- 3+ simultaneously infected sites: +10
- Toxin output from toxin-producing pathogens (direct contribution)

**Decays:** –5/turn when no active infections.

### Systemic Integrity (0–100)
The actual loss condition. Takes hits when stress is sustained above thresholds:
- Stress 80–89: –1/turn
- Stress 90–99: –3/turn
- Stress 100: –5/turn

**Loss:** Systemic Integrity reaching 0 ends the run.

### Fever
Binary player-controlled toggle.

**While active:**
- Immune cell effectiveness increases
- Systemic stress accumulation increases
- Inflammation decay rate halves

**Decision:** Running fever during an acute crisis is often correct. Running it for many turns risks stress cascades.

---

## Surveillance and Visibility

The player never sees ground truth directly. Visibility at a node is determined by surveillance:

| Level | Condition | Display |
|---|---|---|
| **A — No data** | No cell has ever visited | "No surveillance data" |
| **B — Possible threat** | Detection outcome: ANOMALY or FALSE_ALARM | Ghost bar + turns-at-level counter |
| **C — Confirmed threat** | Detection outcome: THREAT_UNCLASSIFIED | Ghost bar + turns-at-level counter |
| **D — Identified** | Scout returned (CORRECT_ID/WRONG_ID) | Type name + actual GT load bar |

Entity classes upgrade — UNKNOWN → PATHOGEN → CLASSIFIED — and never downgrade. A scout returning CLEAR resolves existing entities to BENIGN.

**En-route detection:** Recon cells (patrol, macrophage, scout) make detection rolls at every intermediate node they pass through in transit, not just at their final destination. Outcomes update perceived state directly. This creates genuine strategic value in routing cells through high-risk areas.

---

## Token Economy

Each cell holds tokens for its lifetime; tokens are freed only on decommission.

| Cell | Cost | Training |
|---|---|---|
| Patrol | 1 | 2T |
| Macrophage | 1 | 2T |
| Scout | 2 | 4T |
| Responder | 3 | 3T |
| B-Cell | 2 | 4T |
| NK Cell | 3 | 4T |
| Killer T | 4 | 5T |

Token capacity starts at 12, grows +1 every 60 ticks (capped at 20). Starting roster (configurable): 2 patrols + 1 macrophage.

---

## Spawn System

Pathogens spawn probabilistically each turn via a two-layer system:

**Layer A:** Global spawn chance starts at ~55% and decays each turn. Boosted if no active infections (+35%), reduced if 3+ active infections (–30%). A minimum floor of 15% is always maintained.

**Layer B:** Given a spawn, weighted selection of (pathogen type × node). Weights reflect biological plausibility — bacteria favour gut/liver, viruses favour throat/chest, parasites favour blood/gut. Conditional modifiers: no double-spawning the same node, fungi double-weight when stress > 70, hard threats (prion, cancer) locked until mid-game.

---

## Current State vs. Planned Features

### Implemented
- Endless run with probabilistic pathogen spawning
- Full site system (inflammation, tissue integrity, scarring)
- All 9 pathogen types (bacteria, virus, fungi, parasite, toxin_producer, prion, cancer, autoimmune, benign) with registry parameters
- Systemic stress / integrity health model
- Fever toggle
- Path-based cell movement with intermediate node detection
- Scout dwell (2 turns at destination before auto-return)
- Direct redeployment from any node (no recall required)
- All cell types: scout, patrol, macrophage, responder, killer_t, b_cell, nk_cell
- Entity visibility levels A–D
- Memory bank (persists across runs via restart)
- Token economy with capacity regen
- Configurable starting units
- Post-mortem screen

### Designed, Not Yet Implemented

**Roguelite upgrade picker:** After clearing a pathogen, offer 3 genuinely lateral upgrades. Categories: cell type enhancements, systemic abilities, response infrastructure. Design principle: options should create build directions, not ranked choices.

**Scars with identity:** Currently scars are mechanical penalties only (tissue integrity ceiling). The design calls for each scar to have a paired upgrade that converts the liability into a playstyle identity. Example: autoimmune tendency + enhanced NK cells = hair-trigger aggressive system.

**Narrative events:** Between encounters, 2–3 option branching scenarios that pit immediate tactical cost against long-term benefit.

**Parasite specialist cell (Eosinophil):** Currently parasites have no clearableBy — they're a pure logistics threat. The eosinophil cell type needs to be implemented.

**Full prion/cancer/autoimmune implementations:** Currently stubs. Prions (hidden corruption, unclearable) and cancer (self-mimicking, slow growth) have the right shape but need balance tuning and full behaviour pass.

**Campaign structure (long-term vision):** Four chapters representing childhood → late life. Immunosenescence (mechanical degradation across chapters). Chapter transition body review screen. This is the full vision; current implementation is the endless run prototype proving the core loop.

**Meta-progression:** Threat taxonomies, unlocked cell variants, scar resistance carrying across distinct runs (currently the memory bank approximates this).

---

## Design Notes & Decisions

**Information routing as the core action:** The original design imagined explicit signal routing (forward/amplify/suppress/quarantine) as the primary action surface. Signals as objects have been removed — detection outcomes now update perceived state directly. The philosophy is preserved: where you send cells and which nodes they cover is always a commitment.

**Silence is information:** Patrols that roll CLEAR or MISS at a clean node leave no mark on perceived state — which is itself meaningful. Covered nodes with no entity are more trustworthy than uncovered ones.

**Responder effectiveness without backing:** 60% effectiveness when deployed without prior scout confirmation. Makes scouts genuinely valuable without making unconfirmed responses useless.

**Death teaches:** The post-mortem is design-critical. It must make the gap between what you knew and what was actually happening visible and comprehensible. This is where the game's learning loop closes.

**Build in layers:** The current codebase is Layer 2 territory — core loop proven, threat variety established, cell types differentiated, path-based movement adding tactical depth. Layer 3 (scar/upgrade system with identity) is the next major build step.

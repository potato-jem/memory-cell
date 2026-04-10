# Memory Cell — Game Design Document

---

## What This Game Is

You play as a human progressing through various lifestages. The primary game loop involves coordinating the immune system response to pathogens. The meta game loop progresses through life-stages (through narrative flavour and key choices) which influence the primary loop, and vice versa.

For the full metagame design (meta-run structure, life events, bonus objectives, new files), see `design_docs/metagame.md`.

---

## Design Pillars

High decision density — Players are constantly making trade-offs where most actions have meaningful, non-trivial consequences.
Clarity over simplicity — Systems are easy to understand at a surface level, but combine to create deep and sometimes unexpected outcomes.
Systems-driven gameplay — Game depth comes from interacting mechanics rather than scripted content or one-off scenarios.
Constrained randomness — Variability introduces new problems each run, but systems give players tools to adapt and regain control.
Fail-forward structure — Failure is frequent and expected, with player knowledge and skill improving across runs more than persistent upgrades.
Fast feedback loops — Player actions produce immediate, visible results, enabling rapid learning and iteration.
Meaningful scarcity — Limited resources force prioritisation and prevent optimal play across all dimensions.
Multi-layered decisions — Tactical, moment-to-moment choices interact with longer-term strategic planning and build direction.
Readable complexity — Despite depth, outcomes feel fair because systems are legible and largely free of hidden information.
Compounding optimisation — Small efficiencies and decisions stack over time, rewarding careful planning and system mastery.
Perpetual pressure — The game continuously introduces or escalates problems, preventing stable equilibrium and forcing adaptation.
---

## Five Failure Modes

1. Structural Misbuild (Wrong foundations early) - Early decisions lock you into an inefficient or fragile configuration that becomes unfixable later.
2. Snowball Collapse (Compounding inefficiency) - Small mistakes or inefficiencies accumulate until they cross a tipping point and become irreversible.
3. Resource Exhaustion (No buffer left) - Critical resources or safety margins run out, leaving no capacity to respond to new threats.
4. Pressure Overwhelm (Scaling outpaces control) - External difficulty or system pressure grows faster than your ability to scale, adapt, or recover.
5. Execution / Priority Failure (Wrong action under stress) - You either mis-sequence actions or prioritise incorrectly during high-pressure moments despite understanding the system.

---


## The Cellular Cast

### Dendritic Cell
Scout cell that can detect and classify pathogens but can't fight. Auto-returns once the node is fully classified (no unresolved pathogens). Can be set to patrol instead.

### Macrophage
Recon cell that can detect (but not classify). Does not auto-return — holds position indefinitely. Can be set to patrol. Clearance starts at base on arrival; stationary bonus begins accruing from the second turn and ramps up to the max shown in the tooltip.

### Neutrophil 
Attack cell with limited lifetime (will die after a number of turns) and focus on extracellular threats. High inflammation generation.

### NK Cell
Attack cell which doesn't need classification. Targets intracellular threat. High inflammation generation and collatoral.

### Killer T
Attack cell which locks in its specialisation (for all cells of this type) to the first pathogen it attacks. Targets intracellular threats. Requires classification. Lower inflammation and collatoral.

### B-Cell
Attack cell which gets stronger against a certain pathogen the more it attacks (and weaker against other pathogens). Targets wide range of threats. Lower inflammation and collatoral.

### Eosinophil
Attack cell which targets parasites.

---

## The Body Map

Seven nodes connected by a movement graph. Each connection is traversable; movement cost is determined by the **exit cost** of the node being left.

```
BLOOD (HQ)
        │
┌───────┼───────┐
CHEST  LIVER  MUSCLE
  │      │      │
THROAT  GUT  PERIPHERY
```

Blood is the immune headquarters — cells are built and deployed from here (thematically: bone marrow produces cells, spleen releases them into circulation). 

---

## Turn Structure

1. **Player phase** — choose any scars or upgrades, train and deploy cells, toggle fever
2. **End turn** — player clicks End Turn; the following events run:
   - Cells advance along paths
   - Pathogens spawn (probabilistic)
   - Detection and classification rolls 
   - Ground truth advances: pathogen growth/clearance, inflammation, tissue integrity
   - Cleared-node attack cells begin returning
   - Systemic stress and integrity update
   - Loss check

---

## Site System

Each node tracks these values independently:

| Value | Range | Description |
|---|---|---|
| **Inflammation** | 0–100 | Rises from immune activity |
| **Tissue Integrity** | 0–100 | Structural health. Damaged by pathogens and cell response. Can recover |
| **Tissue Integrity Ceiling** | 0–100 | Permanent cap. new ceiling = lowestPoint + X. |
| **Pathogens** | dict | One entry per active pathogen type |
| **isWalledOff** | bool | Fungi granuloma: infection contained but blocked; normal clearance fails |
| **immuneSuppressed** | bool | Parasite effect: all clearance at this node halved |
| **transitPenalty** | int | Parasite effect: extra turns to enter this node |

---

## Pathogen Types

All implemented in `src/data/pathogens.js` (PATHOGEN_REGISTRY) and `src/engine/pathogen.js`.

### Extracellular Bacteria
Logistic growth (slows near 100). Spreads at load > 80. Direct tissue damage and inflammation

### Virus
Exponential growth (fast, uncapped). Spreads at compromise > 60. Does NOT directly damage tissue — but clearing it does (cytotoxic response destroys compromised cells). Early intervention cheaper than late.

### Fungi
Slow logistic growth. Does not spread between sites. At load ≥ 60: **Walled Off** — infection contained but normal clearance blocked.

### Parasite
Moderate growth. **Immune suppression** above burden 50 (halves clearance at this node). **Transit penalty** (extra turns to reach this node).

### Toxin Producer
Slow growth. Minimal local symptoms. Each turn, toxin output contributes **directly to systemic stress**, bypassing local inflammation. The site may look healthy while systemic stress climbs.

### Cancer
Slow exponential. Mimics self-signals (low detection quality).

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

## Detection and Surveillance

All nodes are always fully visible — there is no fog of war. However, pathogens have a `detected_level` that determines how much the player knows about them:

| Level | Meaning | Display |
|---|---|---|
| **none** | Not yet detected | Hidden (no ring) |
| **unknown** | Presence detected, type unknown | Dashed grey ring; badge count |
| **classified** | Fully identified | Solid type-colour ring, load bar |

Detection is **deterministic** — no probability rolls:
- `isDetector` cells (Macrophage, Dendritic): upgrade `none` → `unknown` at nodes they visit
- `isClassifier` cells (Dendritic only): upgrade `unknown` → `classified` at nodes they visit

**En-route detection:** Recon cells make detection rolls at every intermediate node they pass through in transit, not just at their final destination.

**Clear detection roll:** When a detector visits a node and finds no `none`-level pathogens (node is already known or empty), this counts as a "clear" roll. Each node tracks `turnsSinceLastClear` — shown as white pips inside the node circle on the map (1 pip per turn, max 8). Patrol cells target the node with the highest `turnsSinceLastClear` and wait at each node until it clears before pressing on.

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


---

## Spawn System

Pathogens spawn probabilistically each turn via a two-layer system:

**Layer A:** Global spawn chance starts at ~55% and decays each turn. Boosted if no active infections (+35%), reduced if 3+ active infections (–30%). A minimum floor of 15% is always maintained.

**Layer B:** Given a spawn, weighted selection of (pathogen type × node). Weights reflect biological plausibility — bacteria favour gut/liver, viruses favour throat/chest, parasites favour blood/gut. Conditional modifiers: no double-spawning the same node, fungi double-weight when stress > 70, hard threats (prion, cancer) locked until mid-game. Types with no eligible spawn nodes (e.g. virus when all its nodes are already infected) are excluded from type selection, so spawn slots are never wasted.


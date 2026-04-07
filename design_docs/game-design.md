# Memory Cell — Game Design Document

---

## What This Game Is

You play as a human progressing through various lifestages. The primary game loop involves coordinating the immune system response to pathogens. The meta game loop progresses through life-stages (through narrative flavour and key choices) which influence the primary loop, and vice versa.

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
Slow, expensive, high-value. Travels to a specific node, dwells for 2 turns sampling it, returns with definitive intelligence — a single high-accuracy detection roll that upgrades the entity to **classified** (full type identification). Does not fight. Scouts provide en-route visibility at intermediate nodes on the way to their destination.

### Macrophage
Cheap recon cell that can either patrol or move around. While staying still it grows in strength each turn and provides adjascent node visibility. When patroling can detect potential pathogens.


### Neutrophil / Killer T / B-Cell / NK Cell / Eosinophil
Attack cells. Follow the path system to their destination but only fight at the final node — en-route they contribute no combat. Killer T and B-Cells benefit from prior scout confirmation. NK Cells and Neutrophil operate without prior intelligence but do more collatoral damage.

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

Blood is the immune headquarters — cells are built and deployed from here (thematically: bone marrow produces cells, spleen releases them into circulation). The Deploy section represents the spleen's role as the launch point.

---

## Turn Structure

1. **Player phase** — review perceived state, deploy/recall cells, toggle fever
2. **End turn** — player clicks End Turn; the following sequence runs automatically:
   - Cells advance along paths; recon cells passing through nodes fire en-route detection rolls
   - Scout cells (dendritic) arrivals fire a definitive detection roll against current ground truth
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
| **Inflammation** | 0–100 | Rises from pathogen presence and immune activity |
| **Tissue Integrity** | 0–100 | Structural health. Damaged by pathogens and cell response. Recovers slowly when clear and calm. |
| **Tissue Integrity Ceiling** | 0–100 | Permanent cap. new ceiling = lowestPoint + 25. |
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


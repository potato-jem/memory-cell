# Memory Cell — Game Design & Implementation Document

## Overview

Memory Cell is a turn-based strategy roguelite in which the player coordinates the human immune system to detect, contain, and eliminate pathogens. It draws on FTL's run-based structure and decision tension, Into the Breach's legible threat-and-response loop, and Against the Storm's resource management under escalating pressure.

The core fantasy is playing as an epidemiologist and field commander simultaneously: you have full information about the current state of the body, but your responses take time to arrive. Success requires anticipating where threats will be, not just where they are.

---

## Core Design Pillars

**Information is instant, responses are delayed.** The player always sees the current state of every tissue site. Issuing orders commits immune cells to a deployment that resolves in future cycles. The skill is predicting where the pathogen will be when your response lands.

**Triage, not optimisation.** Multiple simultaneous threats are qualitatively more dangerous than one large threat. The game rewards sequencing and prioritisation, not maximal response to everything at once.

**Every decision is legible.** When the player dies or takes damage, it should be clear why. Pathogens behave consistently. Systemic consequences follow from traceable causes. Death teaches.

**Wins leave marks.** Clearing an infection always costs something — tissue integrity, systemic stress, a scar. Runs feel cumulative even within a single playthrough.

---

## Turn Structure

Each turn represents one immune response cycle. The sequence is:

1. **Player phase** — player reviews state and issues orders (deploy cells, activate abilities, suppress fever, trigger resolution responses)
2. **Resolution phase** — previously issued orders that have completed their delay land and take effect
3. **Pathogen phase** — all active pathogens act according to their type (replicate, spread, produce toxins, move)
4. **Signal phase** — inflammation values update based on pathogen activity and existing immune presence
5. **Systemic phase** — systemic stress updates; threshold events fire if triggered
6. **Roguelite phase** — if a pathogen has been cleared this turn, present upgrade/scar choices; narrative events fire if scheduled


Orders issued in the player phase resolve after a delay of 1–3 cycles depending on cell type and distance.
---

## Site System

The body is divided into tissue **sites** (e.g. chest, gut, blood). Each site tracks the following values independently:

### Per-Site Values

| Value | Range | Description |
|---|---|---|
#### There is overall 'pathogen load', but this is made up of a value for each individual pathogen present:
  | **Infection Load** | 0–100 | Presence of replicating pathogen (bacteria, fungi) |
  | **Cellular Compromise** | 0–100 | Proportion of local cells infected by virus, or compromised by prions or cancers.|
  | **Parasitic Burden** | 0-100| How much burden parasite present is causing. |
  | **Toxin Output** | 0-100 | How much toxin is pathogen producing.| 

#### Local 
| **Inflammation** | 0–100 | Local immune activity signal. High inflamation improves immune response. Presence of pathogens and response increases inflamation (increases faster at higher amounts of each). Starts damaging tissue integrity at 25% and damages at higher rate for each threshold. |
| **Tissue Integrity** | 0–100 | Structural health of the site. Damaged by pathogens, high inflammation, and some systemic events. Restores slowly to predefined thresholds (25% per threshold) |


### Tissue Integrity Recovery

- Restores at 2 points per cycle when no active infection and inflammation is below 30
- Recovery ceiling drops permanently when integrity falls below 40: new maximum = (lowest point reached) + 25
- A site that bottomed out at 20 can only ever recover to 45
- This is the primary scar mechanic — sites become permanently vulnerable after serious infections

### Inflammation Dynamics

- Rises when: infection load increases, immune cells are present and active, fever is active
- Decays per cycle when infection load is zero and immune presence is withdrawing

---

## Pathogen Types

### Extracelluar Bacteria

**Tracked value:** Infection Load

**Behaviour:**
- Replicates each cycle: load increases by (current load × replication rate), capped at 100
- Spreads to adjacent sites when load exceeds 80 (starts a new infection at load 10)
- Causes direct tissue damage
- Raises inflammation proportional to load


---

### Intracellular Bacteria (e.g. TB)
**Tracked value:** Cellular Compromise 
... fill this out...

---

### Viruses

**Tracked value:** Cellular Compromise 

**Behaviour:**
- Spreads exponentially: cellular compromise increases by (current compromise × 1.5) per cycle if unchecked
- Does not cause direct tissue damage — instead, clearing it does: each cytotoxic T-cell response destroys infected cells, reducing tissue integrity by 1 per 5 compromise cleared
- Invisible to antibody-based abilities once inside cells; requires cytotoxic T-cell deployment
- Raises inflammation proportional to compromise

**Implication:** Early viral intervention is dramatically cheaper than late intervention. A virus caught at 10 compromise costs far less integrity to clear than one at 60. This creates a strong incentive to identify and respond quickly.

---

### Fungi

**Tracked value:** Infection Load (slow accumulation)

**Behaviour:**
- Replicates slowly
- Does not spread between sites actively, but establishes more easily at sites with existing high inflammation
- At load 60+, may trigger **granuloma formation**: site becomes Walled Off
  - Walled Off sites: infection is contained but not clearable by normal means; tissue integrity ceiling drops to 50; load ticks down very slowly on its own. 
  - Requires specialist response (antifungal ability) to fully clear
- Thrives when immune response is suppressed: if systemic stress is above 70%, fungal replication rate doubles

**Implication:** Fungi are a chronic threat that punishes players who let systemic stress run high. They rarely cause an acute crisis but compound quietly.

**Framework note:** Granuloma state requires a new site status flag. Walled Off sites should be visually distinct — contained but not resolved.

---

### Parasites

**Tracked value:** Parasitic budern

**Behaviour:**
- Cannot be engulfed by neutrophils or macrophages — requires eosinophil/mast cell response type (separate cell pool)
- Occupies sites in a way that **blocks immune traffic**: sites with high parasite load reduce immune cell movement speed to/from that site by 1+ cycle (depending on burden)
- Some parasites produce **immune suppression**: local inflammation generation is reduced by 50% while parasite load is above 50. The site appears calmer than it is.
- Causes slow direct tissue damage

**Implication:** Parasites disrupt logistics rather than causing acute damage. The suppression mechanic means the player may not notice a parasitic infection until it is well established. Requires a dedicated cell type the player may not have invested in.

**Framework note:** Immune suppression requires a modifier on inflammation generation. Logistics disruption requires movement delay to be tracked per-site rather than just per-cell-type.

---

### Toxin-Producing Pathogens

**Tracked value:** Toxin Output

**Behaviour:**
- Low infection load; slow replication; does not spread
- Each cycle, contributes a fixed Toxin Output directly to systemic stress, bypassing local inflammation and tissue values
- Toxin Output scales with load: a small infection still produces meaningful systemic impact
- Local site may appear relatively healthy while systemic stress climbs

**Implication:** Forces the player to reprioritise — a small infection elsewhere is causing more systemic damage than the large infection they are currently managing. Source elimination is the correct response, not symptom management.

**Framework note:** Toxin Output is a per-pathogen-instance value that feeds directly into the systemic stress calculation. Requires the systemic stress system to accept inputs from individual site-level pathogen instances, not just aggregate site states.

---

### Prions

**Tracked value:** Corruption (hidden until threshold)

**Behaviour:**
- No replication load; no inflammation trigger; immune system cannot detect them
- Corruption increases per cycle silently
- Corruption becomes visible to the player only when it crosses 50 (the site shows structural anomalies)
- At high corruption+, tissue integrity begins dropping directly: 2 integrity per cycle
- No direct immune response possible — only slow-down abilities and supportive care
- Cannot be cleared; only progression can be slowed

**Implication:** Prions are a late-game or boss-tier encounter. By the time they are visible, significant damage is done. The player must manage the consequences rather than solve the problem.

**Framework note:** Corruption is a third site-level health axis alongside inflammation and integrity. It requires its own UI representation. The "no immune response" design means this encounter type is about systemic management, not direct combat.

---

### Cancers

... fill this in ...

### Autoimmune Events (Pseudo-Pathogen)

**Trigger:** Cumulative high inflammation across multiple sites, or specific scar outcomes

**Behaviour:**
- A site begins taking tissue damage from immune activity with no pathogen present
- Immune presence at the site worsens the damage rather than helping
- Requires active resolution response (regulatory T-cell ability) to stop
- May recur if the triggering conditions (high systemic inflammation history) persist

**Implication:** Aggressive immune strategies carry long-term risk. Overresponding to one infection can trigger friendly fire elsewhere. Forces the player to consider resolution as a deliberate action, not just a passive outcome.

---

## Systemic Values

Three interconnected global values sit above the site layer.

### Systemic Stress

A rising pressure value representing the body's total crisis load. Not a health bar — it is the input to consequences.

**Sources that raise Systemic Stress (per cycle):**

| Source |
|---|---|
| Each site with inflammation > threshold |
| Each additional site with inflammation  > threshold beyond the first (non-linear penalty) |
| Fever active |
| Toxin-producing pathogen present directly increases |
| Any site tissue integrity below threshold  |
| Three or more sites with active infection simultaneously |

**Sources that lower Systemic Stress (per cycle):**

| Source | Amount |
|---|---|
| Active resolution response (regulatory T-cells) |
| Sites cleared and returning to baseline |
| Fever suppressed |

Systemic Stress is capped at 100 and decays naturally with no active infections.

---

### Systemic Integrity

The body's actual loss-condition health. Takes hits when Systemic Stress above certain thresholds (high thresholds, bigger hit).

**Threshold events:**

Systemic Integrity hitting 0 ends the run.

---

### Fever

A binary state (on/off) with intensity that modifies both sides of the conflict.

**While Fever is active:**
- Immune cell effectiveness increases
- Immune cell damage output increases 
- Systemic Stress accumulation increases 
- Inflammation decay rate halves

**Fever suppression:**
- Active player ability
- Turns off fever immediately
- Useful when systemic stress is dangerously high and the player can afford slower response

**Fever as a decision:** Letting fever run during an acute crisis is often correct. Letting it run for many cycles risks pushing systemic stress through thresholds. The player must read the situation and decide when to suppress.

---

## Roguelite Layer

### Run Structure

### Pick-from-3 Upgrades

After clearing a pathogen, the player is presented with three upgrade options. Upgrades fall into categories:

- **Cell type enhancements** — improve a specific immune cell type's effectiveness, speed, or capacity
- **Systemic abilities** — new active abilities (fever suppression, resolution response, targeted antibody burst)
- **Response infrastructure** — reduce deployment delays, increase cell production rate, add new deployment slots

Good upgrade design requires the three options to be genuinely lateral, not ranked. Options should create build directions: "am I going for a fast cytotoxic response build, or a high-inflammation aggressive neutrophil build, or a resolution-focused low-stress build?"

### Scars

Scars are permanent negative modifiers acquired from difficult encounters. They represent the cost of survival.

**Sources:**
- Tissue site hitting 0%/25%/50% integrity (site-specific scar: that organ is permanently weaker)
- System stress hitting 100%
- system integrity hitting 50%

Scars persist for the entire run. They are not presented as choices — they are consequences of what happened.

### Narrative Events

Between encounters, narrative events fire occasionally. Format: a situation is described, the player picks from 2–3 responses. Responses have mechanical consequences.

**Design principle:** Narrative events should force the player to weigh values against strategy. The most interesting events pit immediate tactical cost against long-term benefit, or require sacrificing something already built.

**Examples:**
- *Inflammatory tissue detected in region X. Aggressive response risks autoimmune event. Do you: send a targeted response (slower, safer) / flood the zone (faster, higher autoimmune risk) / monitor and wait (cheapest, risk of escalation)?*
- *Bone marrow under stress. Cell production will drop for 2 cycles regardless. Do you: pre-deploy reserves now before the drop / conserve and weather it / trigger emergency production at the cost of +15 systemic stress?*

---

### Pathogen events
A run should be 'endless' for now. Pathogens should be randomly chosen from the pool and assigned to a location (each pathogen / location pair have their own probability). And there should be some high level adjustments to probabilities to ensure the player isn't overwhelmed or doing nothing (so probabilities are initially globally higher then reduce.) Best structure is probably a global chance of 'something' occuring, then fixed pathogen/location pairs probabilities after that (i.e. given that 'something' has happened, what is the probability of it being a viral infection in the chest). Can do conditional probaility modifiers too (e.g. inflamation may have a probability modification, and there may be global effects from upgrades/scars.) So have a think about what structure makes the most sense. Need to think carefully to avoid gaming the system by making viral infections really likely to avoid other harder pathogens. 

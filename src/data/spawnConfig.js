// Spawn configuration — all spawn probability weights and schedules.
// Extracted from spawner.js so designers can tune spawn rates and distributions
// without touching engine logic.

// ── Per-node weights for each pathogen type ───────────────────────────────────
// Higher = more likely to spawn there. Weights are relative, not absolute.
// Nodes not listed default to weight 0 (cannot spawn that type there).

export const BASE_WEIGHTS = {
  // GUT dominant entry; THROAT common (strep);
  extracellular_bacteria: { GUT: 2, THROAT: 1, CHEST: 1, PERIPHERY: 1, BLOOD: 1, LIVER: 0, MUSCLE: 0  }, // BLOOD: bacteremia via IV lines, dental seeding
  // LIVER hepatitis A/B/C/E; GUT (norovirus/rotavirus);
  virus:                  { THROAT: 3, CHEST: 2, LIVER: 1, PERIPHERY: 1, GUT: 1, BLOOD: 1,  MUSCLE: 0  }, // BLOOD: HIV, EBV, CMV, dengue
  // PERIPHERY dominant (dermatophytes); THROAT high (oral thrush);
  fungi:                  { PERIPHERY: 4, CHEST: 2, THROAT: 2, GUT: 1, LIVER: 0,  BLOOD: 0,  MUSCLE: 0  },
  // GUT dominant; PERIPHERY/MUSCLE (gas gangrene, wound toxins); THROAT (diphtheria); CHEST (pertussis)
  toxin_producer:         { GUT: 4, PERIPHERY: 1, MUSCLE: 1, BLOOD: 1, THROAT: 1, CHEST: 1, LIVER: 0  }, // CHEST: Bordetella pertussis (whooping cough toxin)
  // GUT intestinal parasites (hookworm, Giardia) are globally most prevalent;
  parasite:               { GUT: 2, BLOOD: 1, LIVER: 1, MUSCLE: 1, PERIPHERY: 1, CHEST: 0,  THROAT: 0  },
  // GUT dominant (largest microbiome by far)
  benign:                 { GUT: 2, THROAT: 1, PERIPHERY: 1, CHEST: 0,  LIVER: 0,  MUSCLE: 0,  BLOOD: 0   },
  // CHEST dominant (TB, Legionella, Chlamydia pneumoniae); 
  intracellular_bacteria: { CHEST: 3, BLOOD: 2, GUT: 2, LIVER: 1, PERIPHERY: 1, THROAT: 1, MUSCLE: 0  },
  // PERIPHERY dominant (skin cancer most common overall); GUT (colorectal); BLOOD (leukaemia/lymphoma); THROAT
  cancer:                 { PERIPHERY: 3, CHEST: 2, GUT: 2, LIVER: 2, BLOOD: 1,  THROAT: 1, MUSCLE: 0  },
  // GUT (oral/dietary entry, vCJD); THROAT (tonsil lymphoid accumulation)
  // prion:                  { BLOOD: 2, GUT: 1, THROAT: 1, MUSCLE: 0, PERIPHERY: 0,  CHEST: 0,  LIVER: 0   },
};

// ── Relative frequency across pathogen types ──────────────────────────────────
// Base 1 = prion/cancer (rarest). Others expressed as multiples of that baseline.
export const TYPE_BASE_WEIGHT = {
  extracellular_bacteria: 8,  // most common infections globally (strep, UTI, wound, pneumonia)
  virus:                  7,  // near-ubiquitous (colds, flu, norovirus)
  benign:                 6,  // frequent false positives are important for gameplay tension
  fungi:                  5,  // common (dermatophytes, thrush) but needs a foothold
  toxin_producer:         4,  // food poisoning, C. diff — fairly common but narrower scope
  parasite:               3,  // regionally common, globally moderate
  intracellular_bacteria: 2,  // TB, Legionella, Rickettsia — less frequent
  cancer:                 1,  // rare in any given moment; late-game
  // prion:                  1,  // extremely rare; late-game
};

// ── Turn thresholds before each type can spawn ────────────────────────────────
export const UNLOCK_TURN = {
  extracellular_bacteria: 0,
  virus:                  0,
  fungi:                  0,
  toxin_producer:         3,
  benign:                 0,
  parasite:               5,
  intracellular_bacteria: 12,
  cancer:                 20,
  // prion:                  30,
};

// ── Scheduled probability spikes ──────────────────────────────────────────────
export const SPAWN_SCHEDULE = [
  // { turn: 3,  typeBoost: 'extracellular_bacteria', typeMultiplier: 2.0, globalBoost: 0.2  },
  // { turn: 7,  typeBoost: null,                     typeMultiplier: 1,   globalBoost: 0.25 },
  // { turn: 15, typeBoost: 'virus',                  typeMultiplier: 2.5, globalBoost: 0.2  },
  // { turn: 25, typeBoost: null,                     typeMultiplier: 1,   globalBoost: 0.3  },
];

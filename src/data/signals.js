// Signal flavour text library.
// Each signal type has low / medium / high confidence variants.
// {node} is replaced with the node label at generation time.
// Layer 2: threat-type-specific signal vocabularies added.

export const SIGNAL_TYPES = {
  PATROL_CLEAR: 'patrol_clear',
  ANOMALY_DETECTED: 'anomaly_detected',
  THREAT_CONFIRMED: 'threat_confirmed',
  THREAT_EXPANDING: 'threat_expanding',
  COLLATERAL_DAMAGE: 'collateral_damage',
  FALSE_ALARM: 'false_alarm',
  RESOLUTION: 'resolution',
};

export const SIGNAL_SOURCES = {
  NEUTROPHIL: 'neutrophil',
  MACROPHAGE: 'macrophage',
  DENDRITIC: 'dendritic',
  INFECTED_CELL: 'infected_cell',  // viral signals come from inside cells
  NK_CELL: 'nk_cell',
  B_CELL: 'b_cell',
};

export const THREAT_TYPES = {
  BACTERIAL: 'bacterial',
  VIRAL: 'viral',
  CANCER: 'cancer',
  AUTOIMMUNE: 'autoimmune',
  MIMIC: 'mimic',
};

// ── Generic signal templates (fallback) ──────────────────────────────────────

const genericTemplates = {
  [SIGNAL_TYPES.PATROL_CLEAR]: {
    low: [
      'Patrol sweep at {node} — nothing obvious.',
      'Neutrophil pass through {node}. Routine.',
      '{node} quiet on this sweep.',
    ],
    medium: [
      'Patrol complete at {node}. Tissue appears normal.',
      'Standard coverage at {node}. No activation triggers.',
      'Neutrophil circuit through {node} completed. Clear.',
    ],
    high: [
      '{node} thoroughly sampled. No foreign markers detected.',
      'Full patrol sweep at {node}. Environment nominal.',
      'Comprehensive {node} coverage: no pathogenic signal.',
    ],
  },

  [SIGNAL_TYPES.ANOMALY_DETECTED]: {
    low: [
      'Something odd at {node}. Hard to characterise. Could be noise.',
      'Low-level irregularity at {node}. Not matching standard patterns.',
      '{node} shows faint deviation from baseline. Unclear origin.',
    ],
    medium: [
      'Anomalous cellular activity at {node}. Warrants attention.',
      'Non-self marker detected at {node}. Confidence moderate.',
      'Pattern irregularity at {node}. Doesn\'t match recent baselines.',
    ],
    high: [
      'Clear foreign signal at {node}. Recommend investigation.',
      'Confirmed anomalous marker at {node}. Non-self indicators present.',
      '{node} flagging: foreign molecular signature. High confidence.',
    ],
  },

  [SIGNAL_TYPES.THREAT_CONFIRMED]: {
    low: [
      'Possible pathogen at {node}. Signal strength insufficient to classify.',
      'Threat signature at {node} — type unclear, presence likely.',
      '{node}: something is there. Can\'t confirm nature yet.',
    ],
    medium: [
      'Pathogen present at {node}. Markers consistent.',
      'Active infection signal at {node}. Strength: moderate.',
      '{node} reporting active threat. Classification: probable.',
    ],
    high: [
      'Confirmed infection at {node}. Strength significant.',
      '{node}: active pathogen. Full markers present.',
      'High-confidence threat at {node}. Immediate response indicated.',
    ],
  },

  [SIGNAL_TYPES.THREAT_EXPANDING]: {
    low: [
      'Signal from {node} intensifying. May be spreading or growing.',
      '{node} reporting increased activity. Trend unclear.',
      'Escalation signal from {node}. Could be normal variation.',
    ],
    medium: [
      'Threat at {node} is growing. Expansion likely if unchecked.',
      '{node}: pathogen strength increasing. Spread threshold approaching.',
      'Escalating activity at {node}. Response urgency elevated.',
    ],
    high: [
      '{node}: significant escalation. Pathogen strength critical.',
      'Threat expanding at {node}. Spread to adjacent nodes probable.',
      '{node} reporting major escalation. Immediate response required.',
    ],
  },

  [SIGNAL_TYPES.COLLATERAL_DAMAGE]: {
    low: [
      'Minor inflammation at {node}. Likely response activity.',
      '{node} showing low-level tissue stress. Normal response range.',
      'Mild cytokine elevation at {node}. Monitoring.',
    ],
    medium: [
      'Inflammation at {node} above threshold. Collateral risk.',
      '{node}: response intensity causing measurable tissue stress.',
      'Over-activation at {node}. Friendly fire risk increasing.',
    ],
    high: [
      '{node} suffering significant collateral damage. Response may exceed threat.',
      'Critical inflammation at {node}. Autoimmune cascade possible.',
      '{node}: responder activity causing serious tissue damage.',
    ],
  },

  [SIGNAL_TYPES.FALSE_ALARM]: {
    low: [
      'Signal from {node} resolved as environmental noise.',
      '{node} anomaly retrospectively classified: benign variation.',
      'Earlier {node} signal: false alarm. No threat present.',
    ],
    medium: [
      'Investigation of {node} complete: no pathogen found.',
      '{node} cleared. Initial signal was misread.',
      'False positive from {node}. System noise, not threat.',
    ],
    high: [
      '{node} comprehensively sampled: confirmed clear. Previous signal erroneous.',
      'Dendritic return from {node}: no infection. Prior alerts unfounded.',
      '{node} false alarm confirmed. Threat signal was environmental artifact.',
    ],
  },

  [SIGNAL_TYPES.RESOLUTION]: {
    low: [
      '{node} activity declining. Possible resolution.',
      'Reduced signal from {node}. Threat may be clearing.',
      '{node} quieting down. Outcome uncertain.',
    ],
    medium: [
      'Pathogen at {node} significantly reduced. Resolution likely.',
      '{node}: threat strength below critical threshold. Clearing.',
      'Responders at {node} reporting success. Threat retreating.',
    ],
    high: [
      '{node} clear. Threat eliminated. Resolution confirmed.',
      'Full clearance at {node}. No residual pathogen detected.',
      '{node}: infection resolved. Site returning to baseline.',
    ],
  },
};

// ── Threat-type-specific signal vocabularies ─────────────────────────────────
// These override generic templates when a threat type is known.
// Players learn to recognise these patterns through play.

export const THREAT_TYPE_SIGNALS = {
  [THREAT_TYPES.BACTERIAL]: {
    // Blunt, activation-heavy language. Strong neutrophil signals.
    [SIGNAL_TYPES.ANOMALY_DETECTED]: {
      low: [
        '{node}: faint cell-wall marker. Could be debris.',
        'Unusual surface protein at {node}. Low confidence.',
        'Neutrophil flagging {node}. Non-self surface antigen, faint.',
      ],
      medium: [
        'Bacterial surface antigen at {node}. Neutrophil activated.',
        '{node}: cell-wall fragment detected. Probable bacterial origin.',
        'Foreign peptidoglycan signal from {node}. Neutrophil on site.',
      ],
      high: [
        'Strong bacterial antigen at {node}. Multiple neutrophils activating.',
        '{node}: unmistakable cell-wall signature. Bacterial infection likely.',
        'Full neutrophil cascade at {node}. Bacterial markers confirmed.',
      ],
    },
    [SIGNAL_TYPES.THREAT_CONFIRMED]: {
      low: ['Bacteria suspected at {node}. Weak confirmation.', '{node}: bacterial signal, low strength.'],
      medium: ['Active bacterial infection at {node}. Neutrophils engaged.', '{node}: bacteria confirmed, growing.'],
      high: ['Severe bacterial load at {node}. Urgent.', '{node}: critical bacterial infection. Full response needed.'],
    },
  },

  [THREAT_TYPES.VIRAL]: {
    // Intracellular language. Signals come from infected cells, not neutrophils.
    // Quiet during replication, sudden escalation at viral load threshold.
    [SIGNAL_TYPES.ANOMALY_DETECTED]: {
      low: [
        '{node}: cellular stress marker. Origin unclear. Could be mechanical.',
        'Interferon-adjacent signal from {node}. Faint. Possibly noise.',
        '{node} cell reporting internal irregularity. Not surface-level.',
      ],
      medium: [
        'Interferon signal from {node} cells. Viral invasion possible.',
        '{node}: cells reporting internal replication pressure. Moderate confidence.',
        'Cytokine pattern at {node} consistent with early viral response.',
      ],
      high: [
        'Strong interferon cascade at {node}. Viral load suspected.',
        '{node}: cells signalling active replication event. Viral origin likely.',
        'MHC-I downregulation signal from {node}. Classic viral evasion marker.',
      ],
    },
    [SIGNAL_TYPES.THREAT_CONFIRMED]: {
      low: ['{node}: viral signature. Low strength. Cells struggling.'],
      medium: ['{node}: active viral replication. Cells releasing distress signal.', 'Viral load at {node} confirmed. Spreading inside tissue.'],
      high: ['{node}: critical viral load. Cells overwhelmed. NK cells recommended.', 'Full viral cascade at {node}. Immediate response needed.'],
    },
    [SIGNAL_TYPES.PATROL_CLEAR]: {
      low: ['{node}: cells appear intact. No stress signals detected.'],
      medium: ['{node} patrol: no interferon markers. Cells reporting normal.'],
      high: ['{node}: comprehensive intracellular check. No viral signatures.'],
    },
  },

  [THREAT_TYPES.CANCER]: {
    // Very quiet. Signals are rare and easy to mistake for noise.
    // Dendritic cell is the only reliable diagnostic.
    [SIGNAL_TYPES.ANOMALY_DETECTED]: {
      low: [
        '{node}: metabolic irregularity. Probably normal cell turnover.',
        'Unusual growth marker at {node}. Likely benign. Low priority.',
        '{node} macrophage sending faint anomaly. Classification: unclear.',
      ],
      medium: [
        '{node}: atypical cell division pattern. Worth monitoring.',
        'Growth factor elevation at {node}. Not consistent with normal tissue.',
        '{node}: self-antigen presentation slightly off. Investigate when possible.',
      ],
      high: [
        '{node}: sustained abnormal growth. Cell division markers elevated.',
        'Oncogenic signal from {node}. Confidence: moderate. Scout recommended.',
        '{node}: cells presenting modified self-antigen. Cancer screening indicated.',
      ],
    },
    [SIGNAL_TYPES.THREAT_CONFIRMED]: {
      low: ['{node}: growth marker confirmed. Mass present but small.'],
      medium: ['{node}: malignant cells confirmed. Early stage. Scout advised.', 'Confirmed abnormal proliferation at {node}. Intervention possible.'],
      high: ['{node}: significant malignant mass. Active proliferation. Immediate response.', 'Cancer confirmed at {node}. Rapid response before spread.'],
    },
  },

  [THREAT_TYPES.AUTOIMMUNE]: {
    // Signals look like successful clearance — but the target is self.
    // Suppressing your own response is the correct action.
    [SIGNAL_TYPES.ANOMALY_DETECTED]: {
      low: [
        '{node}: minor self-antigen irregularity. Probably transient stress.',
        'Faint self-reactivity signal from {node}. Below threshold.',
        '{node} tissue reporting minor inflammation. Response activity nearby.',
      ],
      medium: [
        '{node}: self-antigen presentation pattern anomalous. Review response status.',
        'NK cells activating at {node} without clear target. Possible self-reactivity.',
        '{node}: inflammatory cycle detected. Source unclear — threat or response?',
      ],
      high: [
        '{node}: clear self-tissue targeting. Review all active responses here.',
        'Autoimmune pattern at {node}. Your cells are the problem.',
        '{node}: self-reactive cascade. Recall responders before escalation.',
      ],
    },
    [SIGNAL_TYPES.THREAT_CONFIRMED]: {
      low: ['{node}: self-targeting confirmed. Minor damage so far.'],
      medium: ['{node}: active autoimmune response. Tissue damage increasing.', 'Your responders at {node} are attacking self. Recall recommended.'],
      high: ['{node}: severe autoimmune event. Critical self-damage. Recall immediately.', 'Autoimmune cascade at {node} out of control. Suppress all responses.'],
    },
    [SIGNAL_TYPES.COLLATERAL_DAMAGE]: {
      low: ['{node}: minor self-tissue stress. Could be normal response residue.'],
      medium: ['{node}: self-damage above threshold. Your response is the cause.', 'Collateral signal from {node}: responders targeting healthy tissue.'],
      high: ['{node}: severe self-damage. Responder recall critical.', 'Critical self-tissue destruction at {node}. Autoimmune threshold exceeded.'],
    },
  },

  [THREAT_TYPES.MIMIC]: {
    // Early signals look clean. Pattern breaks late when mimic drops cover.
    [SIGNAL_TYPES.PATROL_CLEAR]: {
      low: [
        '{node}: routine patrol. Nothing to report.',
        'Standard sweep at {node}. Environment clean.',
        '{node} clear. No anomalous markers.',
      ],
      medium: [
        '{node} patrol complete. Tissue nominal. Surface markers: normal.',
        'All neutrophils at {node} returning clean. No activation.',
        '{node}: healthy tissue confirmed. No foreign markers.',
      ],
      high: [
        '{node}: comprehensive sweep. Clean. Self-markers all verified.',
        'Thorough {node} coverage: no pathogens. Surface proteins: self.',
        '{node} patrol: all clear. Molecular environment nominal.',
      ],
    },
    [SIGNAL_TYPES.ANOMALY_DETECTED]: {
      // These only appear late (after mimic drops cover)
      low: ['{node}: something changed. Previous clean signals may be wrong.'],
      medium: ['{node}: molecular mimic signature detected. Prior clears suspect.', 'Self-markers at {node} inconsistent with prior readings. Investigate.'],
      high: ['{node}: pathogen abandoning mimicry. Real threat now visible.', 'Cover blown at {node}. Full threat signature now readable. Act now.'],
    },
    [SIGNAL_TYPES.THREAT_CONFIRMED]: {
      low: ['{node}: mimic confirmed. Was hiding in clean signals.'],
      medium: ['{node}: molecular mimic active. Threat level significant.', 'Pathogen at {node} unmasked. Had been mimicking self for multiple turns.'],
      high: ['{node}: full mimic threat revealed. Critical strength. Respond now.', 'Mimic at {node} fully exposed. Immediate response required.'],
    },
  },
};

// ── Public API ───────────────────────────────────────────────────────────────

export function getSignalText(type, confidence, nodeLabel, threatType = null) {
  // Try threat-type-specific template first
  if (threatType && THREAT_TYPE_SIGNALS[threatType]?.[type]) {
    const variants = THREAT_TYPE_SIGNALS[threatType][type][confidence]
      ?? THREAT_TYPE_SIGNALS[threatType][type].medium
      ?? [];
    if (variants.length > 0) {
      const text = variants[Math.floor(Math.random() * variants.length)];
      return text.replace(/{node}/g, nodeLabel);
    }
  }

  // Fall back to generic templates
  const band = genericTemplates[type];
  if (!band) return `Signal from ${nodeLabel}.`;
  const variants = band[confidence] ?? band.medium;
  const text = variants[Math.floor(Math.random() * variants.length)];
  return text.replace(/{node}/g, nodeLabel);
}

export const CONFIDENCE_LEVELS = { LOW: 'low', MEDIUM: 'medium', HIGH: 'high' };

export const ROUTING_DECISIONS = {
  FORWARD: 'forward',
  AMPLIFY: 'amplify',
  SUPPRESS: 'suppress',
  QUARANTINE: 'quarantine',
};

export const ROUTING_COSTS = {
  [ROUTING_DECISIONS.FORWARD]: 1,
  [ROUTING_DECISIONS.AMPLIFY]: 2,
  [ROUTING_DECISIONS.SUPPRESS]: 1,
  [ROUTING_DECISIONS.QUARANTINE]: 1,
};

// Bump confidence up one band (for memory cell bonus)
export function bumpConfidence(confidence) {
  if (confidence === CONFIDENCE_LEVELS.LOW) return CONFIDENCE_LEVELS.MEDIUM;
  if (confidence === CONFIDENCE_LEVELS.MEDIUM) return CONFIDENCE_LEVELS.HIGH;
  return CONFIDENCE_LEVELS.HIGH;
}

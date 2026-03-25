// Signal flavour text library.
// Each signal type has low / medium / high confidence variants.
// {node} is replaced with the node label at generation time.

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
};

const templates = {
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
      'Pathogen present at {node}. Bacterial markers consistent.',
      'Active infection signal at {node}. Strength: moderate.',
      '{node} reporting active threat. Classification: probable bacterial.',
    ],
    high: [
      'Confirmed infection at {node}. Bacterial. Strength significant.',
      '{node}: active bacterial pathogen. Full markers present.',
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

export function getSignalText(type, confidence, nodeLabel) {
  const band = templates[type];
  if (!band) return `Signal from ${nodeLabel}.`;
  const variants = band[confidence] ?? band.medium;
  const text = variants[Math.floor(Math.random() * variants.length)];
  return text.replace('{node}', nodeLabel);
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

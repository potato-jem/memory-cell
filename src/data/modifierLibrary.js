// Modifier Library — all upgrade and scar definitions.
//
// Each entry defines:
//   id              — unique string identifier
//   category        — 'upgrade' | 'scar'
//   name            — display name
//   description     — template string; supports {clearingCellType}, {clearedPathogenType}, {nodeId}
//   baseProbability — relative weight for weighted sampling (default 1.0)
//   eligibleFor     — (context) => boolean — property-based eligibility check
//   rarityLevels    — 1–3 entries: { rarity, probability, value }
//                     probabilities within a modifier should sum to 1.0
//   getPatch        — (context, value, currentRunModifiers) => modifier patch object
//   immediateEffect — optional (context, value) => { tokenCapacityBonus, ... }
//                     applied immediately on CHOOSE_MODIFIER rather than via runModifiers
//
// Upgrade context shape:
//   { category: 'upgrade', clearingCellType, clearedPathogenType, nodeId,
//     cellConfig, pathogenConfig, runModifiers }
//
// Scar context shape:
//   { category: 'scar', nodeId, scarType, threshold, isMinor, isCritical,
//     nodeConfig, runModifiers }
//
// Rarity names:
//   Upgrades: 'common' | 'rare' | 'epic'
//   Scars:    'minor'  | 'moderate' | 'severe'

import { CELL_CONFIG } from './cellConfig.js';
import { PATHOGEN_REGISTRY } from './pathogens.js';

// ── Upgrade Library ───────────────────────────────────────────────────────────

export const UPGRADE_LIBRARY = [

  // ── Cell-targeted upgrades ─────────────────────────────────────────────────

  {
    id: 'clearance_surge',
    category: 'upgrade',
    name: 'Clearance Surge',
    description: '{clearingCellType} clearance rate increased',
    baseProbability: 1.2,
    eligibleFor: (ctx) => !!ctx.clearingCellType && (ctx.cellConfig?.clearanceRate ?? 0) > 0,
    rarityLevels: [
      { rarity: 'common', probability: 0.60, value: 1.15 },
      { rarity: 'rare',   probability: 0.30, value: 1.25 },
      { rarity: 'epic',   probability: 0.10, value: 1.40 },
    ],
    getPatch: (ctx, value, mods) => {
      const current = mods?.cells?.[ctx.clearingCellType]?.clearanceRateMultiplier ?? 1.0;
      return { cells: { [ctx.clearingCellType]: { clearanceRateMultiplier: +(current * value).toFixed(4) } } };
    },
  },

  {
    id: 'rapid_development',
    category: 'upgrade',
    name: 'Rapid Development',
    description: '{clearingCellType} training time reduced',
    baseProbability: 0.9,
    eligibleFor: (ctx) => !!ctx.clearingCellType,
    rarityLevels: [
      { rarity: 'common', probability: 0.60, value: -3 },
      { rarity: 'rare',   probability: 0.30, value: -5 },
      { rarity: 'epic',   probability: 0.10, value: -8 },
    ],
    getPatch: (ctx, value, mods) => {
      const current = mods?.cells?.[ctx.clearingCellType]?.trainingTicksDelta ?? 0;
      return { cells: { [ctx.clearingCellType]: { trainingTicksDelta: current + value } } };
    },
  },

  {
    id: 'efficient_deployment',
    category: 'upgrade',
    name: 'Efficient Deployment',
    description: '{clearingCellType} deployment token cost reduced',
    baseProbability: 0.7,
    eligibleFor: (ctx) => !!ctx.clearingCellType && (ctx.cellConfig?.deployCost ?? 1) > 1,
    rarityLevels: [
      { rarity: 'common', probability: 0.65, value: -1 },
      { rarity: 'rare',   probability: 0.35, value: -2 },
    ],
    getPatch: (ctx, value, mods) => {
      const current = mods?.cells?.[ctx.clearingCellType]?.deploymentCostDelta ?? 0;
      return { cells: { [ctx.clearingCellType]: { deploymentCostDelta: current + value } } };
    },
  },

  {
    id: 'heightened_senses',
    category: 'upgrade',
    name: 'Heightened Senses',
    description: '{clearingCellType} makes extra detection rolls per visit',
    baseProbability: 1.0,
    eligibleFor: (ctx) => !!ctx.clearingCellType && ctx.cellConfig?.isRecon === true,
    rarityLevels: [
      { rarity: 'common', probability: 0.60, value: 1 },
      { rarity: 'rare',   probability: 0.30, value: 1 },
      { rarity: 'epic',   probability: 0.10, value: 2 },
    ],
    getPatch: (ctx, value, mods) => {
      const current = mods?.cells?.[ctx.clearingCellType]?.detectionRollsBonus ?? 0;
      return { cells: { [ctx.clearingCellType]: { detectionRollsBonus: current + value } } };
    },
  },

  {
    id: 'specialized_recognition',
    category: 'upgrade',
    name: 'Specialized Recognition',
    description: '{clearingCellType} more accurately identifies {clearedPathogenType}',
    baseProbability: 0.8,
    eligibleFor: (ctx) => !!ctx.clearingCellType && !!ctx.clearedPathogenType && ctx.cellConfig?.isRecon === true,
    rarityLevels: [
      { rarity: 'common', probability: 0.60, value: 0.10 },
      { rarity: 'rare',   probability: 0.30, value: 0.15 },
      { rarity: 'epic',   probability: 0.10, value: 0.25 },
    ],
    getPatch: (ctx, value, mods) => {
      const current = mods?.detection?.[ctx.clearingCellType]?.[ctx.clearedPathogenType]?.accuracyBonus ?? 0;
      return {
        detection: {
          [ctx.clearingCellType]: {
            [ctx.clearedPathogenType]: { accuracyBonus: +(current + value).toFixed(4) },
          },
        },
      };
    },
  },

  {
    id: 'combat_adaptability',
    category: 'upgrade',
    name: 'Combat Adaptability',
    description: '{clearingCellType} is more effective against unidentified threats',
    baseProbability: 1.0,
    // Only offer if there is room to grow at the 'none' level (less than full effectiveness)
    eligibleFor: (ctx) => !!ctx.clearingCellType
      && ctx.cellConfig?.isAttack === true
      && (ctx.cellConfig?.effectivenessByLevel?.none ?? 1.0) < 0.95,
    rarityLevels: [
      { rarity: 'common', probability: 0.60, value: 0.08 },
      { rarity: 'rare',   probability: 0.30, value: 0.12 },
      { rarity: 'epic',   probability: 0.10, value: 0.18 },
    ],
    getPatch: (ctx, value, mods) => {
      const levels = ['none', 'unknown', 'threat', 'misclassified'];
      const bonus = {};
      for (const level of levels) {
        const current = mods?.cells?.[ctx.clearingCellType]?.effectivenessLevelBonus?.[level] ?? 0;
        bonus[level] = +(current + value).toFixed(4);
      }
      return { cells: { [ctx.clearingCellType]: { effectivenessLevelBonus: bonus } } };
    },
  },

  {
    id: 'reduced_collateral',
    category: 'upgrade',
    name: 'Reduced Collateral Damage',
    description: '{clearingCellType} causes less autoimmune inflammation on clean sites',
    baseProbability: 0.7,
    eligibleFor: (ctx) => !!ctx.clearingCellType && ctx.cellConfig?.isAttack === true,
    rarityLevels: [
      { rarity: 'common', probability: 0.60, value: 0.75 },
      { rarity: 'rare',   probability: 0.30, value: 0.60 },
      { rarity: 'epic',   probability: 0.10, value: 0.50 },
    ],
    getPatch: (ctx, value, mods) => {
      const current = mods?.cells?.[ctx.clearingCellType]?.autoimmuneSurchargeMultiplier ?? 1.0;
      return { cells: { [ctx.clearingCellType]: { autoimmuneSurchargeMultiplier: +(current * value).toFixed(4) } } };
    },
  },

  // ── Pathogen-targeted upgrades ─────────────────────────────────────────────

  {
    id: 'pathogen_vulnerability',
    category: 'upgrade',
    name: 'Pathogen Vulnerability',
    description: 'All cells clear {clearedPathogenType} faster for the rest of this run',
    baseProbability: 1.1,
    eligibleFor: (ctx) => !!ctx.clearedPathogenType,
    rarityLevels: [
      { rarity: 'common', probability: 0.60, value: 1.20 },
      { rarity: 'rare',   probability: 0.30, value: 1.35 },
      { rarity: 'epic',   probability: 0.10, value: 1.55 },
    ],
    getPatch: (ctx, value, mods) => {
      const current = mods?.pathogens?.[ctx.clearedPathogenType]?.clearanceRateMultiplier ?? 1.0;
      return { pathogens: { [ctx.clearedPathogenType]: { clearanceRateMultiplier: +(current * value).toFixed(4) } } };
    },
  },

  {
    id: 'containment_protocol',
    category: 'upgrade',
    name: 'Containment Protocol',
    description: '{clearedPathogenType} requires higher burden before it can spread',
    baseProbability: 0.8,
    eligibleFor: (ctx) => !!ctx.clearedPathogenType && ctx.pathogenConfig?.spreadThreshold != null,
    rarityLevels: [
      { rarity: 'common', probability: 0.60, value: 10 },
      { rarity: 'rare',   probability: 0.30, value: 20 },
      { rarity: 'epic',   probability: 0.10, value: 35 },
    ],
    getPatch: (ctx, value, mods) => {
      const current = mods?.pathogens?.[ctx.clearedPathogenType]?.spreadThresholdDelta ?? 0;
      return { pathogens: { [ctx.clearedPathogenType]: { spreadThresholdDelta: current + value } } };
    },
  },

  {
    id: 'tissue_resilience',
    category: 'upgrade',
    name: 'Tissue Resilience',
    description: '{clearedPathogenType} causes less direct tissue damage',
    baseProbability: 0.9,
    eligibleFor: (ctx) => !!ctx.clearedPathogenType && (ctx.pathogenConfig?.tissueDamageRate ?? 0) > 0,
    rarityLevels: [
      { rarity: 'common', probability: 0.60, value: 0.80 },
      { rarity: 'rare',   probability: 0.30, value: 0.65 },
      { rarity: 'epic',   probability: 0.10, value: 0.50 },
    ],
    getPatch: (ctx, value, mods) => {
      const current = mods?.pathogens?.[ctx.clearedPathogenType]?.damageRateMultiplier ?? 1.0;
      return { pathogens: { [ctx.clearedPathogenType]: { damageRateMultiplier: +(current * value).toFixed(4) } } };
    },
  },

  {
    id: 'anti_inflammatory',
    category: 'upgrade',
    name: 'Anti-Inflammatory Response',
    description: '{clearedPathogenType} provokes less inflammation',
    baseProbability: 0.9,
    eligibleFor: (ctx) => !!ctx.clearedPathogenType && (ctx.pathogenConfig?.inflammationRate ?? 0) > 0,
    rarityLevels: [
      { rarity: 'common', probability: 0.60, value: 0.80 },
      { rarity: 'rare',   probability: 0.30, value: 0.65 },
      { rarity: 'epic',   probability: 0.10, value: 0.50 },
    ],
    getPatch: (ctx, value, mods) => {
      const current = mods?.pathogens?.[ctx.clearedPathogenType]?.inflammationRateMultiplier ?? 1.0;
      return { pathogens: { [ctx.clearedPathogenType]: { inflammationRateMultiplier: +(current * value).toFixed(4) } } };
    },
  },

  {
    id: 'replication_inhibitor',
    category: 'upgrade',
    name: 'Replication Inhibitor',
    description: '{clearedPathogenType} replicates more slowly',
    baseProbability: 1.0,
    eligibleFor: (ctx) => !!ctx.clearedPathogenType && (ctx.pathogenConfig?.replicationRate ?? 0) > 0,
    rarityLevels: [
      { rarity: 'common', probability: 0.60, value: 0.85 },
      { rarity: 'rare',   probability: 0.30, value: 0.70 },
      { rarity: 'epic',   probability: 0.10, value: 0.55 },
    ],
    getPatch: (ctx, value, mods) => {
      const current = mods?.pathogens?.[ctx.clearedPathogenType]?.growthRateMultiplier ?? 1.0;
      return { pathogens: { [ctx.clearedPathogenType]: { growthRateMultiplier: +(current * value).toFixed(4) } } };
    },
  },

  // ── Global upgrades ────────────────────────────────────────────────────────

  {
    id: 'systemic_recovery',
    category: 'upgrade',
    name: 'Systemic Recovery',
    description: 'Tissue integrity recovers faster throughout the body',
    baseProbability: 0.8,
    eligibleFor: (_ctx) => true,
    rarityLevels: [
      { rarity: 'common', probability: 0.60, value: 0.5 },
      { rarity: 'rare',   probability: 0.30, value: 1.0 },
      { rarity: 'epic',   probability: 0.10, value: 2.0 },
    ],
    getPatch: (_ctx, value, mods) => {
      const current = mods?.systemic?.integrityRecoveryBonus ?? 0;
      return { systemic: { integrityRecoveryBonus: +(current + value).toFixed(4) } };
    },
  },

  {
    id: 'stress_hardening',
    category: 'upgrade',
    name: 'Stress Hardening',
    description: 'Systemic stress decays faster',
    baseProbability: 0.8,
    eligibleFor: (_ctx) => true,
    rarityLevels: [
      { rarity: 'common', probability: 0.60, value: 1 },
      { rarity: 'rare',   probability: 0.30, value: 2 },
      { rarity: 'epic',   probability: 0.10, value: 4 },
    ],
    getPatch: (_ctx, value, mods) => {
      const current = mods?.systemic?.stressDecayBonus ?? 0;
      return { systemic: { stressDecayBonus: current + value } };
    },
  },

  {
    id: 'adaptive_memory',
    category: 'upgrade',
    name: 'Adaptive Memory',
    description: '{clearedPathogenType} is less likely to spawn for the rest of this run',
    baseProbability: 0.7,
    eligibleFor: (ctx) => !!ctx.clearedPathogenType,
    rarityLevels: [
      { rarity: 'common', probability: 0.60, value: 0.75 },
      { rarity: 'rare',   probability: 0.30, value: 0.60 },
      { rarity: 'epic',   probability: 0.10, value: 0.45 },
    ],
    getPatch: (ctx, value, mods) => {
      const current = mods?.spawn?.[ctx.clearedPathogenType]?.weightMultiplier ?? 1.0;
      return { spawn: { [ctx.clearedPathogenType]: { weightMultiplier: +(current * value).toFixed(4) } } };
    },
  },

  {
    id: 'fever_optimization',
    category: 'upgrade',
    name: 'Fever Optimization',
    description: 'Fever generates less systemic stress, making it more viable to sustain',
    baseProbability: 0.6,
    eligibleFor: (_ctx) => true,
    rarityLevels: [
      { rarity: 'common', probability: 0.60, value: 0.90 },
      { rarity: 'rare',   probability: 0.30, value: 0.80 },
      { rarity: 'epic',   probability: 0.10, value: 0.65 },
    ],
    getPatch: (_ctx, value, mods) => {
      const current = mods?.systemic?.feverStressMultiplier ?? 1.0;
      return { systemic: { feverStressMultiplier: +(current * value).toFixed(4) } };
    },
  },

  {
    id: 'immune_surge',
    category: 'upgrade',
    name: 'Immune Surge',
    description: 'The immune response floods the system — gain additional token capacity',
    baseProbability: 0.5,
    eligibleFor: (_ctx) => true,
    rarityLevels: [
      { rarity: 'rare', probability: 0.65, value: 1 },
      { rarity: 'epic', probability: 0.35, value: 2 },
    ],
    getPatch: (_ctx, _value, _mods) => ({}),
    immediateEffect: (_ctx, value) => ({ tokenCapacityBonus: value }),
  },

  // ── Novel upgrades ─────────────────────────────────────────────────────────

  {
    id: 'viral_counter_protocol',
    category: 'upgrade',
    name: 'Viral Counter-Protocol',
    // Extra clearance rate specifically vs exponential-growth pathogens (virus)
    // Implemented as a pathogen clearance multiplier bonus for exponential types
    description: 'Immunity optimised against rapidly-replicating pathogens',
    baseProbability: 0.7,
    eligibleFor: (ctx) => !!ctx.clearedPathogenType && ctx.pathogenConfig?.growthModel === 'exponential',
    rarityLevels: [
      { rarity: 'common', probability: 0.60, value: 1.20 },
      { rarity: 'rare',   probability: 0.30, value: 1.40 },
      { rarity: 'epic',   probability: 0.10, value: 1.65 },
    ],
    getPatch: (ctx, value, mods) => {
      const current = mods?.pathogens?.[ctx.clearedPathogenType]?.clearanceRateMultiplier ?? 1.0;
      return { pathogens: { [ctx.clearedPathogenType]: { clearanceRateMultiplier: +(current * value).toFixed(4) } } };
    },
  },

  {
    id: 'deep_tissue_scan',
    category: 'upgrade',
    // PLACEHOLDER: full mechanic requires per-node detection accuracy system.
    // Currently implemented as a global accuracyBonus for all recon cells vs all pathogen types.
    name: 'Deep Tissue Scan',
    description: 'Improved scanning techniques boost detection accuracy across the board',
    baseProbability: 0.6,
    eligibleFor: (_ctx) => true,
    rarityLevels: [
      { rarity: 'common', probability: 0.60, value: 0.05 },
      { rarity: 'rare',   probability: 0.30, value: 0.10 },
      { rarity: 'epic',   probability: 0.10, value: 0.15 },
    ],
    getPatch: (_ctx, value, mods) => {
      const patch = { detection: {} };
      for (const [cellType, cfg] of Object.entries(CELL_CONFIG)) {
        if (!cfg.isRecon || (cfg.detectionRolls ?? 0) === 0) continue;
        patch.detection[cellType] = {};
        for (const pathType of Object.keys(PATHOGEN_REGISTRY)) {
          const current = mods?.detection?.[cellType]?.[pathType]?.accuracyBonus ?? 0;
          patch.detection[cellType][pathType] = { accuracyBonus: +(current + value).toFixed(4) };
        }
      }
      return patch;
    },
  },

  {
    id: 'metabolic_efficiency',
    category: 'upgrade',
    name: 'Metabolic Efficiency',
    description: 'Stress recovery is improved — {clearingCellType} has been battle-tested',
    baseProbability: 0.65,
    // Offered only for attack cells (simulates exhaustion → adaptation)
    eligibleFor: (ctx) => !!ctx.clearingCellType && ctx.cellConfig?.isAttack === true,
    rarityLevels: [
      { rarity: 'common', probability: 0.60, value: 1 },
      { rarity: 'rare',   probability: 0.30, value: 2 },
      { rarity: 'epic',   probability: 0.10, value: 3 },
    ],
    getPatch: (_ctx, value, mods) => {
      const current = mods?.systemic?.stressDecayBonus ?? 0;
      return { systemic: { stressDecayBonus: current + value } };
    },
  },
];

// ── Scar Library ──────────────────────────────────────────────────────────────

export const SCAR_LIBRARY = [

  // ── Node-specific scars ────────────────────────────────────────────────────

  {
    id: 'signal_interference',
    category: 'scar',
    name: 'Signal Interference',
    description: 'Scar tissue at {nodeId} disrupts immune signalling — transit cost increased',
    baseProbability: 1.2,
    eligibleFor: (ctx) => !!ctx.nodeId,
    rarityLevels: [
      { rarity: 'minor',    probability: 0.65, value: 1 },
      { rarity: 'moderate', probability: 0.25, value: 2 },
      { rarity: 'severe',   probability: 0.10, value: 3 },
    ],
    getPatch: (ctx, value, mods) => {
      const current = mods?.nodes?.[ctx.nodeId]?.exitCostDelta ?? 0;
      return { nodes: { [ctx.nodeId]: { exitCostDelta: current + value } } };
    },
  },

  {
    id: 'infection_gateway',
    category: 'scar',
    name: 'Infection Gateway',
    description: 'Damaged tissue at {nodeId} is more vulnerable to future infection',
    baseProbability: 1.1,
    eligibleFor: (ctx) => !!ctx.nodeId,
    rarityLevels: [
      { rarity: 'minor',    probability: 0.65, value: 1.25 },
      { rarity: 'moderate', probability: 0.25, value: 1.50 },
      { rarity: 'severe',   probability: 0.10, value: 2.00 },
    ],
    getPatch: (ctx, value, mods) => {
      const current = mods?.nodes?.[ctx.nodeId]?.spawnWeightMultiplier ?? 1.0;
      return { nodes: { [ctx.nodeId]: { spawnWeightMultiplier: +(current * value).toFixed(4) } } };
    },
  },

  {
    id: 'cellular_exhaustion',
    category: 'scar',
    name: 'Cellular Exhaustion',
    description: 'Chronic injury at {nodeId} reduces immune cell clearance effectiveness there',
    baseProbability: 1.0,
    eligibleFor: (ctx) => !!ctx.nodeId,
    rarityLevels: [
      { rarity: 'minor',    probability: 0.65, value: 0.85 },
      { rarity: 'moderate', probability: 0.25, value: 0.70 },
      { rarity: 'severe',   probability: 0.10, value: 0.55 },
    ],
    getPatch: (ctx, value, mods) => {
      const current = mods?.nodes?.[ctx.nodeId]?.cellClearanceMultiplier ?? 1.0;
      return { nodes: { [ctx.nodeId]: { cellClearanceMultiplier: +(current * value).toFixed(4) } } };
    },
  },

  {
    id: 'inflammatory_memory',
    category: 'scar',
    name: 'Inflammatory Memory',
    description: 'Sensitised tissue at {nodeId} — inflammation decays more slowly there',
    baseProbability: 0.9,
    eligibleFor: (ctx) => !!ctx.nodeId,
    rarityLevels: [
      { rarity: 'minor',    probability: 0.65, value: 0.75 },
      { rarity: 'moderate', probability: 0.25, value: 0.55 },
      { rarity: 'severe',   probability: 0.10, value: 0.35 },
    ],
    getPatch: (ctx, value, mods) => {
      const current = mods?.nodes?.[ctx.nodeId]?.inflammationDecayMultiplier ?? 1.0;
      return { nodes: { [ctx.nodeId]: { inflammationDecayMultiplier: +(current * value).toFixed(4) } } };
    },
  },

  {
    id: 'rerouted_response',
    category: 'scar',
    // PLACEHOLDER: full effect (patrol cells avoid scarred node) requires patrol routing change.
    // Currently implemented as an increased spawn weight (node is compromised, easier to infect).
    name: 'Rerouted Response',
    description: 'Nerve damage at {nodeId} delays immune cell arrival — signals rerouted',
    baseProbability: 0.7,
    eligibleFor: (ctx) => !!ctx.nodeId,
    rarityLevels: [
      { rarity: 'minor',    probability: 0.65, value: 1 },
      { rarity: 'moderate', probability: 0.25, value: 2 },
      { rarity: 'severe',   probability: 0.10, value: 3 },
    ],
    getPatch: (ctx, value, mods) => {
      // Extra transit cost (compounds with signal_interference)
      const current = mods?.nodes?.[ctx.nodeId]?.exitCostDelta ?? 0;
      return { nodes: { [ctx.nodeId]: { exitCostDelta: current + value } } };
    },
  },

  // ── Global / systemic scars ────────────────────────────────────────────────

  {
    id: 'immune_exhaustion',
    category: 'scar',
    name: 'Immune Exhaustion',
    description: 'Sustained fighting has slowed immune cell training across the board',
    baseProbability: 0.9,
    eligibleFor: (_ctx) => true,
    rarityLevels: [
      { rarity: 'minor',    probability: 0.65, value: 3 },
      { rarity: 'moderate', probability: 0.25, value: 5 },
      { rarity: 'severe',   probability: 0.10, value: 8 },
    ],
    getPatch: (_ctx, value, mods) => {
      const patch = { cells: {} };
      for (const [cellType, cfg] of Object.entries(CELL_CONFIG)) {
        if (!cfg.isAttack) continue;
        const current = mods?.cells?.[cellType]?.trainingTicksDelta ?? 0;
        patch.cells[cellType] = { trainingTicksDelta: current + value };
      }
      return patch;
    },
  },

  {
    id: 'systemic_inflammation',
    category: 'scar',
    name: 'Systemic Inflammation',
    description: 'Elevated baseline inflammation makes fever significantly more taxing',
    baseProbability: 0.8,
    eligibleFor: (_ctx) => true,
    rarityLevels: [
      { rarity: 'minor',    probability: 0.65, value: 1.10 },
      { rarity: 'moderate', probability: 0.25, value: 1.20 },
      { rarity: 'severe',   probability: 0.10, value: 1.35 },
    ],
    getPatch: (_ctx, value, mods) => {
      const current = mods?.systemic?.feverStressMultiplier ?? 1.0;
      return { systemic: { feverStressMultiplier: +(current * value).toFixed(4) } };
    },
  },

  {
    id: 'compromised_recovery',
    category: 'scar',
    name: 'Compromised Recovery',
    description: 'Widespread damage has impaired the body\'s natural healing ability',
    baseProbability: 0.8,
    eligibleFor: (_ctx) => true,
    rarityLevels: [
      { rarity: 'minor',    probability: 0.65, value: -0.5 },
      { rarity: 'moderate', probability: 0.25, value: -1.0 },
      { rarity: 'severe',   probability: 0.10, value: -2.0 },
    ],
    getPatch: (_ctx, value, mods) => {
      const current = mods?.systemic?.integrityRecoveryBonus ?? 0;
      return { systemic: { integrityRecoveryBonus: +(current + value).toFixed(4) } };
    },
  },

  {
    id: 'heightened_susceptibility',
    category: 'scar',
    name: 'Heightened Susceptibility',
    description: 'Systemic weakness makes the body more vulnerable to new infections globally',
    baseProbability: 0.7,
    eligibleFor: (ctx) => ctx.scarType === 'systemic_integrity',
    rarityLevels: [
      { rarity: 'minor',    probability: 0.65, value: 1.15 },
      { rarity: 'moderate', probability: 0.25, value: 1.30 },
      { rarity: 'severe',   probability: 0.10, value: 1.50 },
    ],
    getPatch: (_ctx, value, mods) => {
      const current = mods?.systemic?.globalSpawnWeightMultiplier ?? 1.0;
      return { systemic: { globalSpawnWeightMultiplier: +(current * value).toFixed(4) } };
    },
  },

  {
    id: 'chronic_stress_response',
    category: 'scar',
    name: 'Chronic Stress Response',
    description: 'The body overreacts to prolonged threats — stress accumulates faster',
    baseProbability: 0.7,
    eligibleFor: (_ctx) => true,
    rarityLevels: [
      { rarity: 'minor',    probability: 0.65, value: -1 },
      { rarity: 'moderate', probability: 0.25, value: -2 },
      { rarity: 'severe',   probability: 0.10, value: -3 },
    ],
    getPatch: (_ctx, value, mods) => {
      // Negative stressDecayBonus = slower stress decay (more accumulation)
      const current = mods?.systemic?.stressDecayBonus ?? 0;
      return { systemic: { stressDecayBonus: current + value } };
    },
  },

  {
    id: 'detection_noise',
    category: 'scar',
    name: 'Detection Noise',
    description: 'Scarring creates false signals — detection accuracy reduced',
    baseProbability: 0.6,
    eligibleFor: (_ctx) => true,
    rarityLevels: [
      { rarity: 'minor',    probability: 0.65, value: -0.06 },
      { rarity: 'moderate', probability: 0.25, value: -0.12 },
      { rarity: 'severe',   probability: 0.10, value: -0.18 },
    ],
    getPatch: (_ctx, value, mods) => {
      const patch = { detection: {} };
      for (const [cellType, cfg] of Object.entries(CELL_CONFIG)) {
        if (!cfg.isRecon || (cfg.detectionRolls ?? 0) === 0) continue;
        patch.detection[cellType] = {};
        for (const pathType of Object.keys(PATHOGEN_REGISTRY)) {
          const current = mods?.detection?.[cellType]?.[pathType]?.accuracyBonus ?? 0;
          patch.detection[cellType][pathType] = { accuracyBonus: +(current + value).toFixed(4) };
        }
      }
      return patch;
    },
  },
];

// ── Combined library ──────────────────────────────────────────────────────────

export const MODIFIER_LIBRARY = [...UPGRADE_LIBRARY, ...SCAR_LIBRARY];

// Modifier selector — picks N upgrade or scar options from the library.
//
// Usage:
//   selectUpgradeOptions(context, runModifiers, count) → option[]
//   selectScarOptions(context, runModifiers, count)    → option[]
//
// Each returned option:
//   {
//     modifierId:     string,          — id from the modifier library
//     category:       'upgrade'|'scar',
//     name:           string,
//     rarity:         string,          — e.g. 'common', 'rare', 'epic' / 'minor'...
//     value:          number,          — the selected rarity's value
//     description:    string,          — interpolated description
//     context:        object,          — primitive context (serialisable; used to recompute patch at apply time)
//     immediateEffect: null | object,  — e.g. { tokenCapacityBonus: 1 }
//   }
//
// The patch is NOT stored on the option. It is recomputed at apply time (CHOOSE_MODIFIER)
// using the then-current runModifiers, which ensures correct stacking when multiple
// choices are queued in the same turn.

import { UPGRADE_LIBRARY, SCAR_LIBRARY } from './modifierLibrary.js';
import { CELL_CONFIG } from './cellConfig.js';
import { PATHOGEN_REGISTRY, PATHOGEN_DISPLAY_NAMES } from './pathogens.js';

// Fallback color for systemic / node-scoped modifiers with no cell or pathogen anchor.
const SYSTEMIC_EFFECT_COLOR = '#94a3b8'; // slate-400
import { NODES } from './nodes.js';

// Number of options presented per choice event. Configurable here.
export const MODIFIER_CHOICE_COUNT = 2;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build the full context object for an upgrade trigger.
 * @param {string|null} clearingCellType   — cell type that cleared the pathogen
 * @param {string}      clearedPathogenType
 * @param {string}      nodeId
 * @param {Object}      runModifiers        — current run modifiers (for eligibility checks)
 */
export function makeUpgradeContext(clearingCellType, clearedPathogenType, nodeId, runModifiers) {
  return {
    category: 'upgrade',
    clearingCellType:    clearingCellType ?? null,
    clearedPathogenType: clearedPathogenType ?? null,
    nodeId:              nodeId ?? null,
    cellConfig:          clearingCellType ? CELL_CONFIG[clearingCellType] : null,
    pathogenConfig:      clearedPathogenType ? PATHOGEN_REGISTRY[clearedPathogenType] : null,
    runModifiers,
  };
}

/**
 * Build the full context object for a scar trigger.
 * @param {string|null} nodeId      — null for systemic scars
 * @param {string}      scarType    — 'site_integrity' | 'systemic_integrity'
 * @param {number|null} threshold   — e.g. 50, 25, 0
 * @param {Object}      runModifiers
 */
export function makeScarContext(nodeId, scarType, threshold, runModifiers) {
  return {
    category:  'scar',
    nodeId:    nodeId ?? null,
    scarType:  scarType ?? null,
    threshold: threshold ?? null,
    isMinor:   threshold === 50,
    isCritical: threshold === 0,
    nodeConfig: nodeId ? NODES[nodeId] : null,
    runModifiers,
  };
}

/**
 * Select up to `count` upgrade options for a pathogen-cleared event.
 * Returns fewer options if not enough eligible modifiers exist.
 */
export function selectUpgradeOptions(context, runModifiers, count = MODIFIER_CHOICE_COUNT) {
  return selectOptions(UPGRADE_LIBRARY, context, runModifiers, count);
}

/**
 * Select up to `count` scar options for a scar threshold event.
 */
export function selectScarOptions(context, runModifiers, count = MODIFIER_CHOICE_COUNT) {
  return selectOptions(SCAR_LIBRARY, context, runModifiers, count);
}

// ── Internal selection logic ──────────────────────────────────────────────────

function selectOptions(library, context, runModifiers, count) {
  // Build a pool of candidate entries: one per eligible modifier (with rarity already picked)
  const pool = [];

  for (const modifier of library) {
    try {
      if (!modifier.eligibleFor(context)) continue;
    } catch (_) {
      continue; // guard against unexpected errors in eligibility predicates
    }

    const rarityEntry = pickRarity(modifier.rarityLevels);
    if (!rarityEntry) continue;

    pool.push({
      modifier,
      rarityEntry,
      weight: modifier.baseProbability ?? 1.0,
    });
  }

  if (pool.length === 0) return [];

  // Weighted sample without replacement — draw up to `count` distinct modifiers
  const selected = weightedSampleWithoutReplacement(pool, Math.min(count, pool.length));

  return selected.map(({ modifier, rarityEntry }) => buildOption(modifier, rarityEntry, context));
}

/** Pick a rarity level for a modifier by weighted random. */
function pickRarity(rarityLevels) {
  if (!rarityLevels?.length) return null;
  if (rarityLevels.length === 1) return rarityLevels[0];

  const total = rarityLevels.reduce((s, r) => s + (r.probability ?? 1), 0);
  let rand = Math.random() * total;
  for (const level of rarityLevels) {
    rand -= level.probability ?? 1;
    if (rand <= 0) return level;
  }
  return rarityLevels[rarityLevels.length - 1];
}

/** Weighted sample without replacement from a pool of { modifier, rarityEntry, weight }. */
function weightedSampleWithoutReplacement(pool, count) {
  const result = [];
  const remaining = [...pool];

  for (let i = 0; i < count && remaining.length > 0; i++) {
    const total = remaining.reduce((s, item) => s + item.weight, 0);
    let rand = Math.random() * total;
    let idx = remaining.length - 1;
    for (let j = 0; j < remaining.length; j++) {
      rand -= remaining[j].weight;
      if (rand <= 0) { idx = j; break; }
    }
    result.push(remaining[idx]);
    remaining.splice(idx, 1);
  }

  return result;
}

/** Resolve a hex color from a modifier's effectColorKey and the current context. */
function resolveEffectColor(effectColorKey, context) {
  if (effectColorKey === 'cell' && context.clearingCellType) {
    return CELL_CONFIG[context.clearingCellType]?.color ?? SYSTEMIC_EFFECT_COLOR;
  }
  if (effectColorKey === 'pathogen' && context.clearedPathogenType) {
    return PATHOGEN_REGISTRY[context.clearedPathogenType]?.ringColor ?? SYSTEMIC_EFFECT_COLOR;
  }
  return SYSTEMIC_EFFECT_COLOR;
}

/** Build a serialisable option object from a modifier + rarity entry + context. */
function buildOption(modifier, rarityEntry, context) {
  return {
    modifierId:     modifier.id,
    category:       modifier.category,
    name:           modifier.name,
    rarity:         rarityEntry.rarity,
    value:          rarityEntry.value,
    description:    interpolateDescription(modifier.description ?? '', context),
    effectLabel:    modifier.effectLabel ? modifier.effectLabel(context, rarityEntry.value) : null,
    effectColor:    modifier.effectColorKey ? resolveEffectColor(modifier.effectColorKey, context) : null,
    // Serialisable context (primitive values only) — used to recompute patch at apply time
    context: {
      category:            context.category,
      clearingCellType:    context.clearingCellType ?? null,
      clearedPathogenType: context.clearedPathogenType ?? null,
      nodeId:              context.nodeId ?? null,
      scarType:            context.scarType ?? null,
      threshold:           context.threshold ?? null,
      isMinor:             context.isMinor ?? false,
      isCritical:          context.isCritical ?? false,
    },
    immediateEffect: modifier.immediateEffect
      ? modifier.immediateEffect(context, rarityEntry.value)
      : null,
  };
}

/** Replace template placeholders with human-readable context values. */
function interpolateDescription(template, context) {
  let desc = template;
  if (context.clearingCellType) {
    const name = CELL_CONFIG[context.clearingCellType]?.displayName ?? context.clearingCellType;
    desc = desc.replaceAll('{clearingCellType}', name);
  }
  if (context.clearedPathogenType) {
    const name = PATHOGEN_DISPLAY_NAMES?.[context.clearedPathogenType] ?? context.clearedPathogenType;
    desc = desc.replaceAll('{clearedPathogenType}', name);
  }
  if (context.nodeId) {
    desc = desc.replaceAll('{nodeId}', context.nodeId);
  }
  return desc;
}

// ── Patch recomputation at apply time ─────────────────────────────────────────
// Called by handleChooseModifier in actions.js so that multiplier stacking is
// based on the run modifiers at the moment the player makes their choice,
// not when the options were first generated.

import { MODIFIER_LIBRARY } from './modifierLibrary.js';

/**
 * Recompute a modifier patch using the current runModifiers.
 * Reconstructs the full context (including config references) from the stored
 * primitive context before calling the modifier's getPatch function.
 */
export function computeOptionPatch(option, currentRunModifiers) {
  const modifier = MODIFIER_LIBRARY.find(m => m.id === option.modifierId);
  if (!modifier) return {};

  const ctx = {
    ...option.context,
    cellConfig:     option.context.clearingCellType ? CELL_CONFIG[option.context.clearingCellType] : null,
    pathogenConfig: option.context.clearedPathogenType ? PATHOGEN_REGISTRY[option.context.clearedPathogenType] : null,
    nodeConfig:     option.context.nodeId ? NODES[option.context.nodeId] : null,
    runModifiers:   currentRunModifiers,
  };

  return modifier.getPatch(ctx, option.value, currentRunModifiers);
}

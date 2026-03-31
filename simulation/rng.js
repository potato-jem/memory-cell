/**
 * Seeded PRNG — mulberry32 algorithm.
 * Returns a function () => [0, 1) that is deterministic given the same seed.
 */
export function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Derive a child seed from a parent seed and a run index.
 * Keeps runs independent while remaining fully reproducible from the top-level seed.
 */
export function childSeed(baseSeed, index) {
  // Simple hash mix so run 0 and run 1 don't share state
  return (baseSeed * 1664525 + index * 22695477 + 1013904223) >>> 0;
}

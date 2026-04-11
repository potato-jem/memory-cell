const META_SAVE_KEY = 'memorycell_meta_v1';

export function saveMeta(metaState) {
  try {
    localStorage.setItem(META_SAVE_KEY, JSON.stringify(metaState));
  } catch (e) { /* storage full — ignore */ }
}

export function loadMeta() {
  try {
    const raw = localStorage.getItem(META_SAVE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved?.metaRunId) return null;
    return saved;
  } catch (e) { return null; }
}

export function clearMeta() {
  localStorage.removeItem(META_SAVE_KEY);
}

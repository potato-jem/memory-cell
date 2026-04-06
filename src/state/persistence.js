const SAVE_KEY = 'memorycell_run_v1';

export function saveRun(state) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch (e) { /* storage full — ignore */ }
}

export function loadRun() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    // Basic validity check — must have a phase and tick to be usable
    if (!saved?.phase || saved?.tick == null) return null;
    return saved;
  } catch (e) { return null; }
}

export function clearRun() {
  localStorage.removeItem(SAVE_KEY);
}

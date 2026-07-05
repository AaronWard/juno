/** Browser-side persistence.
 *
 *  - localStorage: UI preferences (selected workspace, view mode, volume...)
 *  - IndexedDB-style needs are served by the proxy JSON db under /data;
 *    the browser keeps only lightweight preferences.
 */
const PREFIX = "juno:";

export function loadPref<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    // Local storage unavailable (private mode, quota) — degrade silently.
    return fallback;
  }
}

export function savePref<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage unavailable — session-only state */
  }
}

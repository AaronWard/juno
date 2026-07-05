/** Formatting helpers. */
export function fmtDuration(totalSeconds: number): string {
  if (!isFinite(totalSeconds) || totalSeconds <= 0) return "0:00";
  const s = Math.round(totalSeconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function fmtRelative(iso: string): string {
  const d = new Date(iso).getTime();
  if (!isFinite(d)) return "";
  const diff = Date.now() - d;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

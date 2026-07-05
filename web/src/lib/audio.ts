/** Local audio helpers for mock waveforms and client-side edits. */

/** Deterministic pseudo-waveform for a song id (mock visual only). */
export function mockWaveform(seedStr: string, bars = 64): number[] {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    out.push(0.15 + (Math.abs(h) % 1000) / 1180);
  }
  return out;
}

/** Cover art gradient from a song id — stable, no external assets. */
export function coverGradient(id: string): string {
  let n = 0;
  for (let i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) >>> 0;
  const h1 = n % 360;
  const h2 = (h1 + 60 + (n % 90)) % 360;
  return `linear-gradient(135deg, hsl(${h1} 55% 32%), hsl(${h2} 65% 20%))`;
}

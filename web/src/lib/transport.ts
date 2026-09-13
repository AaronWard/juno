/** Global "only one thing plays at a time" registry.
 *
 *  Juno has three independent transports that know nothing about each other:
 *  the bottom player (an <audio> element), the MIDI tab (a Web Audio
 *  MidiPlayer) and the Editor. Starting one used to leave the others running,
 *  so MIDI playback layered over whatever the library player was doing.
 *
 *  Anything that starts making sound claims the transport by id; the previous
 *  claimant is asked to stop. Deliberately module-level rather than React
 *  state: claiming happens inside play handlers and audio callbacks, where a
 *  re-render is both unnecessary and too late.
 */

export type TransportId = "player" | "midi" | "editor";

interface Claim {
  id: TransportId;
  stop: () => void;
}

let current: Claim | null = null;

/** Take the transport, stopping whoever held it. Call this when playback
 *  actually starts, not when a component mounts. */
export function claimTransport(id: TransportId, stop: () => void): void {
  if (current && current.id !== id) {
    const previous = current;
    current = null; // set first: previous.stop() may call releaseTransport
    try {
      previous.stop();
    } catch {
      /* a dead transport must not block the new one */
    }
  }
  current = { id, stop };
}

/** Give up the transport if we still hold it (on pause/stop/unmount). */
export function releaseTransport(id: TransportId): void {
  if (current?.id === id) current = null;
}

export function transportHolder(): TransportId | null {
  return current?.id ?? null;
}

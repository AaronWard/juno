import React from "react";
import { useJuno } from "../App";
import { fmtDuration } from "../lib/format";
import { coverGradient } from "../lib/audio";

/** Local queue drawer opened from the bottom player. */
export function QueueDrawer({ onClose }: { onClose: () => void }) {
  const { queue, songs, currentSong, playSong } = useJuno();
  const items = queue
    .map((id) => songs.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => !!s);

  return (
    <div className="queue-drawer" role="region" aria-label="Playback queue">
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <strong>Queue</strong>
        <button className="btn btn-icon" onClick={onClose} aria-label="Close queue">✕</button>
      </div>
      {items.length === 0 && <p className="inline-hint">Queue is empty.</p>}
      {items.map((s) => (
        <button
          key={s.id}
          className={`menu-item${currentSong?.id === s.id ? " selected" : ""}`}
          onClick={() => playSong(s.id, queue)}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span
              aria-hidden="true"
              style={{
                width: 26,
                height: 26,
                borderRadius: 6,
                flex: "none",
                background: coverGradient(s.id),
              }}
            />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {s.title}
            </span>
          </span>
          <span className="inline-hint">{fmtDuration(s.durationSeconds)}</span>
        </button>
      ))}
    </div>
  );
}

/** Self-contained Playlists panel, rendered by LibraryPage's Playlists tab.
 *  Provides: create playlist, per-playlist song counts, and an inline view
 *  of a playlist's songs. Songs are added/removed from playlists via a
 *  song's ⋯ menu → Playlists (see PlaylistMenuSection).
 */
import React, { useState } from "react";
import { useJuno } from "../App";
import { SongRow } from "./SongRow";

export function PlaylistsPanel() {
  const { playlists, songs, addPlaylist } = useJuno();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const songsIn = (playlistId: string) =>
    songs.filter(
      (s) => !s.trashed && (s.playlistIds || []).includes(playlistId)
    );

  const create = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    try {
      await addPlaylist(n);
      setName("");
      setCreating(false);
    } finally {
      setBusy(false);
    }
  };

  const open = openId ? playlists.find((p) => p.id === openId) : null;
  const openSongs = openId ? songsIn(openId) : [];

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "10px 0" }}>
        {!creating ? (
          <button className="btn" onClick={() => setCreating(true)}>
            ＋ New playlist
          </button>
        ) : (
          <>
            <input
              autoFocus
              value={name}
              placeholder="Playlist name"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid rgba(128,128,128,.4)",
                background: "transparent",
                color: "inherit",
              }}
            />
            <button className="btn" disabled={!name.trim() || busy} onClick={create}>
              Create
            </button>
            <button
              className="btn"
              onClick={() => {
                setCreating(false);
                setName("");
              }}
            >
              Cancel
            </button>
          </>
        )}
      </div>

      {playlists.length === 0 && (
        <p style={{ opacity: 0.7 }}>
          No playlists yet — create one above, then add songs from a song's ⋯
          menu → Playlists.
        </p>
      )}

      <div className="card-grid">
        {playlists.map((p) => {
          const count = songsIn(p.id).length;
          return (
            <div key={p.id} className="asset-card">
              <div className="asset-thumb">🎵</div>
              <strong>{p.name}</strong>
              <span style={{ opacity: 0.7, fontSize: 12 }}>
                {count} song{count === 1 ? "" : "s"}
              </span>
              <button
                className="btn"
                onClick={() => setOpenId(openId === p.id ? null : p.id)}
              >
                {openId === p.id ? "Close" : "Open"}
              </button>
            </div>
          );
        })}
      </div>

      {open && (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ margin: "8px 0" }}>{open.name}</h3>
          {openSongs.length === 0 ? (
            <p style={{ opacity: 0.7 }}>
              Empty playlist — use a song's ⋯ menu → Playlists to add songs.
            </p>
          ) : (
            <div className="song-list">
              {openSongs.map((s) => (
                <SongRow key={s.id} song={s} queueIds={openSongs.map((x) => x.id)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

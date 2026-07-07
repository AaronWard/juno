/** "Playlists" section for SongOverflowMenu's dropdown. Renders one
 *  toggleable item per playlist (✓ when the song is a member). Drop
 *  <PlaylistMenuSection song={song} /> anywhere inside the menu.
 */
import React from "react";
import { useJuno } from "../App";
import { Song } from "../data/mockSongs";

export function PlaylistMenuSection({ song }: { song: Song }) {
  const { playlists, toggleSongInPlaylist } = useJuno();
  return (
    <>
      <div className="menu-divider" style={{ borderTop: "1px solid rgba(128,128,128,.25)", margin: "6px 0" }} />
      <div
        style={{
          padding: "4px 12px",
          fontSize: 11,
          opacity: 0.6,
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
        Playlists
      </div>
      {playlists.length === 0 && (
        <button className="menu-item" disabled style={{ opacity: 0.6 }}>
          No playlists yet — create one in Library
        </button>
      )}
      {playlists.map((p) => {
        const inPl = (song.playlistIds || []).includes(p.id);
        return (
          <button
            key={p.id}
            className="menu-item"
            onClick={() => toggleSongInPlaylist(song.id, p.id)}
          >
            <span style={{ width: 16, display: "inline-block" }}>
              {inPl ? "✓" : ""}
            </span>
            {p.name}
          </button>
        );
      })}
    </>
  );
}

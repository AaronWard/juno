import React, { useState } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { useJuno } from "../App";
import { Song, SongComment } from "../data/mockSongs";
import { fmtRelative } from "../lib/format";
import { newId } from "../lib/ids";

/** Local notes/comments for a song. Clicking 💬 now opens this modal to
 *  VIEW and add notes instead of silently incrementing a counter. Notes
 *  are persisted on the song record in the proxy DB. */
export function NotesModal({
  song,
  open,
  onClose,
}: {
  song: Song | null;
  open: boolean;
  onClose: () => void;
}) {
  const { patchSong } = useJuno();
  const [text, setText] = useState("");

  if (!song) return null;
  const comments: SongComment[] = song.comments ?? [];

  const add = () => {
    const t = text.trim();
    if (!t) return;
    const next = [
      ...comments,
      { id: newId("note"), at: new Date().toISOString(), text: t },
    ];
    patchSong(song.id, { comments: next, commentCount: next.length });
    setText("");
  };

  const remove = (id: string) => {
    const next = comments.filter((c) => c.id !== id);
    patchSong(song.id, { comments: next, commentCount: next.length });
  };

  return (
    <Modal
      title={`Notes — ${song.title}`}
      open={open}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="primary" disabled={!text.trim()} onClick={add}>
            Add note
          </Button>
        </>
      }
    >
      <div style={{ display: "grid", gap: 10 }}>
        {comments.length === 0 && (
          <p className="inline-hint">
            No notes yet. Notes stay on this machine, saved with the song in
            the local library database.
          </p>
        )}
        {comments.length > 0 && (
          <div style={{ display: "grid", gap: 8, maxHeight: 240, overflowY: "auto" }}>
            {comments.map((c) => (
              <div
                key={c.id}
                className="card"
                style={{ padding: "10px 12px", display: "flex", gap: 10, alignItems: "flex-start" }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ whiteSpace: "pre-wrap" }}>{c.text}</div>
                  <div className="inline-hint">{fmtRelative(c.at)}</div>
                </div>
                <Button variant="icon" label="Delete note" onClick={() => remove(c.id)}>
                  ✕
                </Button>
              </div>
            ))}
          </div>
        )}
        <div>
          <label className="field-label" htmlFor="note-text">New note</label>
          <textarea
            id="note-text"
            className="text-area"
            style={{ minHeight: 70 }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. bring the chorus up, drums too busy at 1:20"
          />
        </div>
      </div>
    </Modal>
  );
}

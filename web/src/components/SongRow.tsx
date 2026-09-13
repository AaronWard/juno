import React, { useState } from "react";
import { Song } from "../data/mockSongs";
import { useJuno } from "../App";
import { fmtDuration } from "../lib/format";
import { coverGradient } from "../lib/audio";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { SongOverflowMenu } from "./SongOverflowMenu";
import { NotesModal } from "./NotesModal";
import { presetLabel } from "../data/modelPresets";
import { useQuickDelete } from "../lib/useQuickDelete";

const TYPE_LABEL: Record<Song["type"], string> = {
  song: "Song",
  upload: "Upload",
  cover: "Cover",
  remix: "Remix",
  extended: "Extended",
  mashup: "Mashup",
  sample: "Sample",
  reversed: "Reversed",
  cropped: "Cropped",
  replacement: "Replacement",
};

/** Song row (DESIGN_DOC §13).
 *  - 💬 opens a real notes modal (view + add), no silent counter bump.
 *  - Dislike moves the song straight to Trash (restorable for 14 days). */
export function SongRow({
  song,
  queueIds,
  showPlayCount,
  selected,
  onSelect,
}: {
  song: Song;
  queueIds: string[];
  showPlayCount?: boolean;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const { currentSong, isPlaying, playSong, togglePlay, patchSong, trashSong, deleteForever, retrySong, midiItems, navigate } =
    useJuno();
  // Hold Shift to reveal one-click delete on every row.
  const quickDelete = useQuickDelete();
  // Latest MIDI transcription made from this song, if any.
  const midi = midiItems.find((m) => m.sourceSongId === song.id);
  const midiRunning = midi && ["queued", "starting", "running"].includes(midi.status);
  const [notesOpen, setNotesOpen] = useState(false);
  const isCurrent = currentSong?.id === song.id;
  const processing =
    song.generationStatus === "queued" || song.generationStatus === "running";
  const failed = song.generationStatus === "failed";
  const noteCount = song.comments?.length ?? song.commentCount;

  const rowClass = [
    "song-row",
    isCurrent && "playing",
    selected && "selected",
    song.trashed && "trashed",
  ]
    .filter(Boolean)
    .join(" ");

  const dislike = () => {
    if (song.disliked) {
      patchSong(song.id, { disliked: false });
      return;
    }
    // Disliked songs go straight to Trash (auto-deleted after 14 days).
    patchSong(song.id, { disliked: true, liked: false });
    trashSong(song.id);
  };

  return (
    <div className={rowClass} onClick={onSelect}>
      <button
        className="song-thumb"
        style={{ background: coverGradient(song.id) }}
        aria-label={isCurrent && isPlaying ? `Pause ${song.title}` : `Play ${song.title}`}
        disabled={processing}
        onClick={(e) => {
          e.stopPropagation();
          if (isCurrent) togglePlay();
          else playSong(song.id, queueIds);
        }}
      >
        {processing ? (
          <span className="spinner" aria-hidden="true" />
        ) : isCurrent && isPlaying ? (
          "⏸"
        ) : (
          "▶"
        )}
        <span className="duration-badge">{fmtDuration(song.durationSeconds)}</span>
      </button>

      <div className="song-body">
        <div className="song-title-row">
          <span className="song-title">{song.title}</span>
          <Badge tone="accent">{presetLabel(song.model)}</Badge>
          {song.type !== "song" && <Badge>{TYPE_LABEL[song.type]}</Badge>}
          {song.metadata.instrumental && <Badge>Instrumental</Badge>}
          {song.public && <Badge tone="success">Public</Badge>}
          {processing && <Badge tone="warning">Processing</Badge>}
          {failed && <Badge tone="danger">Failed</Badge>}
          {song.trashed && <Badge tone="danger">Trashed</Badge>}
        </div>
        <div className={`song-desc${failed ? " song-error" : ""}`}>
          {failed && song.generationError
            ? song.generationError
            : processing && song.generationStage
              ? `${song.generationStage}${song.generationProgress ? ` · ${Math.round(song.generationProgress * 100)}%` : ""}`
              : song.description || "No description"}
        </div>
        {processing && (
          <span className="progress-track row" aria-hidden="true">
            <span
              className={`progress-fill${song.generationProgress ? "" : " indeterminate"}`}
              style={{ width: `${Math.round((song.generationProgress || 0) * 100)}%` }}
            />
          </span>
        )}
        <div className="song-actions" onClick={(e) => e.stopPropagation()}>
          {showPlayCount && (
            <span style={{ marginRight: 6 }} title="Play count">
              ▶ {song.playCount}
            </span>
          )}
          <Button
            variant="icon"
            label="Like"
            active={song.liked}
            onClick={() => patchSong(song.id, { liked: !song.liked, disliked: false })}
          >
            {song.liked ? "♥" : "♡"}
          </Button>
          <Button
            variant="icon"
            label={song.disliked ? "Remove dislike" : "Dislike (moves to Trash)"}
            active={song.disliked}
            onClick={dislike}
          >
            👎
          </Button>
          <Button
            variant="icon"
            label="Notes"
            onClick={() => setNotesOpen(true)}
          >
            💬{noteCount > 0 ? ` ${noteCount}` : ""}
          </Button>
          <Button
            variant="icon"
            label="Share (toggle public)"
            active={song.public}
            onClick={() => patchSong(song.id, { public: !song.public })}
          >
            ↗
          </Button>
          {failed && (
            <Button
              variant="ghost"
              label="Resubmit this generation with the same settings"
              onClick={() => retrySong(song.id)}
            >
              Retry
            </Button>
          )}
          {midi && (
            <button
              className={`midi-link${midiRunning ? " running" : ""}${midi.status === "failed" ? " failed" : ""}`}
              onClick={() => navigate(`/midi/${midi.id}`)}
              title={midi.status === "failed" ? `MIDI extraction failed: ${midi.error}` : "Open the MIDI transcription"}
            >
              🎹 {midiRunning ? `MIDI ${Math.round(midi.progress * 100)}%` : midi.status === "failed" ? "MIDI failed" : "MIDI"}
            </button>
          )}
        </div>
      </div>

      <div className="song-row-right" onClick={(e) => e.stopPropagation()}>
        {quickDelete && (
          <Button
            variant="icon"
            label={song.trashed ? `Delete "${song.title}" forever` : `Move "${song.title}" to Trash`}
            title={
              song.trashed
                ? "Delete forever (Shift held)"
                : "Move to Trash (Shift held) — recoverable for 14 days"
            }
            onClick={(e) => {
              e.stopPropagation();
              // From the Library this is a trash (recoverable). From Trash it is
              // the real delete. A one-keystroke action should not be able to
              // destroy anything that is not already in the bin.
              if (song.trashed) deleteForever(song.id);
              else trashSong(song.id);
            }}
          >
            {song.trashed ? "🗑" : "🗄"}
          </Button>
        )}
        <SongOverflowMenu song={song} />
      </div>

      <NotesModal song={song} open={notesOpen} onClose={() => setNotesOpen(false)} />
    </div>
  );
}

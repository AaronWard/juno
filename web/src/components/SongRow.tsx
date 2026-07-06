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
  const { currentSong, isPlaying, playSong, togglePlay, patchSong, trashSong } = useJuno();
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
        <div className="song-desc">
          {failed && song.generationError
            ? song.generationError
            : song.description || "No description"}
        </div>
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
            <Button variant="ghost" label="Retry" onClick={() => patchSong(song.id, { generationStatus: "queued" })}>
              Retry
            </Button>
          )}
        </div>
      </div>

      <div className="song-row-right" onClick={(e) => e.stopPropagation()}>
        <SongOverflowMenu song={song} />
      </div>

      <NotesModal song={song} open={notesOpen} onClose={() => setNotesOpen(false)} />
    </div>
  );
}

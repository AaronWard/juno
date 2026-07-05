/** Persistent bottom audio player (DESIGN_DOC §4).
 *
 *  Real playback: when the current song has a browser-playable audioUrl
 *  (uploads under /upload-audio, generated files under /library-audio) a
 *  hidden <audio> element drives the timeline.
 *  Mock playback: for mock rows without audio, a timer advances a simulated
 *  position so every player state is previewable offline.
 */
import React, { useEffect, useRef, useState } from "react";
import { useJuno } from "../App";
import { fmtDuration } from "../lib/format";
import { coverGradient } from "../lib/audio";
import { Button } from "./Button";
import { QueueDrawer } from "./QueueDrawer";
import { Modal } from "./Modal";
import { Dropdown } from "./Dropdown";
import { Slider } from "./Slider";
import { Badge } from "./Badge";
import { presetLabel } from "../data/modelPresets";

export function BottomPlayer() {
  const {
    currentSong,
    isPlaying,
    togglePlay,
    playNext,
    playPrev,
    shuffle,
    setShuffle,
    repeat,
    setRepeat,
    volume,
    setVolume,
    muted,
    setMuted,
    patchSong,
    navigate,
  } = useJuno();

  const audioRef = useRef<HTMLAudioElement>(null);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [seeking, setSeeking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [comment, setComment] = useState("");

  const hasRealAudio = !!currentSong?.audioUrl;

  /* real playback wiring */
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    setError(null);
    setPos(0);
    if (!currentSong || !hasRealAudio) {
      el.removeAttribute("src");
      setDur(currentSong?.durationSeconds || 0);
      return;
    }
    setLoading(true);
    el.src = currentSong.audioUrl!;
    el.load();
  }, [currentSong?.id, currentSong?.audioUrl]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !hasRealAudio) return;
    if (isPlaying) {
      el.play().catch(() => setError("Browser could not play this audio file."));
    } else {
      el.pause();
    }
  }, [isPlaying, hasRealAudio, currentSong?.id]);

  useEffect(() => {
    const el = audioRef.current;
    if (el) el.volume = muted ? 0 : volume;
  }, [volume, muted]);

  /* mock playback clock */
  useEffect(() => {
    if (!currentSong || hasRealAudio || !isPlaying) return;
    setDur(currentSong.durationSeconds);
    const t = setInterval(() => {
      setPos((p) => {
        if (p + 1 >= currentSong.durationSeconds) {
          if (repeat === "one") return 0;
          playNext();
          return 0;
        }
        return p + 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [currentSong?.id, hasRealAudio, isPlaying, repeat, playNext]);

  const seekTo = (v: number) => {
    setPos(v);
    if (audioRef.current && hasRealAudio) audioRef.current.currentTime = v;
  };

  const empty = !currentSong;
  const repeatLabel = repeat === "none" ? "⟳" : repeat === "one" ? "⟳¹" : "⟳∞";

  return (
    <footer className="bottom-player" aria-label="Audio player">
      <audio
        ref={audioRef}
        onTimeUpdate={(e) => !seeking && setPos(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          setDur(e.currentTarget.duration);
          setLoading(false);
        }}
        onWaiting={() => setLoading(true)}
        onCanPlay={() => setLoading(false)}
        onEnded={() => (repeat === "one" ? seekTo(0) : playNext())}
        onError={() => {
          if (hasRealAudio) {
            setError("Error loading audio — the file may be missing or unsupported.");
            setLoading(false);
          }
        }}
      />

      <div className="player-track">
        <div
          className="player-cover"
          style={currentSong ? { background: coverGradient(currentSong.id) } : undefined}
          aria-hidden="true"
        >
          {!currentSong && "♪"}
        </div>
        <div style={{ minWidth: 0 }}>
          {empty ? (
            <>
              <div className="player-title">No song selected</div>
              <div className="player-subtitle">Choose a song from Create or Library</div>
            </>
          ) : (
            <>
              <div className="player-title">{currentSong.title}</div>
              <div className="player-subtitle">
                {currentSong.type === "upload" ? "Local upload" : presetLabel(currentSong.model)}
                {loading && " · loading…"}
              </div>
              {error && <div className="player-error">{error}</div>}
            </>
          )}
        </div>
      </div>

      <div className="player-center">
        <div className="player-transport">
          <Button
            variant="icon"
            label="Shuffle"
            active={shuffle}
            disabled={empty}
            onClick={() => setShuffle(!shuffle)}
          >
            ⤨
          </Button>
          <Button variant="icon" label="Previous" disabled={empty} onClick={playPrev}>
            ⏮
          </Button>
          <Button
            variant="icon"
            label={isPlaying ? "Pause" : "Play"}
            disabled={empty}
            onClick={togglePlay}
            style={{ fontSize: 16 }}
          >
            {isPlaying ? "⏸" : "▶"}
          </Button>
          <Button variant="icon" label="Next" disabled={empty} onClick={playNext}>
            ⏭
          </Button>
          <Button
            variant="icon"
            label={`Repeat: ${repeat}`}
            active={repeat !== "none"}
            disabled={empty}
            onClick={() =>
              setRepeat(repeat === "none" ? "all" : repeat === "all" ? "one" : "none")
            }
          >
            {repeatLabel}
          </Button>
        </div>
        <div className="player-timeline-row">
          <span className="player-time">{fmtDuration(pos)}</span>
          <input
            className="player-timeline"
            type="range"
            min={0}
            max={Math.max(dur, 1)}
            value={Math.min(pos, dur)}
            disabled={empty}
            aria-label="Seek"
            onMouseDown={() => setSeeking(true)}
            onMouseUp={() => setSeeking(false)}
            onChange={(e) => seekTo(Number(e.target.value))}
          />
          <span className="player-time">{fmtDuration(dur)}</span>
        </div>
      </div>

      <div className="player-actions">
        <Button variant="icon" label="Queue" disabled={empty} onClick={() => setQueueOpen(!queueOpen)}>
          ☰
        </Button>
        <Button
          variant="icon"
          label="Like"
          disabled={empty}
          active={currentSong?.liked}
          onClick={() =>
            currentSong &&
            patchSong(currentSong.id, { liked: !currentSong.liked, disliked: false })
          }
        >
          {currentSong?.liked ? "♥" : "♡"}
        </Button>
        <Button
          variant="icon"
          label="Dislike"
          disabled={empty}
          active={currentSong?.disliked}
          onClick={() =>
            currentSong &&
            patchSong(currentSong.id, { disliked: !currentSong.disliked, liked: false })
          }
        >
          👎
        </Button>
        <Button variant="icon" label="Comment" disabled={empty} onClick={() => setCommentOpen(true)}>
          💬
        </Button>
        <Button variant="icon" label="Share / export" disabled={empty} onClick={() => setShareOpen(true)}>
          ↗
        </Button>
        <Dropdown
          triggerClass="btn btn-icon"
          ariaLabel="More actions for current track"
          trigger={<>⋯</>}
          items={
            currentSong
              ? [
                  {
                    id: "editor",
                    label: "Open in Editor",
                    onSelect: () => navigate(`/editor/${currentSong.id}`),
                  },
                  {
                    id: "studio",
                    label: "Open in Studio",
                    onSelect: () => navigate("/studio"),
                  },
                ]
              : []
          }
        />
        <Dropdown
          triggerClass="btn btn-icon"
          ariaLabel="Volume"
          trigger={<>{muted ? "🔇" : "🔊"}</>}
        >
          <div style={{ padding: "8px 10px", width: 220 }}>
            <Slider
              label="Volume"
              value={Math.round(volume * 100)}
              onChange={(v) => {
                setVolume(v / 100);
                if (v > 0) setMuted(false);
              }}
            />
            <button className="menu-item" onClick={() => setMuted(!muted)}>
              {muted ? "Unmute" : "Mute"}
            </button>
          </div>
        </Dropdown>
        <Button variant="icon" label="Track info" disabled={empty} onClick={() => setInfoOpen(true)}>
          ⓘ
        </Button>
      </div>

      {queueOpen && <QueueDrawer onClose={() => setQueueOpen(false)} />}

      <Modal title="Track info" open={infoOpen && !!currentSong} onClose={() => setInfoOpen(false)}>
        {currentSong && (
          <div style={{ display: "grid", gap: 8 }}>
            <div>
              <Badge tone="accent">{presetLabel(currentSong.model)}</Badge>{" "}
              <Badge>{currentSong.type}</Badge>{" "}
              {currentSong.metadata.instrumental && <Badge>Instrumental</Badge>}
            </div>
            <p style={{ margin: 0 }}>{currentSong.description || "No description."}</p>
            <p className="inline-hint" style={{ margin: 0 }}>
              Styles: {currentSong.styles.join(", ") || "—"} · Weirdness{" "}
              {currentSong.metadata.weirdness}% · Style influence{" "}
              {currentSong.metadata.styleInfluence}%
            </p>
            {currentSong.lyrics && (
              <pre
                className="inline-hint"
                style={{ whiteSpace: "pre-wrap", maxHeight: 180, overflow: "auto" }}
              >
                {currentSong.lyrics}
              </pre>
            )}
          </div>
        )}
      </Modal>

      <Modal
        title="Notes / comments"
        open={commentOpen && !!currentSong}
        onClose={() => setCommentOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCommentOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!comment.trim()}
              onClick={() => {
                if (currentSong) {
                  patchSong(currentSong.id, {
                    commentCount: currentSong.commentCount + 1,
                  });
                }
                setComment("");
                setCommentOpen(false);
              }}
            >
              Save note
            </Button>
          </>
        }
      >
        <label className="field-label" htmlFor="player-note">Local note</label>
        <textarea
          id="player-note"
          className="text-area"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Notes stay on this machine."
        />
      </Modal>

      <Modal
        title="Share / export"
        open={shareOpen && !!currentSong}
        onClose={() => setShareOpen(false)}
      >
        <p className="inline-hint">
          Juno is offline: sharing means exporting locally. Use the export
          action in a song's overflow menu to write a JSON manifest (and audio
          file references) into ./outputs/exports on the host.
        </p>
      </Modal>
    </footer>
  );
}

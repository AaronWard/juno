/** Right-hand song detail panel.
 *
 *  Slides in from the right edge rather than opening a centred modal: a modal
 *  blocks the list behind it, so you can't click through several songs and
 *  compare them, which is the whole point of a details view.
 */
import React from "react";
import { useJuno } from "../App";
import { Song } from "../data/mockSongs";
import { Icon } from "./Icon";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { fmtDuration, fmtRelative } from "../lib/format";
import { presetLabel } from "../data/modelPresets";
import { lineagePath, OPERATION_LABEL } from "../lib/lineage";

function Field({ label, value }: { label: string; value?: React.ReactNode }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="info-field">
      <span className="info-label">{label}</span>
      <div className="info-value">{value}</div>
    </div>
  );
}

export function SongInfoPanel({ song, onClose }: { song: Song | null; onClose: () => void }) {
  const { songs, navigate, playSong } = useJuno();
  const open = !!song;

  // Rendered even when closed so the slide transition has something to animate.
  return (
    <>
      <div className={`info-scrim${open ? " open" : ""}`} onClick={onClose} aria-hidden={!open} />
      <aside
        className={`info-panel${open ? " open" : ""}`}
        role="complementary"
        aria-label="Song details"
        aria-hidden={!open}
      >
        {song && (
          <>
            <header className="info-header">
              <h3 title={song.title}>{song.title}</h3>
              <Button variant="icon" label="Close details" onClick={onClose}>
                ✕
              </Button>
            </header>

            <div className="info-body">
              <div className="info-badges">
                <Badge>{presetLabel(song.model)}</Badge>
                {song.operation && song.operation !== "generate" && (
                  <Badge>{OPERATION_LABEL[song.operation]}</Badge>
                )}
                {song.metadata?.instrumental && <Badge>Instrumental</Badge>}
                {song.public && <Badge>Public</Badge>}
              </div>

              <Field label="Prompt" value={song.description && <p className="info-prose">{song.description}</p>} />
              <Field
                label="Lyrics"
                value={song.lyrics && <pre className="info-prose info-pre">{song.lyrics}</pre>}
              />
              <Field label="Styles" value={song.styles?.length ? song.styles.join(", ") : undefined} />
              <Field label="Length" value={song.durationSeconds ? fmtDuration(song.durationSeconds) : "—"} />
              <Field label="Created" value={fmtRelative(song.createdAt)} />
              <Field label="Seed" value={song.metadata?.seed ?? undefined} />
              <Field label="Plays" value={song.playCount || 0} />

              {/* "What did this come from, and how did I get here?" */}
              <Field
                label="Lineage"
                value={
                  <ol className="info-lineage">
                    {lineagePath(song, songs).map((s, i, arr) => (
                      <li key={s.id} className={s.id === song.id ? "current" : ""}>
                        <button
                          className="info-link"
                          onClick={() => {
                            if (s.id !== song.id) playSong(s.id, [s.id]);
                          }}
                        >
                          {s.title}
                        </button>
                        {i < arr.length - 1 && <Icon name="chevron-down" size={12} />}
                      </li>
                    ))}
                  </ol>
                }
              />

              <Field
                label="Derived from this"
                value={(() => {
                  const kids = songs.filter((s) => s.parentId === song.id && !s.trashed);
                  if (!kids.length) return undefined;
                  return (
                    <ul className="info-children">
                      {kids.map((k) => (
                        <li key={k.id}>
                          <button className="info-link" onClick={() => playSong(k.id, [k.id])}>
                            {k.title}
                          </button>
                          {k.operation && <Badge>{OPERATION_LABEL[k.operation]}</Badge>}
                        </li>
                      ))}
                    </ul>
                  );
                })()}
              />
            </div>

            <footer className="info-footer">
              <Button onClick={() => navigate(`/editor/${song.id}`)}>Open in Editor</Button>
              <Button variant="ghost" onClick={() => navigate(`/studio?song=${song.id}`)}>
                Studio
              </Button>
            </footer>
          </>
        )}
      </aside>
    </>
  );
}

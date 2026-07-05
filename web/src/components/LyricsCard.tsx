import React, { useState } from "react";
import { Button } from "./Button";
import { Modal } from "./Modal";
import { Dropdown } from "./Dropdown";

const STRUCTURE_TAGS = [
  "[Intro]", "[Verse]", "[Pre-Chorus]", "[Chorus]", "[Bridge]",
  "[Breakdown]", "[Outro]", "[Instrumental]", "[Drop]", "[Solo]",
];

const WRITE_PLACEHOLDER = `[Verse]
This is where you write your rhymes
or give Juno a try

[Chorus]
Songs feel more structured
with sections like these`;

export type LyricsMode = "write" | "prompt" | "instrumental";

interface Props {
  mode: LyricsMode;
  onMode: (m: LyricsMode) => void;
  lyrics: string;
  onLyrics: (v: string) => void;
}

/** Lyrics card (DESIGN_DOC §7): Write / Prompt / Instrumental tabs, section
 *  helper, local magic wand, full-screen editor. Lyrics text is passed to
 *  ACE-Step as `lyrics`; Instrumental sends empty lyrics. */
export function LyricsCard({ mode, onMode, lyrics, onLyrics }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [expanded, setExpanded] = useState(false);

  /** Local placeholder lyric generation from templates — no remote service. */
  const generateFromPrompt = () => {
    const theme = prompt.trim() || "keeping faith through uncertainty";
    const generated = `[Verse]\nIn the quiet of ${theme}\nI trace the shape of what remains\n\n[Chorus]\nHold the line, hold the light\n${capitalize(theme)} carries us tonight\n\n[Bridge]\nEven static turns to song\nWhen we hum it all along`;
    onLyrics(generated);
    onMode("write");
  };

  /** Local "improve" pass — appends a bridge if missing. */
  const improve = () => {
    if (!lyrics.trim()) {
      generateFromPrompt();
      return;
    }
    if (!lyrics.includes("[Bridge]")) {
      onLyrics(lyrics + "\n\n[Bridge]\nSay it once more, slower now\nLet the room remember how");
    }
  };

  return (
    <div className="card">
      <button
        className="card-header"
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
      >
        <span>{collapsed ? "›" : "∨"} Lyrics</span>
      </button>
      {!collapsed && (
        <div style={{ marginTop: 10 }}>
          <div className="segmented" role="tablist" aria-label="Lyrics mode">
            {(["write", "prompt", "instrumental"] as LyricsMode[]).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                className={mode === m ? "active" : ""}
                onClick={() => onMode(m)}
              >
                {m === "write" ? "Write" : m === "prompt" ? "Prompt" : "Instrumental"}
              </button>
            ))}
          </div>

          {mode === "write" && (
            <>
              <textarea
                className="text-area"
                style={{ marginTop: 10, minHeight: 160 }}
                placeholder={WRITE_PLACEHOLDER}
                value={lyrics}
                onChange={(e) => onLyrics(e.target.value)}
                aria-label="Lyrics"
              />
              <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                <Dropdown
                  align="left"
                  triggerClass="btn btn-icon"
                  ariaLabel="Insert section tag"
                  trigger={<>¶</>}
                  items={STRUCTURE_TAGS.map((t) => ({
                    id: t,
                    label: t,
                    onSelect: () => onLyrics(lyrics ? `${lyrics}\n\n${t}\n` : `${t}\n`),
                  }))}
                />
                <Button variant="icon" label="Improve lyrics locally" onClick={improve}>✨</Button>
                <Button variant="icon" label="Expand lyric editor" onClick={() => setExpanded(true)}>⤢</Button>
              </div>
            </>
          )}

          {mode === "prompt" && (
            <>
              <textarea
                className="text-area"
                style={{ marginTop: 10 }}
                placeholder="Describe the lyrics you want..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                aria-label="Lyrics prompt"
              />
              <Button style={{ marginTop: 6 }} onClick={generateFromPrompt}>
                ✨ Generate placeholder lyrics
              </Button>
              <p className="inline-hint">
                Local template generation — fills the Write tab and preserves
                your edits.
              </p>
            </>
          )}

          {mode === "instrumental" && (
            <p className="inline-hint" style={{ marginTop: 10 }}>
              Instrumental mode: no lyrics are sent. The generated song is
              flagged Instrumental and lyric metadata is hidden.
            </p>
          )}
        </div>
      )}

      <Modal
        title="Lyric editor"
        open={expanded}
        onClose={() => setExpanded(false)}
      >
        <textarea
          className="text-area"
          style={{ minHeight: "50vh" }}
          value={lyrics}
          onChange={(e) => onLyrics(e.target.value)}
          aria-label="Full-screen lyrics"
        />
      </Modal>
    </div>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

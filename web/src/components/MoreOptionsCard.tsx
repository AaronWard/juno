import React, { useState } from "react";
import { Slider } from "./Slider";

interface Props {
  vocalGender: "male" | "female" | "none";
  onVocalGender: (v: "male" | "female" | "none") => void;
  weirdness: number;
  onWeirdness: (v: number) => void;
  styleInfluence: number;
  onStyleInfluence: (v: number) => void;
  exclude: string;
  onExclude: (v: string) => void;
  cfgDisabled: boolean;
  /** Approximate song length in seconds, or null for Auto (the model picks). */
  duration: number | null;
  onDuration: (v: number | null) => void;
  /** Covers/repaints run at the source's length — the control is locked then. */
  durationLocked?: boolean;
  durationLockedNote?: string;
}

/** More Options card (DESIGN_DOC §9): Vocal Gender, Weirdness, Style
 *  Influence and the optional Exclude field.
 *  - Weirdness: local metadata + seed variation (no direct ACE-Step field).
 *  - Style Influence: mapped to CFG/guidance where supported; disabled for
 *    Juno XL Fast (Turbo is the no-CFG path). */
export function MoreOptionsCard({
  vocalGender,
  onVocalGender,
  weirdness,
  onWeirdness,
  styleInfluence,
  onStyleInfluence,
  exclude,
  onExclude,
  cfgDisabled,
  duration,
  onDuration,
  durationLocked = false,
  durationLockedNote,
}: Props) {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div className="card">
      <button className="card-header" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>
        <span>{collapsed ? "›" : "∨"} More Options</span>
      </button>
      {!collapsed && (
        <div style={{ marginTop: 12, display: "grid", gap: 14 }}>
          <div className="slider-row" style={{ gridTemplateColumns: "110px 1fr" }}>
            <span className="field-label" style={{ marginBottom: 0 }}>Vocal Gender</span>
            <div className="segmented" role="radiogroup" aria-label="Vocal gender">
              {(["male", "female"] as const).map((g) => (
                <button
                  key={g}
                  role="radio"
                  aria-checked={vocalGender === g}
                  className={vocalGender === g ? "active" : ""}
                  onClick={() => onVocalGender(vocalGender === g ? "none" : g)}
                >
                  {g === "male" ? "Male" : "Female"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="slider-row" style={{ gridTemplateColumns: "110px 1fr", alignItems: "center" }}>
              <span className="field-label" style={{ marginBottom: 0 }}>Length</span>
              <div className="segmented" role="radiogroup" aria-label="Song length mode">
                <button
                  role="radio"
                  aria-checked={duration === null}
                  className={duration === null ? "active" : ""}
                  disabled={durationLocked}
                  onClick={() => onDuration(null)}
                >
                  Auto
                </button>
                <button
                  role="radio"
                  aria-checked={duration !== null}
                  className={duration !== null ? "active" : ""}
                  disabled={durationLocked}
                  onClick={() => onDuration(duration ?? 120)}
                >
                  Set
                </button>
              </div>
            </div>
            {duration !== null && !durationLocked && (
              <div style={{ marginTop: 10 }}>
                <Slider
                  label="Approx. length"
                  value={duration}
                  min={20}
                  max={360}
                  step={5}
                  onChange={onDuration}
                  formatValue={(v) => `${Math.floor(v / 60)}:${String(Math.round(v) % 60).padStart(2, "0")}`}
                />
              </div>
            )}
            <p className="inline-hint" style={{ marginTop: 6 }}>
              {durationLocked
                ? durationLockedNote
                : duration === null
                  ? "Auto lets the 5Hz LM choose a length that fits your prompt and lyrics — best when a long prompt was being crammed into a fixed 2:00."
                  : "ACE-Step treats this as a target, not an exact cut. Supported range is roughly 10 s – 10 min."}
            </p>
          </div>

          <Slider label="Weirdness" value={weirdness} onChange={onWeirdness} />
          <Slider
            label="Style Influence"
            value={styleInfluence}
            onChange={onStyleInfluence}
            disabled={cfgDisabled}
          />
          {cfgDisabled && (
            <p className="inline-hint" style={{ marginTop: -8 }}>
              Juno XL Fast uses the Turbo no-CFG path — Style Influence is
              stored as metadata only.
            </p>
          )}

          <div>
            <label className="field-label" htmlFor="exclude">Exclude</label>
            <input
              id="exclude"
              className="text-input"
              placeholder="Things to avoid: instruments, genres, moods, words..."
              value={exclude}
              onChange={(e) => onExclude(e.target.value)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

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

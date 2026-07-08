import React, { useState } from "react";
import { Button } from "./Button";
import { Dropdown } from "./Dropdown";
import { SavedStylesMenu } from "./SavedStylesMenu";
import { useJuno } from "../App";

const SUGGESTIONS = [
  "slow ambient", "melancholic", "ethereal pad", "dynamic instrumentation",
  "urban", "discordant", "dream pop", "cinematic", "lo-fi", "italian pop",
];

interface Props {
  chips: string[];
  onChips: (chips: string[]) => void;
}

/** Styles card (DESIGN_DOC §8): comma-to-chip parsing, removable chips,
 *  saved style library, local magic wand and randomizer. Chips are joined
 *  into the ACE-Step `prompt` and stored in local metadata for filtering. */
export function StylesCard({ chips, onChips }: Props) {
  const { stylePresets } = useJuno();
  const [collapsed, setCollapsed] = useState(false);
  const [input, setInput] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const commit = (raw: string) => {
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    const next = [...chips];
    for (const p of parts) if (!next.includes(p)) next.push(p);
    onChips(next);
  };

  const onInput = (v: string) => {
    if (v.includes(",")) {
      commit(v);
      setInput("");
    } else {
      setInput(v);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit(input);
      setInput("");
    }
    if (e.key === "Backspace" && input === "" && chips.length) {
      onChips(chips.slice(0, -1));
    }
  };

  const randomize = () => {
    const pool = SUGGESTIONS.filter((s) => !chips.includes(s));
    const pick = pool.sort(() => Math.random() - 0.5).slice(0, 3);
    onChips([...chips, ...pick]);
  };

  const expand = () => {
    // Local "magic wand": enrich short style lists with complementary terms.
    const extras = ["dynamic instrumentation", "wide stereo field", "tape saturation"];
    onChips([...chips, ...extras.filter((e) => !chips.includes(e))]);
  };

  return (
    <div className="card">
      <button className="card-header" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>
        <span>{collapsed ? "›" : "∨"} Styles</span>
      </button>
      {!collapsed && (
        <div style={{ marginTop: 10 }}>
          <textarea
            className="text-area"
            style={{ minHeight: 64 }}
            placeholder="slow ambient, discordant, italian pop, dynamic instrumentation, urban"
            value={input}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Style descriptors (comma separated)"
          />
          <div style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 6 }}>
            <SavedStylesMenu chips={chips} onChips={onChips} />
            <Button variant="icon" label="Expand styles locally" onClick={expand}>✨</Button>
            <Button variant="icon" label="Suggest random styles" onClick={randomize}>↻</Button>
            <div className="chip-row" style={{ flex: 1 }}>
              {chips.map((c) => (
                <span
                  key={c}
                  className={`chip${selected === c ? " selected" : ""}`}
                  onClick={() => setSelected(selected === c ? null : c)}
                >
                  {c}
                  <button
                    className="chip-x"
                    aria-label={`Remove style ${c}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onChips(chips.filter((x) => x !== c));
                    }}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

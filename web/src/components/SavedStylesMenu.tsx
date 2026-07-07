/** Working 🗂 saved-styles menu for StylesCard. Replaces the previously
 *  dead button: lists saved presets (click to merge into the current
 *  chips) and lets you save the current chips as a new named preset.
 *  Self-contained popover with inline styles so it works regardless of
 *  the dropdown CSS in use.
 *
 *  Usage in StylesCard: <SavedStylesMenu chips={chips} onChips={onChips} />
 */
import React, { useEffect, useRef, useState } from "react";
import { useJuno } from "../App";

export function SavedStylesMenu({
  chips,
  onChips,
}: {
  chips: string[];
  onChips: (chips: string[]) => void;
}) {
  const { stylePresets, addStylePreset } = useJuno();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSaving(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const apply = (styles: string[]) => {
    onChips([...new Set([...chips, ...styles])]);
    setOpen(false);
  };

  const save = async () => {
    const n = name.trim();
    if (!n || !chips.length || busy) return;
    setBusy(true);
    try {
      await addStylePreset(n, chips);
      setName("");
      setSaving(false);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const item: React.CSSProperties = {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "7px 12px",
    background: "none",
    border: "none",
    color: "inherit",
    cursor: "pointer",
    fontSize: 13,
  };

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        className="btn icon-btn"
        title="Saved style presets"
        onClick={() => setOpen((o) => !o)}
      >
        🗂
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "110%",
            zIndex: 50,
            minWidth: 230,
            background: "var(--color-bg-panel, #1c1c22)",
            border: "1px solid rgba(128,128,128,.35)",
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,.4)",
            padding: "6px 0",
          }}
        >
          {stylePresets.length === 0 && (
            <div style={{ ...item, cursor: "default", opacity: 0.6 }}>
              No saved style presets yet
            </div>
          )}
          {stylePresets.map((p) => (
            <button key={p.id} style={item} onClick={() => apply(p.styles)}>
              {p.name} <span style={{ opacity: 0.5 }}>({p.styles.length})</span>
            </button>
          ))}
          <div
            style={{
              borderTop: "1px solid rgba(128,128,128,.25)",
              margin: "6px 0",
            }}
          />
          {!saving ? (
            <button
              style={{ ...item, opacity: chips.length ? 1 : 0.5 }}
              disabled={!chips.length}
              onClick={() => setSaving(true)}
            >
              💾 Save current styles…
            </button>
          ) : (
            <div style={{ padding: "4px 12px", display: "flex", gap: 6 }}>
              <input
                autoFocus
                value={name}
                placeholder="Preset name"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && save()}
                style={{
                  flex: 1,
                  padding: "4px 8px",
                  borderRadius: 6,
                  border: "1px solid rgba(128,128,128,.4)",
                  background: "transparent",
                  color: "inherit",
                  fontSize: 13,
                }}
              />
              <button className="btn" disabled={!name.trim() || busy} onClick={save}>
                Save
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import React from "react";

export const LIBRARY_TABS = [
  "Songs",
  "Playlists",
  "Workspaces",
  "Studio Projects",
  "Voices",
  "Lyrics",
  "Styles",
  "Cover Art",
  "Hooks",
  "Liked Hooks",
  "History",
] as const;

export type LibraryTab = (typeof LIBRARY_TABS)[number];

/** Library tab row (DESIGN_DOC §16). */
export function LibraryTabs({
  active,
  onChange,
}: {
  active: LibraryTab;
  onChange: (t: LibraryTab) => void;
}) {
  return (
    <div className="tab-row" role="tablist" aria-label="Library sections">
      {LIBRARY_TABS.map((tab) => (
        <button
          key={tab}
          role="tab"
          aria-selected={active === tab}
          className={`tab${active === tab ? " active" : ""}`}
          onClick={() => onChange(tab)}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

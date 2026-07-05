/** Library page (DESIGN_DOC §15–17): 11 tabs, per-tab toolbars, +Audio
 *  upload, and a Trash entry point. */
import React, { useMemo, useState } from "react";
import { useJuno } from "../App";
import { LibraryTabs, LibraryTab } from "../components/LibraryTabs";
import { Toolbar } from "../components/Toolbar";
import { SongRow } from "../components/SongRow";
import { UploadModal } from "../components/UploadModal";
import { Button } from "../components/Button";
import { Badge } from "../components/Badge";
import { coverGradient } from "../lib/audio";
import { fmtDuration, fmtRelative } from "../lib/format";

const SONG_SORTS = ["Newest First", "Oldest First", "Title A–Z", "Most Played"];
const NAME_SORTS = ["Newest First", "Oldest First", "Name A–Z"];

export function LibraryPage() {
  const {
    songs,
    playlists,
    workspaces,
    projects,
    voices,
    lyricDocs,
    stylePresets,
    coverArt,
    hooks,
    history,
    navigate,
    setPrefill,
    setActiveWorkspaceId,
  } = useJuno();

  const [tab, setTab] = useState<LibraryTab>("Songs");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<string[]>([]);
  const [sort, setSort] = useState(SONG_SORTS[0]);
  const [view, setView] = useState("List");
  const [page, setPage] = useState(1);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [likedStyles, setLikedStyles] = useState<Record<string, boolean>>({});
  const [likedHooks, setLikedHooks] = useState<Record<string, boolean>>(
    Object.fromEntries(hooks.map((h) => [h.id, h.liked]))
  );

  const toggleFilter = (id: string) =>
    setFilters((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));

  const q = search.trim().toLowerCase();
  const matches = (...fields: (string | undefined)[]) =>
    !q || fields.some((f) => f?.toLowerCase().includes(q));

  /* Songs tab */
  const songRows = useMemo(() => {
    let list = songs.filter((s) => !s.trashed);
    list = list.filter((s) =>
      matches(s.title, s.description, s.styles.join(" "))
    );
    if (filters.includes("liked")) list = list.filter((s) => s.liked);
    if (filters.includes("public")) list = list.filter((s) => s.public);
    if (filters.includes("uploads")) list = list.filter((s) => s.type === "upload");
    if (filters.includes("instrumental"))
      list = list.filter((s) => s.metadata.instrumental);
    if (filters.includes("covers")) list = list.filter((s) => s.type === "cover");
    return [...list].sort((a, b) => {
      switch (sort) {
        case "Oldest First":
          return a.createdAt.localeCompare(b.createdAt);
        case "Title A–Z":
          return a.title.localeCompare(b.title);
        case "Most Played":
          return b.playCount - a.playCount;
        default:
          return b.createdAt.localeCompare(a.createdAt);
      }
    });
  }, [songs, q, filters, sort]);

  const commonToolbar = (
    filterOptions: { id: string; label: string }[],
    sortOptions: string[],
    count: number
  ) => (
    <Toolbar
      search={search}
      onSearch={(v) => {
        setSearch(v);
        setPage(1);
      }}
      filterOptions={filterOptions}
      activeFilters={filters}
      onToggleFilter={toggleFilter}
      sortOptions={sortOptions}
      sort={sortOptions.includes(sort) ? sort : sortOptions[0]}
      onSort={setSort}
      viewOptions={tab === "Songs" ? ["List", "Compact"] : undefined}
      view={tab === "Songs" ? view : undefined}
      onView={tab === "Songs" ? setView : undefined}
      quickPills={
        tab === "Songs"
          ? [
              { id: "liked", label: "Liked" },
              { id: "public", label: "Public" },
              { id: "uploads", label: "Uploads" },
            ]
          : undefined
      }
      page={page}
      onPage={setPage}
      pageCount={Math.max(1, Math.ceil(count / 25))}
    />
  );

  const changeTab = (t: LibraryTab) => {
    setTab(t);
    setSearch("");
    setFilters([]);
    setPage(1);
  };

  return (
    <div className="page">
      <div className="page-title-row">
        <h1 className="page-title">Library</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <Button onClick={() => setUploadOpen(true)}>＋ Audio</Button>
          <Button variant="ghost" onClick={() => navigate("/trash")}>
            🗑 Trash
          </Button>
        </div>
      </div>

      <LibraryTabs active={tab} onChange={changeTab} />

      {tab === "Songs" && (
        <>
          {commonToolbar(
            [
              { id: "liked", label: "Liked" },
              { id: "public", label: "Public" },
              { id: "uploads", label: "Uploads" },
              { id: "instrumental", label: "Instrumental" },
              { id: "covers", label: "Covers" },
            ],
            SONG_SORTS,
            songRows.length
          )}
          <div className="song-list">
            {songRows.length === 0 && (
              <div className="empty-state">
                <h3>No songs match</h3>
                <p>Clear filters or create something new.</p>
              </div>
            )}
            {songRows.slice((page - 1) * 25, page * 25).map((s) => (
              <SongRow
                key={s.id}
                song={s}
                queueIds={songRows.map((x) => x.id)}
                showPlayCount
              />
            ))}
          </div>
        </>
      )}

      {tab === "Playlists" && (
        <>
          {commonToolbar([], NAME_SORTS, playlists.length)}
          <div className="card-grid">
            {playlists
              .filter((p) => matches(p.name))
              .map((p) => (
                <div key={p.id} className="asset-card">
                  <div
                    className="asset-thumb"
                    style={{ background: coverGradient(p.id) }}
                    aria-hidden="true"
                  />
                  <strong>{p.name}</strong>
                  <span className="inline-hint">{p.songIds.length} songs</span>
                  <Button
                    onClick={() => {
                      navigate("/create");
                    }}
                  >
                    Open
                  </Button>
                </div>
              ))}
          </div>
        </>
      )}

      {tab === "Workspaces" && (
        <>
          {commonToolbar([], NAME_SORTS, workspaces.length)}
          <div className="card-grid">
            {workspaces
              .filter((w) => matches(w.name))
              .map((w) => (
                <div key={w.id} className="asset-card">
                  <div
                    className="asset-thumb"
                    style={{ background: coverGradient(w.id) }}
                    aria-hidden="true"
                  />
                  <strong>{w.name}</strong>
                  <span className="inline-hint">
                    {songs.filter((s) => (s.workspaceId ?? "ws_my") === w.id && !s.trashed).length}{" "}
                    songs · updated {fmtRelative(w.updatedAt)}
                  </span>
                  <Button
                    onClick={() => {
                      setActiveWorkspaceId(w.id);
                      navigate("/create");
                    }}
                  >
                    Open workspace
                  </Button>
                </div>
              ))}
          </div>
        </>
      )}

      {tab === "Studio Projects" && (
        <>
          {commonToolbar([], NAME_SORTS, projects.length)}
          <div className="card-grid">
            {projects
              .filter((p) => matches(p.name))
              .map((p) => (
                <div key={p.id} className="asset-card">
                  <div
                    className="asset-thumb"
                    style={{ background: coverGradient(p.id) }}
                    aria-hidden="true"
                  />
                  <strong>{p.name}</strong>
                  <span className="inline-hint">
                    {p.trackCount} tracks · updated {fmtRelative(p.updatedAt)}
                  </span>
                  <Button onClick={() => navigate("/studio")}>Open in Studio</Button>
                </div>
              ))}
          </div>
        </>
      )}

      {tab === "Voices" && (
        <>
          {commonToolbar([], NAME_SORTS, voices.length)}
          <div className="card-grid">
            {voices
              .filter((v) => matches(v.name, v.description))
              .map((v) => (
                <div key={v.id} className="asset-card">
                  <div
                    className="asset-thumb"
                    style={{ background: coverGradient(v.id) }}
                    aria-hidden="true"
                  >
                    🎙
                  </div>
                  <strong>{v.name}</strong>
                  <span className="inline-hint">{v.description}</span>
                  {v.gender && v.gender !== "none" && <Badge>{v.gender}</Badge>}
                  <Button
                    onClick={() => {
                      setPrefill({ vocalGender: v.gender || "none" });
                      navigate("/create");
                    }}
                  >
                    Use in Create
                  </Button>
                </div>
              ))}
          </div>
        </>
      )}

      {tab === "Lyrics" && (
        <>
          {commonToolbar([], NAME_SORTS, lyricDocs.length)}
          <div className="card-grid">
            {lyricDocs
              .filter((d) => matches(d.title, d.text))
              .map((d) => (
                <div key={d.id} className="asset-card">
                  <strong>{d.title}</strong>
                  <pre className="inline-hint asset-lyrics">{d.text}</pre>
                  <Button
                    onClick={() => {
                      setPrefill({ lyrics: d.text, title: d.title });
                      navigate("/create");
                    }}
                  >
                    Use in Create
                  </Button>
                </div>
              ))}
          </div>
        </>
      )}

      {tab === "Styles" && (
        <>
          {commonToolbar([], NAME_SORTS, stylePresets.length)}
          <div className="card-grid">
            {stylePresets
              .filter((p) => matches(p.name, p.styles.join(" ")))
              .map((p) => {
                const liked = likedStyles[p.id] ?? p.liked;
                return (
                  <div key={p.id} className="asset-card">
                    <strong>{p.name}</strong>
                    <div className="chip-row">
                      {p.styles.map((s) => (
                        <span key={s} className="chip">{s}</span>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <Button
                        variant="icon"
                        label={liked ? "Unlike style" : "Like style"}
                        active={liked}
                        onClick={() =>
                          setLikedStyles({ ...likedStyles, [p.id]: !liked })
                        }
                      >
                        {liked ? "♥" : "♡"}
                      </Button>
                      <Button
                        onClick={() => {
                          setPrefill({ styles: p.styles });
                          navigate("/create");
                        }}
                      >
                        Use in Create
                      </Button>
                    </div>
                  </div>
                );
              })}
          </div>
        </>
      )}

      {tab === "Cover Art" && (
        <>
          {commonToolbar([], NAME_SORTS, coverArt.length)}
          <div className="card-grid">
            {coverArt
              .filter((c) => matches(c.title))
              .map((c) => (
                <div key={c.id} className="asset-card">
                  <div
                    className="asset-thumb tall"
                    style={{ background: coverGradient(c.id) }}
                    aria-hidden="true"
                  />
                  <strong>{c.title}</strong>
                  <span className="inline-hint">
                    Generated locally · {fmtRelative(c.createdAt)}
                  </span>
                </div>
              ))}
          </div>
        </>
      )}

      {(tab === "Hooks" || tab === "Liked Hooks") && (
        <>
          {commonToolbar([], NAME_SORTS, hooks.length)}
          <div className="card-grid">
            {hooks
              .filter((h) => matches(h.title))
              .filter((h) => (tab === "Liked Hooks" ? likedHooks[h.id] : true))
              .map((h) => (
                <div key={h.id} className="asset-card">
                  <div
                    className="asset-thumb"
                    style={{ background: coverGradient(h.id) }}
                    aria-hidden="true"
                  >
                    ♪
                  </div>
                  <strong>{h.title}</strong>
                  <span className="inline-hint">{fmtDuration(h.durationSeconds)} hook</span>
                  <Button
                    variant="icon"
                    label={likedHooks[h.id] ? "Unlike hook" : "Like hook"}
                    active={!!likedHooks[h.id]}
                    onClick={() =>
                      setLikedHooks({ ...likedHooks, [h.id]: !likedHooks[h.id] })
                    }
                  >
                    {likedHooks[h.id] ? "♥" : "♡"}
                  </Button>
                </div>
              ))}
            {tab === "Liked Hooks" &&
              hooks.filter((h) => likedHooks[h.id]).length === 0 && (
                <div className="empty-state">
                  <h3>No liked hooks yet</h3>
                  <p>Like a hook in the Hooks tab and it will appear here.</p>
                </div>
              )}
          </div>
        </>
      )}

      {tab === "History" && (
        <>
          {commonToolbar([], ["Newest First", "Oldest First"], history.length)}
          <div className="song-list">
            {history
              .filter((h) => matches(h.event))
              .sort((a, b) =>
                sort === "Oldest First"
                  ? a.at.localeCompare(b.at)
                  : b.at.localeCompare(a.at)
              )
              .map((h) => (
                <div key={h.id} className="song-row" style={{ cursor: "default" }}>
                  <div className="song-body">
                    <div className="song-title">{h.event}</div>
                    <div className="song-desc">{fmtRelative(h.at)}</div>
                  </div>
                </div>
              ))}
          </div>
        </>
      )}

      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </div>
  );
}

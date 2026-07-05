/** Create page (DESIGN_DOC §5): left create panel, right workspace results
 *  with breadcrumb, toolbar (search / filters / sort / view / quick pills /
 *  pagination ‹1›) and the song list of the active workspace. */
import React, { useMemo, useState } from "react";
import { useJuno } from "../App";
import { CreatePanel } from "../components/CreatePanel";
import { Toolbar } from "../components/Toolbar";
import { SongRow } from "../components/SongRow";
import { Dropdown } from "../components/Dropdown";

const SORTS = ["Newest First", "Oldest First", "Title A–Z", "Most Played"];
const PAGE_SIZE = 25;

export function CreatePage() {
  const { songs, workspaces, activeWorkspaceId, setActiveWorkspaceId, health } =
    useJuno();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<string[]>([]);
  const [sort, setSort] = useState(SORTS[0]);
  const [view, setView] = useState("List");
  const [page, setPage] = useState(1);

  const workspace = workspaces.find((w) => w.id === activeWorkspaceId);

  const toggleFilter = (id: string) =>
    setFilters((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));

  const rows = useMemo(() => {
    let list = songs.filter(
      (s) => !s.trashed && (s.workspaceId ?? "ws_my") === activeWorkspaceId
    );
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.styles.join(" ").toLowerCase().includes(q)
      );
    }
    if (filters.includes("liked")) list = list.filter((s) => s.liked);
    if (filters.includes("public")) list = list.filter((s) => s.public);
    if (filters.includes("uploads")) list = list.filter((s) => s.type === "upload");
    if (filters.includes("instrumental"))
      list = list.filter((s) => s.metadata.instrumental);
    if (filters.includes("covers")) list = list.filter((s) => s.type === "cover");
    if (filters.includes("processing"))
      list = list.filter(
        (s) => s.generationStatus === "queued" || s.generationStatus === "running"
      );

    list = [...list].sort((a, b) => {
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
    return list;
  }, [songs, activeWorkspaceId, search, filters, sort]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const queueIds = rows.map((s) => s.id);

  return (
    <div className="page create-layout">
      <CreatePanel />

      <section className="workspace-results" aria-label="Workspace results">
        <div className="breadcrumb">
          <span className="crumb-muted">Workspaces</span>
          <span aria-hidden="true">›</span>
          <Dropdown
            align="left"
            triggerClass="btn btn-ghost"
            ariaLabel="Switch workspace"
            trigger={<strong>{workspace?.name || "My Workspace"} ▾</strong>}
            items={workspaces.map((w) => ({
              id: w.id,
              label: w.name,
              selected: w.id === activeWorkspaceId,
              onSelect: () => {
                setActiveWorkspaceId(w.id);
                setPage(1);
              },
            }))}
          />
        </div>

        <Toolbar
          search={search}
          onSearch={(v) => {
            setSearch(v);
            setPage(1);
          }}
          filterOptions={[
            { id: "liked", label: "Liked" },
            { id: "public", label: "Public" },
            { id: "uploads", label: "Uploads" },
            { id: "instrumental", label: "Instrumental" },
            { id: "covers", label: "Covers" },
            { id: "processing", label: "Processing" },
          ]}
          activeFilters={filters}
          onToggleFilter={toggleFilter}
          sortOptions={SORTS}
          sort={sort}
          onSort={setSort}
          viewOptions={["List", "Compact"]}
          view={view}
          onView={setView}
          quickPills={[
            { id: "liked", label: "Liked" },
            { id: "public", label: "Public" },
            { id: "uploads", label: "Uploads" },
          ]}
          page={page}
          onPage={setPage}
          pageCount={pageCount}
        />

        {health?.aceStep !== "ok" && (
          <p className="inline-hint" role="status">
            ACE-Step backend is {health ? health.aceStep : "connecting…"} — mock
            songs remain playable and new generations will surface errors in
            their rows.
          </p>
        )}

        <div className={view === "Compact" ? "song-list compact" : "song-list"}>
          {pageRows.length === 0 && (
            <div className="empty-state">
              <h3>No songs here yet</h3>
              <p>Describe a song on the left and press Create.</p>
            </div>
          )}
          {pageRows.map((s) => (
            <SongRow key={s.id} song={s} queueIds={queueIds} />
          ))}
        </div>
      </section>
    </div>
  );
}

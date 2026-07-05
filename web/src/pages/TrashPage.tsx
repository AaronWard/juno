/** Trash page (DESIGN_DOC §19): search, type filter, sort, per-item
 *  Restore / Delete Forever, and Empty Trash with confirmation. */
import React, { useMemo, useState } from "react";
import { useJuno } from "../App";
import { Toolbar } from "../components/Toolbar";
import { Button } from "../components/Button";
import { Modal } from "../components/Modal";
import { Badge } from "../components/Badge";
import { coverGradient } from "../lib/audio";
import { fmtDuration, fmtRelative } from "../lib/format";

const SORTS = ["Newest First", "Oldest First", "Title A–Z"];

export function TrashPage() {
  const { songs, restoreSong, deleteForever, emptyTrash, navigate } = useJuno();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<string[]>([]);
  const [sort, setSort] = useState(SORTS[0]);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const trashed = useMemo(() => {
    let list = songs.filter((s) => s.trashed);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((s) => s.title.toLowerCase().includes(q));
    if (filters.includes("songs")) list = list.filter((s) => s.type !== "upload");
    if (filters.includes("uploads")) list = list.filter((s) => s.type === "upload");
    return [...list].sort((a, b) => {
      if (sort === "Oldest First") return a.updatedAt.localeCompare(b.updatedAt);
      if (sort === "Title A–Z") return a.title.localeCompare(b.title);
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [songs, search, filters, sort]);

  const target = songs.find((s) => s.id === confirmDelete);

  return (
    <div className="page">
      <div className="breadcrumb">
        <button className="btn btn-ghost" onClick={() => navigate("/library")}>Library</button>
        <span aria-hidden="true">›</span>
        <strong>Trash</strong>
      </div>

      <div className="page-title-row">
        <h1 className="page-title">Trash</h1>
        <Button
          variant="danger"
          disabled={trashed.length === 0}
          onClick={() => setConfirmEmpty(true)}
        >
          Empty Trash
        </Button>
      </div>

      <Toolbar
        search={search}
        onSearch={setSearch}
        filterOptions={[
          { id: "songs", label: "Songs" },
          { id: "uploads", label: "Uploads" },
        ]}
        activeFilters={filters}
        onToggleFilter={(id) =>
          setFilters((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]))
        }
        sortOptions={SORTS}
        sort={sort}
        onSort={setSort}
      />

      <div className="song-list">
        {trashed.length === 0 && (
          <div className="empty-state">
            <h3>Trash is empty</h3>
            <p>Trashed songs and uploads will appear here until you delete them forever.</p>
          </div>
        )}
        {trashed.map((s) => (
          <div key={s.id} className="song-row trashed">
            <div className="song-thumb" style={{ background: coverGradient(s.id) }} aria-hidden="true">
              <span className="duration-badge">{fmtDuration(s.durationSeconds)}</span>
            </div>
            <div className="song-body">
              <div className="song-title-row">
                <span className="song-title">{s.title}</span>
                <Badge>{s.type}</Badge>
                <Badge tone="danger">Trashed</Badge>
              </div>
              <div className="song-desc">Trashed {fmtRelative(s.updatedAt)}</div>
            </div>
            <div className="song-row-right" style={{ display: "flex", gap: 6 }}>
              <Button onClick={() => restoreSong(s.id)}>Restore</Button>
              <Button variant="danger" onClick={() => setConfirmDelete(s.id)}>
                Delete Forever
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Modal
        title="Empty trash?"
        open={confirmEmpty}
        onClose={() => setConfirmEmpty(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmEmpty(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                emptyTrash();
                setConfirmEmpty(false);
              }}
            >
              Delete everything forever
            </Button>
          </>
        }
      >
        <p>
          This permanently removes {trashed.length} item{trashed.length === 1 ? "" : "s"} from
          the local library database. Audio files under ./outputs remain on disk.
        </p>
      </Modal>

      <Modal
        title={`Delete "${target?.title}" forever?`}
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (confirmDelete) deleteForever(confirmDelete);
                setConfirmDelete(null);
              }}
            >
              Delete Forever
            </Button>
          </>
        }
      >
        <p>This cannot be undone. The library entry is removed permanently.</p>
      </Modal>
    </div>
  );
}

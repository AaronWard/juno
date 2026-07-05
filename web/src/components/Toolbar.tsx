import React from "react";
import { Dropdown } from "./Dropdown";

export interface FilterOption {
  id: string;
  label: string;
}

export interface ToolbarProps {
  search: string;
  onSearch: (v: string) => void;
  filterOptions: FilterOption[];
  activeFilters: string[];
  onToggleFilter: (id: string) => void;
  sortOptions: string[];
  sort: string;
  onSort: (v: string) => void;
  viewOptions?: string[];
  view?: string;
  onView?: (v: string) => void;
  quickPills?: FilterOption[];
  page?: number;
  onPage?: (p: number) => void;
  pageCount?: number;
}

/** Search / Filters (n) / Sort / View / quick pills / pagination row
 *  (DESIGN_DOC §12.2, §17). */
export function Toolbar(props: ToolbarProps) {
  const {
    search,
    onSearch,
    filterOptions,
    activeFilters,
    onToggleFilter,
    sortOptions,
    sort,
    onSort,
    viewOptions,
    view,
    onView,
    quickPills,
    page = 1,
    onPage,
    pageCount = 1,
  } = props;

  return (
    <div className="toolbar">
      <input
        className="search"
        type="search"
        placeholder="Search"
        aria-label="Search"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
      />

      <Dropdown
        ariaLabel="Filters"
        trigger={
          <>Filters{activeFilters.length > 0 ? ` (${activeFilters.length})` : ""}</>
        }
      >
        {filterOptions.map((f) => (
          <label key={f.id} className="menu-item" style={{ cursor: "pointer" }}>
            <span>{f.label}</span>
            <input
              type="checkbox"
              checked={activeFilters.includes(f.id)}
              onChange={() => onToggleFilter(f.id)}
              aria-label={f.label}
            />
          </label>
        ))}
      </Dropdown>

      <Dropdown
        ariaLabel="Sort"
        trigger={<>{sort}</>}
        items={sortOptions.map((s) => ({
          id: s,
          label: s,
          selected: s === sort,
          onSelect: () => onSort(s),
        }))}
      />

      {viewOptions && view && onView && (
        <Dropdown
          ariaLabel="View"
          trigger={<>{view}</>}
          items={viewOptions.map((v) => ({
            id: v,
            label: v,
            selected: v === view,
            onSelect: () => onView(v),
          }))}
        />
      )}

      {quickPills?.map((p) => (
        <button
          key={p.id}
          className={`pill-toggle${activeFilters.includes(p.id) ? " active" : ""}`}
          onClick={() => onToggleFilter(p.id)}
          aria-pressed={activeFilters.includes(p.id)}
        >
          {p.label}
        </button>
      ))}

      {onPage && (
        <div className="pagination">
          <button
            className="btn btn-icon"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          >
            ‹
          </button>
          <span>{page}</span>
          <button
            className="btn btn-icon"
            aria-label="Next page"
            disabled={page >= pageCount}
            onClick={() => onPage(page + 1)}
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}

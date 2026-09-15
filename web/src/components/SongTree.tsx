/** Shared lineage-tree renderer.
 *
 *  Rendered as genuinely NESTED containers, not flat rows with an indent value.
 *  The first version set `paddingLeft: depth * 36` on sibling rows, which made
 *  nesting a suggestion rather than a structure — a grandchild could end up
 *  looking further left than its parent, and nothing tied a child visually to
 *  the row above it. Here each level wraps its children in a `.lineage-children`
 *  container that draws the vertical guide rail, so depth is structural: a child
 *  physically cannot render left of its parent.
 */
import React, { useState } from "react";
import { Song } from "../data/mockSongs";
import { SongRow } from "./SongRow";
import { Icon } from "./Icon";
import { buildLineageTree, LineageNode } from "../lib/lineage";

function Branch({
  node,
  queueIds,
  showPlayCount,
  collapsed,
  onToggle,
}: {
  node: LineageNode;
  queueIds: string[];
  showPlayCount?: boolean;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
}) {
  const isCollapsed = collapsed.has(node.song.id);
  const hasChildren = node.children.length > 0;

  return (
    <div className="lineage-node">
      <div className="lineage-row">
        {/* The chevron column is always present, so rows line up whether or
            not a song has derivatives. */}
        <span className="lineage-gutter">
          {hasChildren && (
            <button
              className={`lineage-toggle${isCollapsed ? " collapsed" : ""}`}
              aria-expanded={!isCollapsed}
              aria-label={isCollapsed ? `Expand ${node.descendantCount} derived` : "Collapse"}
              title={isCollapsed ? `${node.descendantCount} derived from this` : "Collapse"}
              onClick={(e) => {
                e.stopPropagation();
                onToggle(node.song.id);
              }}
            >
              <Icon name={isCollapsed ? "chevron-right" : "chevron-down"} />
            </button>
          )}
        </span>
        <div className="lineage-row-body">
          <SongRow
            song={node.song}
            queueIds={queueIds}
            showPlayCount={showPlayCount}
            depth={node.depth}
            descendantCount={isCollapsed ? node.descendantCount : 0}
          />
        </div>
      </div>

      {hasChildren && !isCollapsed && (
        <div className="lineage-children">
          {node.children.map((c) => (
            <Branch
              key={c.song.id}
              node={c}
              queueIds={queueIds}
              showPlayCount={showPlayCount}
              collapsed={collapsed}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function SongTree({
  songs,
  queueIds,
  showPlayCount,
  compare,
  pageSlice,
}: {
  songs: Song[];
  queueIds: string[];
  showPlayCount?: boolean;
  compare?: (a: Song, b: Song) => number;
  /** Paginate over ROOTS — slicing mid-branch would orphan children. */
  pageSlice?: [number, number];
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const all = buildLineageTree(songs, compare);
  const roots = pageSlice ? all.slice(pageSlice[0], pageSlice[1]) : all;

  const onToggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="lineage-tree">
      {roots.map((r) => (
        <Branch
          key={r.song.id}
          node={r}
          queueIds={queueIds}
          showPlayCount={showPlayCount}
          collapsed={collapsed}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}

export function countRoots(songs: Song[]): number {
  return buildLineageTree(songs).length;
}

/** Shared lineage-tree renderer.
 *
 *  Lives here rather than inside LibraryPage because the Create/workspace list
 *  needs the identical view — the first version built it into the Library only,
 *  so derived songs looked flat everywhere else.
 */
import React, { useState } from "react";
import { Song } from "../data/mockSongs";
import { SongRow } from "./SongRow";
import { buildLineageTree, flattenTree } from "../lib/lineage";

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
  /** Root ordering; children are always oldest-first. */
  compare?: (a: Song, b: Song) => number;
  /** Paginate over ROOTS, not rows — slicing mid-branch would orphan children
   *  from their parent across a page boundary. */
  pageSlice?: [number, number];
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const allRoots = buildLineageTree(songs, compare);
  const roots = pageSlice ? allRoots.slice(pageSlice[0], pageSlice[1]) : allRoots;

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      {flattenTree(roots, collapsed).map((n) => (
        <SongRow
          key={n.song.id}
          song={n.song}
          queueIds={queueIds}
          showPlayCount={showPlayCount}
          depth={n.depth}
          childCount={n.children.length}
          descendantCount={n.descendantCount}
          collapsed={collapsed.has(n.song.id)}
          onToggleCollapse={() => toggle(n.song.id)}
        />
      ))}
    </>
  );
}

/** Number of roots, for pagination that pages over branches. */
export function countRoots(songs: Song[]): number {
  return buildLineageTree(songs).length;
}

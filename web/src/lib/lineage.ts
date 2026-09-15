/** Library lineage: turn the flat song list into a tree.
 *
 *  Every song carries `parentId` / `rootId` / `sourceIds` / `operation`, written
 *  at creation by the proxy and backfilled for older rows. This module only
 *  arranges them — it never infers relationships from titles or filenames.
 */
import { Song, SongOperation } from "../data/mockSongs";

export interface LineageNode {
  song: Song;
  children: LineageNode[];
  depth: number;
  /** Total descendants, for the "12 derived" collapse summary. */
  descendantCount: number;
}

/** Short label shown on a derived row, e.g. "Lost Time [Cover]". */
export const OPERATION_LABEL: Record<SongOperation, string> = {
  cover: "Cover",
  extend: "Extended",
  mashup: "Mashup",
  sample: "Sample",
  inspiration: "Inspired",
  reverse: "Reversed",
  speed: "Speed",
  "reuse-prompt": "Reprompt",
  crop: "Crop",
  "remove-section": "Section removed",
  "replace-section": "Section replaced",
  stems: "Stems",
  stem: "Stem",
  "midi-render": "MIDI render",
  upload: "Upload",
  generate: "Original",
};

/** Build the forest.
 *
 *  Songs whose parent is not in `songs` (trashed, filtered out by a search, or
 *  deleted) are promoted to roots rather than silently vanishing — a filtered
 *  Library must never hide a song just because its ancestor didn't match.
 */
export function buildLineageTree(
  songs: Song[],
  /** Comparator for ROOT ordering — pass the same one the flat list uses. */
  compare?: (a: Song, b: Song) => number
): LineageNode[] {
  const byId = new Map(songs.map((s) => [s.id, s]));
  const nodes = new Map<string, LineageNode>(
    songs.map((s) => [s.id, { song: s, children: [], depth: 0, descendantCount: 0 }])
  );

  const roots: LineageNode[] = [];
  for (const node of nodes.values()) {
    const parentId = node.song.parentId;
    const parent = parentId && byId.has(parentId) ? nodes.get(parentId) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }

  // Depth and descendant counts in one iterative pass. Iterative rather than
  // recursive: a long chain (crop -> extend -> cover -> slowed -> ...) should
  // not risk a stack overflow, and a corrupt cycle must not hang the UI.
  const seen = new Set<string>();
  const assign = (root: LineageNode) => {
    const stack: LineageNode[] = [root];
    const order: LineageNode[] = [];
    while (stack.length) {
      const n = stack.pop()!;
      if (seen.has(n.song.id)) continue;
      seen.add(n.song.id);
      order.push(n);
      for (const c of n.children) {
        c.depth = n.depth + 1;
        stack.push(c);
      }
    }
    // Walk back up so a parent's count includes its children's.
    for (let i = order.length - 1; i >= 0; i--) {
      const n = order[i];
      n.descendantCount = n.children.reduce((acc, c) => acc + 1 + c.descendantCount, 0);
    }
  };
  for (const r of roots) assign(r);

  // A parent cycle (a -> b -> a, only reachable via a corrupt or hand-edited
  // DB) leaves both songs as somebody's child and NEITHER as a root, so they
  // would silently disappear from the Library. Promote anything the root walk
  // never reached. Losing the tree shape for those rows is acceptable; losing
  // the rows is not.
  for (const node of nodes.values()) {
    if (seen.has(node.song.id)) continue;
    // Detach from the parent first: leaving the back-edge in place would make
    // every later child walk (sorting, flattening, rendering) loop forever.
    const parentId = node.song.parentId;
    const parent = parentId ? nodes.get(parentId) : undefined;
    if (parent) parent.children = parent.children.filter((c) => c !== node);
    node.depth = 0;
    roots.push(node);
    assign(node);
  }

  // Roots honour the user's sort selection. The first version hard-coded
  // "newest first" here, which silently discarded the toolbar choice — and
  // since Tree became the default view, that made the sort control look
  // completely dead even though the flat list was sorting correctly.
  //
  // Children stay oldest-first regardless: a branch is a creative history and
  // reads correctly in the order things were made. That is a deliberate choice,
  // and the UI says so rather than leaving it a mystery.
  const byOldest = (a: LineageNode, b: LineageNode) =>
    new Date(a.song.createdAt).getTime() - new Date(b.song.createdAt).getTime();
  if (compare) roots.sort((a, b) => compare(a.song, b.song));
  const sortChildren = (n: LineageNode) => {
    n.children.sort(byOldest);
    n.children.forEach(sortChildren);
  };
  roots.forEach(sortChildren);
  return roots;
}

/** Flatten for rendering, skipping the children of collapsed nodes. */
export function flattenTree(roots: LineageNode[], collapsed: Set<string>): LineageNode[] {
  const out: LineageNode[] = [];
  const walk = (n: LineageNode) => {
    out.push(n);
    if (collapsed.has(n.song.id)) return;
    n.children.forEach(walk);
  };
  roots.forEach(walk);
  return out;
}

/** Breadcrumb from the root down to this song: "what did this come from?" */
export function lineagePath(song: Song, songs: Song[]): Song[] {
  const byId = new Map(songs.map((s) => [s.id, s]));
  const path: Song[] = [];
  const seen = new Set<string>();
  let current: Song | undefined = song;
  while (current && !seen.has(current.id) && path.length < 64) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

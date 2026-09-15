/** Inline SVG icon set.
 *
 *  Emoji were being used for thumbs-down, comment, archive, trash and volume,
 *  which renders differently on every platform, can't inherit colour, and sits
 *  at a different optical weight to the hand-drawn heart and share glyphs next
 *  to it. These are stroke icons on a 24-grid matching those two, so a row of
 *  actions reads as one set.
 */
import React from "react";

export type IconName =
  | "heart"
  | "heart-filled"
  | "thumb-down"
  | "thumb-down-filled"
  | "comment"
  | "share"
  | "trash"
  | "archive"
  | "volume"
  | "volume-muted"
  | "info"
  | "chevron-right"
  | "chevron-down"
  | "queue";

const PATHS: Record<IconName, React.ReactNode> = {
  heart: <path d="M12 20s-7-4.4-7-9.2A4 4 0 0 1 12 7a4 4 0 0 1 7 3.8C19 15.6 12 20 12 20Z" />,
  "heart-filled": (
    <path
      d="M12 20s-7-4.4-7-9.2A4 4 0 0 1 12 7a4 4 0 0 1 7 3.8C19 15.6 12 20 12 20Z"
      fill="currentColor"
      stroke="none"
    />
  ),
  "thumb-down": (
    <>
      <path d="M17 3H7.5L5 11.5V14h5l-.8 3.6a2 2 0 0 0 1.9 2.4l3.4-7H17" />
      <path d="M17 3h2.5v10H17z" />
    </>
  ),
  "thumb-down-filled": (
    <>
      <path d="M17 3H7.5L5 11.5V14h5l-.8 3.6a2 2 0 0 0 1.9 2.4l3.4-7H17" fill="currentColor" />
      <path d="M17 3h2.5v10H17z" fill="currentColor" />
    </>
  ),
  comment: <path d="M20 12a7 7 0 0 1-7 7H8l-4 3v-4.3A7 7 0 0 1 4 12a7 7 0 0 1 7-7h2a7 7 0 0 1 7 7Z" />,
  share: (
    <>
      <path d="M8 16 18 6" />
      <path d="M11 6h7v7" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M10 4h4a1 1 0 0 1 1 1v2H9V5a1 1 0 0 1 1-1Z" />
      <path d="M6 7v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  archive: (
    <>
      <path d="M3 5h18v4H3z" />
      <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9" />
      <path d="M10 13h4" />
    </>
  ),
  volume: (
    <>
      <path d="M4 9v6h4l5 4V5L8 9H4Z" />
      <path d="M17 8.5a5 5 0 0 1 0 7" />
    </>
  ),
  "volume-muted": (
    <>
      <path d="M4 9v6h4l5 4V5L8 9H4Z" />
      <path d="m17 9 4 6M21 9l-4 6" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  "chevron-right": <path d="m9 6 6 6-6 6" />,
  "chevron-down": <path d="m6 9 6 6 6-6" />,
  queue: <path d="M4 7h16M4 12h16M4 17h10" />,
};

export function Icon({
  name,
  size = 16,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

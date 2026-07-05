import React from "react";

type Tone = "default" | "accent" | "warning" | "danger" | "success";

/** Compact metadata badge (model preset, type, status...). */
export function Badge({
  tone = "default",
  children,
}: {
  tone?: Tone;
  children: React.ReactNode;
}) {
  const cls =
    tone === "default" ? "badge" : `badge badge-${tone}`;
  return <span className={cls}>{children}</span>;
}

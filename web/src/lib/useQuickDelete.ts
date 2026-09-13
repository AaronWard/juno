/** Tracks whether the "quick delete" modifier is held.
 *
 *  Going into the ⋯ menu for every throwaway generation is slow, so holding
 *  Shift reveals a bin on each row (the same affordance open-webui uses on its
 *  chat list). Shift alone, deliberately: ⌘/Ctrl+Shift collides with browser
 *  and OS shortcuts on all three platforms.
 *
 *  Listeners are attached once and shared by every subscriber, so a library of
 *  200 rows does not install 200 keydown handlers.
 */
import { useEffect, useState } from "react";

let held = false;
const subscribers = new Set<(v: boolean) => void>();
let attached = false;

function set(v: boolean) {
  if (held === v) return;
  held = v;
  for (const fn of subscribers) fn(v);
}

function attach() {
  if (attached || typeof window === "undefined") return;
  attached = true;
  window.addEventListener("keydown", (e) => {
    // Never while typing: Shift is how you capitalise.
    const t = e.target as HTMLElement | null;
    if (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
    if (t?.isContentEditable) return;
    if (e.key === "Shift") set(true);
  });
  window.addEventListener("keyup", (e) => {
    if (e.key === "Shift") set(false);
  });
  // Alt-tabbing away with Shift down would otherwise leave bins showing forever.
  window.addEventListener("blur", () => set(false));
}

export function useQuickDelete(): boolean {
  const [value, setValue] = useState(held);
  useEffect(() => {
    attach();
    subscribers.add(setValue);
    setValue(held);
    return () => {
      subscribers.delete(setValue);
    };
  }, []);
  return value;
}

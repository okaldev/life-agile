// Shared pointing: each user sends what they point at ("task:12", "event:3", "rule:2", "retro:7");
// the partner sees a ring and a name tag on the same item. See openwiki/realtime.md (Presence).
import { useMemo } from "react";
import { api } from "./api";
import { usePartner, useStore } from "./store";

const ENTER_DELAY = 120; // ignore quick pass-overs
const LEAVE_DELAY = 500; // keep the mark a moment after the pointer leaves

let timer: ReturnType<typeof setTimeout> | undefined;
let sent: string | null = null;

function send(key: string | null, delay: number): void {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (key === sent) return;
    sent = key;
    void api.quietPost("/api/presence", { hover: key }).catch(() => {});
  }, delay);
}

/** Event handlers that share the pointer target with the partner. Touch: a tap counts as pointing. */
export function hoverProps(key: string) {
  return {
    onPointerEnter: (e: React.PointerEvent) => e.pointerType === "mouse" && send(key, ENTER_DELAY),
    onPointerLeave: (e: React.PointerEvent) => e.pointerType === "mouse" && send(null, LEAVE_DELAY),
    onPointerDown: (e: React.PointerEvent) => e.pointerType !== "mouse" && send(key, 0),
  };
}

export interface PartnerMark {
  name: string;
  color: string;
}

/**
 * The partner when they point at or focus one of the keys. A key "task:12" also matches
 * the task the partner opened in the task dialog.
 */
export function usePartnerMark(...keys: string[]): PartnerMark | null {
  const { state } = useStore();
  const partner = usePartner();
  const p = partner ? state.presence[partner.id] : undefined;
  return useMemo(() => {
    if (!partner || !p?.online) return null;
    const hit = keys.some((k) => k === p.hover || (p.taskId != null && k === `task:${p.taskId}`));
    return hit ? { name: partner.name, color: partner.color } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partner, p, keys.join("|")]);
}

/** Ring style for a marked element. Combine with the "ring-2" class. */
export function markStyle(mark: PartnerMark | null): React.CSSProperties | undefined {
  return mark ? ({ "--tw-ring-color": mark.color } as React.CSSProperties) : undefined;
}

/** Small name tag on the top edge of a marked element. The parent must be positioned (relative/absolute). */
export function PartnerTag({ mark }: { mark: PartnerMark | null }) {
  if (!mark) return null;
  return (
    <span
      className="pointer-events-none absolute -top-2 left-2 z-20 rounded px-1 py-px text-[10px] leading-none font-medium text-white shadow-sm"
      style={{ backgroundColor: mark.color }}
    >
      {mark.name}
    </span>
  );
}

// shadcn time picker (Popover + two scrolling columns) on "HH:MM" strings. Minutes step by 5;
// an off-step minute that is already set stays in the list.
import { Clock, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const pad = (n: number) => String(n).padStart(2, "0");
const HOURS = Array.from({ length: 24 }, (_, i) => pad(i));
const STEP_MINUTES = Array.from({ length: 12 }, (_, i) => pad(i * 5));

function Column({
  items,
  selected,
  onPick,
  label,
  scrollTo,
}: {
  items: string[];
  selected: string | null;
  /** Value to scroll into view when nothing is selected. */
  scrollTo?: string | null;
  onPick: (v: string) => void;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Bring the selected value into view when the column mounts (the popover opens).
  useEffect(() => {
    const target = selected ?? scrollTo;
    const el = target ? ref.current?.querySelector<HTMLElement>(`[data-value="${target}"]`) : null;
    el?.scrollIntoView({ block: "center" });
    // Runs once: the column mounts each time the popover opens.
  }, []);
  return (
    <ScrollArea className="h-56 w-14" aria-label={label}>
      <div ref={ref} className="flex flex-col gap-0.5 p-1">
        {items.map((v) => (
          <Button
            key={v}
            type="button"
            size="sm"
            variant={v === selected ? "default" : "ghost"}
            data-value={v}
            className="h-8 w-full shrink-0 tabular-nums"
            onClick={() => onPick(v)}
          >
            {v}
          </Button>
        ))}
      </div>
    </ScrollArea>
  );
}

export function TimePicker({
  value,
  onChange,
  placeholder = "--:--",
  clearable = true,
  disabled,
  className,
  size = "default",
  near,
}: {
  value: string | null | undefined;
  /** "HH:MM" whose hour the list opens at when the value is empty (for example the start time of an end picker). */
  near?: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  /** Shows a clear button; the value can become null. */
  clearable?: boolean;
  disabled?: boolean;
  className?: string;
  size?: "default" | "sm";
}) {
  const [open, setOpen] = useState(false);
  value = value || null;
  const [h, m] = value ? value.split(":") : [null, null];
  const minutes = m && !STEP_MINUTES.includes(m) ? [...STEP_MINUTES, m].sort() : STEP_MINUTES;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <Button
          type="button"
          variant="outline"
          size={size}
          className={cn("w-full justify-start gap-2 px-2.5 font-normal tabular-nums", !value && "text-muted-foreground", className)}
        >
          <Clock className="size-4 shrink-0 opacity-60" />
          <span className="truncate">{value ?? placeholder}</span>
          {clearable && value && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Saati temizle"
              className="ml-auto rounded p-0.5 opacity-60 hover:bg-accent hover:opacity-100"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
              }}
            >
              <X className="size-3.5" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="flex w-auto divide-x p-0" align="start">
        {/* A new hour keeps the minute; the first pick sets :00. A minute pick closes the popover. */}
        <Column label="Saat" items={HOURS} selected={h} scrollTo={near?.slice(0, 2)} onPick={(hh) => onChange(`${hh}:${m ?? "00"}`)} />
        <Column
          label="Dakika"
          items={minutes}
          selected={m}
          onPick={(mm) => {
            onChange(`${h ?? "00"}:${mm}`);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

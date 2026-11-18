// shadcn date picker (Popover + Calendar) on YYYY-MM-DD strings, Turkish locale, weeks start on Monday.
import { tr } from "date-fns/locale";
import { CalendarIcon, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fmt } from "@/lib/dates";
import { cn } from "@/lib/utils";

const toDate = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const toStr = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function DatePicker({
  value,
  onChange,
  placeholder = "Tarih seç",
  clearable = false,
  disabled,
  className,
  size = "default",
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  /** Shows a clear button; the value can become null. */
  clearable?: boolean;
  disabled?: boolean;
  className?: string;
  size?: "default" | "sm";
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? toDate(value) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <Button
          type="button"
          variant="outline"
          size={size}
          className={cn("w-full justify-start gap-2 px-2.5 font-normal", !value && "text-muted-foreground", className)}
        >
          <CalendarIcon className="size-4 shrink-0 opacity-60" />
          <span className="truncate">{value ? fmt(value, "d MMM yyyy, EEE") : placeholder}</span>
          {clearable && value && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Tarihi temizle"
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
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          locale={tr}
          weekStartsOn={1}
          selected={selected}
          defaultMonth={selected}
          onSelect={(d) => {
            if (d) onChange(toStr(d));
            else if (clearable) onChange(null);
            setOpen(false);
          }}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}

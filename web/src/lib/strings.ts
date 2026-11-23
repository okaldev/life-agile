// Turkish UI strings that are used in more than one place.
import type { PlanningStep, RetroKind, TaskStatus } from "@shared/types.ts";

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "Yapılacak",
  in_progress: "Devam ediyor",
  done: "Tamamlandı",
};

export const PRIORITY_LABEL = ["Yok", "Düşük", "Yüksek", "Acil"];

export const STEP_LABEL: Record<PlanningStep, string> = {
  retro: "Retro",
  grooming: "Grooming",
  estimation: "Estimation",
  start: "Başlat",
};

export const RETRO_LABEL: Record<RetroKind, string> = {
  good: "İyi giden",
  bad: "Kötü giden",
  try: "Aksiyonlar",
};

export const PAGE_LABEL: Record<string, string> = {
  board: "Board",
  calendar: "Takvim",
  backlog: "Backlog",
  recurring: "Tekrarlayanlar",
  planning: "Planlama",
  dashboard: "Dashboard",
  settings: "Ayarlar",
};

export const WEEKDAY_SHORT = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
export const WEEKDAY_LONG = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];

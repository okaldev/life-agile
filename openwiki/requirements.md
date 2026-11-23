# Requirements

## Users and access

- Made for a couple or a small group (two people is the main case; more work too). The UI is Turkish.
- Login: email + password, and optional Google OAuth (when `GOOGLE_CLIENT_ID` is set). A user can log in only if the account exists.
- Accounts come from: the first-run setup page `/kurulum` (only while there are no users; this user is admin), invite links, or `ALLOWED_EMAILS` (created at start).
- The oldest user is admin when no admin exists. Admins create invite links in Ayarlar → Kişiler (7 days, single use, the admin sends the link). The invited person sets name and password at `/davet?t=<token>`.
- Each user can set or change an own password in Ayarlar (Google users can add one).
- All pages and all API calls need a valid session. Other people cannot see or open anything.
- A session lasts 30 days.
- Ayarlar shows a "Kaynak kodu" link (`SOURCE_URL`), required by AGPL-3.0 for network use.

## Sprints

- A sprint is one week: Monday 00:00 to Sunday 23:59 in the app time zone (`APP_TIMEZONE`, default `Europe/Istanbul`).
- A user starts the planning wizard from the UI (normally Sunday evening, or earlier in the week). At the end the user starts the sprint now, or schedules it: it then starts by itself at 00:00 of its first day. Nothing else opens or closes a sprint automatically.
- Each sprint has a goal sentence and an SP target per person. Users can change targets at any time. Total target = sum of the person targets.
- Planning wizard order: **Retro → Grooming → Estimation → Start**. See [sprint-flow.md](sprint-flow.md).
- Unfinished tasks move to the next sprint by default. In grooming a user can send them back to the backlog.

## Tasks

- Fields: title, description, category, assignees (one person or several = "Ortak"), story points 0, 0.5, 1, 2, 3, 4, 5, status, priority, due date, optional day and optional time range, checklist, comments.
- Status: To Do, In Progress, Done.
- A task with both assignees counts its full SP for each person.
- Unplanned work ("Plan dışı", change request): a task added to the running sprint gets an orange tag. The sprint header, retro and dashboard show its count and SP.
- A user creates a task from the board (form) or from the calendar (select a time range).
- Recurring tasks: see [recurring.md](recurring.md). A normal task can be converted to a recurring rule ("Tekrarlayana çevir").
- A task can be split into several calendar parts. Each part is marked done or missed. Task progress (0–100) comes from parts, checklist or a manual value. See [calendar.md](calendar.md).
- A missed recurring occurrence leaves the board but stays in the calendar and metrics.
- Cancel ("Görevi iptal et", ⋯ menu, sprint tasks that are not done): the task is not needed any more. `cancelled_at` is set. It does not count anywhere (SP, stats, burndown), is never carried or sent to the backlog, and leaves grooming, estimation, the calendar and the backlog. On the board it sits muted at the end of the done column with an "İptal" tag. "İptali geri al" or a status change brings it back. A done task cannot be cancelled.
- A task in the planned sprint that becomes done before that sprint starts moves to the active sprint (it is work of the running week) and so leaves grooming (`settleDoneTask`).
- Multi-day: a calendar part (and an event) can have an inclusive end date (max 32 days). It has no times and is drawn as one bar across its days. Moving it keeps its length; giving it a time makes it a one-day part again.
- New task form: the same layout as the task view: title, then "owner · status · SP" as plain text, then badges (category, priority, due date, day/time or several days, sprint) with the same pickers, and a description.

## Events

- General events outside sprints: buluşma, misafir, dışarıda, meşgul, diğer. One or both people. Optional time. Optional repeat.
- Events are information only: no SP, no metrics. The estimation step shows event hours per person and the target suggestion subtracts them (8 h = 1 day).
- An event can be marked Gerçekleşti / Gerçekleşmedi.
- A one-off event without time can last several days (end date); it shows as one bar across the days.

## Task dialog

Read-first view (`web/src/components/app/TaskView.tsx`). Values are shown as text; a click opens a small editor. Each value appears once.
- Header: title (click to edit inline), badges (Plan dışı, Tekrarlayan, Devreden), "⋯" menu with only: plan dışı işaretle/kaldır, tekrarlayana çevir, görevi sil.
- Opened from a calendar part that is still planned: a "Bu parça · date time" line with Yapıldı / Yapılmadı. It goes away after marking. The Takvim badge shows done parts green and missed parts red (soft tones).
- Properties have no labels; a click on a value opens a popover. Under the title, one plain line: owner · status · story points (e.g. "Ada · Devam ediyor · 2 SP"). Below the header, one row of badges: Kategori, Öncelik, Son tarih, Takvim (parts list). Empty values show a muted "Kategori yok", "Öncelik yok", "Son tarih yok", "Takvimde yok". İlerleme is a full-width bar (slider, %25/50/75, Görevi tamamla for split tasks).
- Sprint is changed from the "⋯" menu ("Sprinti değiştir"); a badge shows the sprint when the task is not in the active sprint.
- "Geçmiş" at the bottom, closed by default: every change of the task (fields, parts, checklist, comments) with who and when (`task_history`, `GET /api/tasks/:id/history`).
- New tasks (and generated recurring occurrences) start with priority "Düşük".
- Açıklama: text or a muted "Açıklama ekle…"; click → textbox, blur saves, Esc cancels.
- Kontrol listesi: a small "+ Kontrol listesi" link until it has items.
- Yorumlar: list and one input.
- New task: form layout (title, owner, SP, sprint, day/time; "Daha fazla" for description and details).

## Layout

- Desktop sidebar collapses to icons (toggle next to the logo, Ctrl/⌘+B, remembered on the device).
- Calendar toolbar: row 1 navigation (‹ Bugün/Bu sprint ›, Gün/Hafta, date, İşaretlenmemiş); row 2 person filter, "+ Etkinlik" and the "Sprint görevleri" panel toggle (default open from 1280 px, remembered on the device).

## Profile photo

- Each user can upload a photo in Ayarlar (circle crop, zoom). It replaces the Google photo everywhere; "Google fotoğrafına dön" removes it.

## Views

- Board: three columns, one-row sprint header with SP done and target per person. On desktop the board fits the screen and each column scrolls on its own (column header stays visible). Recurring occurrences: per rule, the open ones up to today; when none is today, the next open one (e.g. Tuesday's class on Monday). Undated "N times a week" occurrences always show. "Gelecek tekrarlar" shows all of them. Cancelled tasks sit muted at the end of the done column.
- Calendar (start page `/`): day or week view, 24 hours. Default by screen width: below 1024 px day view, wider week view; a "Gün / Hafta" toggle switches it for the visit. Arrows move one day or one week; "Bugün" / "Bu sprint" jump back. Week view shows the sprint week, (00:00–24:00), opens at 07:00. Shows task parts, general events and public holidays (`HOLIDAYS`, default Turkey; holiday name in the all-day row, red day number on mobile). "All day" row for items without time; multi-day items as bars across the days below it. Desktop: drag on the grid to open the slot chooser (new task / part of an existing task / event), drag an item to move it, drag its bottom edge to resize, drag a sprint task from the side list to add a part. Mobile: one day; tap a slot or an item. Past planned items without a mark get an amber dashed border and an "İşaretlenmemiş (N)" list. See [calendar.md](calendar.md).
- Backlog: tasks without a sprint. Two sort modes: "Akıllı" (priority, due date, then manual rank) and "Manuel" (drag).
- Person filter on board, calendar and backlog: one tab per person, Ortak (shared only), Tümü.
- Dashboard: past sprints and metrics. See [metrics.md](metrics.md).
- Recurring rules page, settings page, planning page.

## Collaboration

- Both users can use the same screen at the same time. Changes appear on the other screen without reload.
- Each user sees where the other user is (page and focused task) and which item the other user points at (ring + name tag).
- Rows in backlog, grooming and estimation show the owner: a person-color strip on the left and a name chip (person name or Ortak).
- An activity feed shows recent changes.

## Capacity

- A user can mark leave days (full or half day). The estimation step shows a target suggestion from available days.
- Public holidays count as leave days (arife: half day) in the capacity and the suggestion.
- The estimation step shows past done SP: together (average of all closed sprints, last 3, best) and per person (average, last 3, best).

## Notifications

- Web Push to phones (PWA). Planning reminder on Sunday 20:00, daily summary 08:30, reminder before timed tasks, partner assignment notice. Each one can be turned off per user.

## Non-functional

- UI language: Turkish. Code, comments and docs: English.
- Mobile-first, installable PWA, light and dark theme, shadcn/ui, minimal look.
- Lightweight: one container, Node + SQLite, memory limit 256 MB.
- Daily database backup, keep 30 days. Never delete or overwrite the server `data/` directory.

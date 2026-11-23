// Additive migrations. Never edit an old entry; append a new one.

export const MIGRATIONS: string[] = [
  // 1: initial schema
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    avatar_url TEXT,
    color TEXT NOT NULL DEFAULT '#3b82f6'
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    expires_at TEXT NOT NULL
  );
  CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE sprints (
    id INTEGER PRIMARY KEY,
    number INTEGER NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('planned','active','closed')),
    goal TEXT NOT NULL DEFAULT '',
    planning_step TEXT,
    groomed_at TEXT,
    closed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE sprint_members (
    sprint_id INTEGER NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    target_sp INTEGER NOT NULL DEFAULT 0,
    done_sp_snapshot INTEGER,
    PRIMARY KEY (sprint_id, user_id)
  );
  CREATE TABLE availability (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    date TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('off','half')),
    note TEXT NOT NULL DEFAULT '',
    UNIQUE (user_id, date)
  );
  CREATE TABLE recurring_rules (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category_id INTEGER REFERENCES categories(id),
    freq TEXT NOT NULL CHECK (freq IN ('daily','weekdays','weekly')),
    weekdays_mask INTEGER NOT NULL DEFAULT 0,
    start_time TEXT,
    end_time TEXT,
    default_sp INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    deleted_at TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE recurring_rule_assignees (
    rule_id INTEGER NOT NULL REFERENCES recurring_rules(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    PRIMARY KEY (rule_id, user_id)
  );
  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category_id INTEGER REFERENCES categories(id),
    sprint_id INTEGER REFERENCES sprints(id),
    status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done')),
    sp INTEGER CHECK (sp IS NULL OR (sp BETWEEN 1 AND 5)),
    priority INTEGER NOT NULL DEFAULT 0,
    due_date TEXT,
    date TEXT,
    start_time TEXT,
    end_time TEXT,
    backlog_rank REAL NOT NULL DEFAULT 0,
    recurring_rule_id INTEGER REFERENCES recurring_rules(id),
    occurrence_date TEXT,
    carried_from_sprint_id INTEGER REFERENCES sprints(id),
    started_at TEXT,
    done_at TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX tasks_sprint ON tasks(sprint_id);
  CREATE UNIQUE INDEX tasks_occurrence ON tasks(recurring_rule_id, occurrence_date) WHERE recurring_rule_id IS NOT NULL;
  CREATE TABLE task_assignees (
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    PRIMARY KEY (task_id, user_id)
  );
  CREATE TABLE checklist_items (
    id INTEGER PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    rank REAL NOT NULL DEFAULT 0
  );
  CREATE TABLE comments (
    id INTEGER PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE retro_items (
    id INTEGER PRIMARY KEY,
    sprint_id INTEGER NOT NULL REFERENCES sprints(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    kind TEXT NOT NULL CHECK (kind IN ('good','bad','try')),
    text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE activity (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id INTEGER,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE push_subscriptions (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE notification_prefs (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    planning_reminder INTEGER NOT NULL DEFAULT 1,
    daily_summary INTEGER NOT NULL DEFAULT 1,
    task_reminder_min INTEGER NOT NULL DEFAULT 15,
    partner_changes INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE sent_notifications (
    key TEXT PRIMARY KEY,
    sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  INSERT INTO categories (name, color) VALUES
    ('Ev', '#f59e0b'), ('İş', '#3b82f6'), ('Sağlık', '#10b981'),
    ('Finans', '#8b5cf6'), ('Sosyal', '#ec4899'), ('Kişisel', '#64748b');
  `,
  // 2: calendar blocks (split tasks), missed marks, manual progress, calendar events.
  // Additive only. tasks.date/start_time/end_time stay as a cache of the earliest block.
  `
  CREATE TABLE task_blocks (
    id INTEGER PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    start_time TEXT,
    end_time TEXT,
    status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','done','missed')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX task_blocks_date ON task_blocks(date);
  CREATE INDEX task_blocks_task ON task_blocks(task_id);
  INSERT INTO task_blocks (task_id, date, start_time, end_time, status, created_at, updated_at)
    SELECT id, date, start_time, CASE WHEN start_time IS NULL THEN NULL ELSE end_time END,
      CASE status WHEN 'done' THEN 'done' ELSE 'planned' END, created_at, updated_at
    FROM tasks WHERE date IS NOT NULL;
  ALTER TABLE tasks ADD COLUMN progress_manual INTEGER;
  ALTER TABLE tasks ADD COLUMN missed_at TEXT;

  CREATE TABLE event_rules (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('meet','guest','out','busy','other')),
    freq TEXT NOT NULL CHECK (freq IN ('daily','weekdays','weekly')),
    weekdays_mask INTEGER NOT NULL DEFAULT 0,
    start_time TEXT,
    end_time TEXT,
    start_date TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    deleted_at TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE event_rule_attendees (
    rule_id INTEGER NOT NULL REFERENCES event_rules(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    PRIMARY KEY (rule_id, user_id)
  );
  CREATE TABLE calendar_events (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('meet','guest','out','busy','other')),
    date TEXT NOT NULL,
    start_time TEXT,
    end_time TEXT,
    status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','done','missed')),
    rule_id INTEGER REFERENCES event_rules(id),
    occurrence_date TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX calendar_events_date ON calendar_events(date);
  CREATE UNIQUE INDEX calendar_events_occurrence ON calendar_events(rule_id, occurrence_date) WHERE rule_id IS NOT NULL;
  CREATE TABLE calendar_event_attendees (
    event_id INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    PRIMARY KEY (event_id, user_id)
  );
  `,
  // 3: story points allow 0 and 0.5 (new column without the old 1-5 CHECK; tasks.sp is legacy and no longer written),
  // unplanned flag for work added to a running sprint.
  `
  ALTER TABLE tasks ADD COLUMN points REAL;
  UPDATE tasks SET points = sp;
  ALTER TABLE tasks ADD COLUMN unplanned_at TEXT;
  `,
  // 4: custom profile photos, stored in the DB so backups include them. users.avatar_url stays the Google photo.
  `
  CREATE TABLE user_avatars (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    mime TEXT NOT NULL,
    data BLOB NOT NULL,
    updated_at TEXT NOT NULL
  );
  `,
  // 5: per-task change history (field changes, part marks, checklist, comments).
  `
  CREATE TABLE task_history (
    id INTEGER PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id),
    field TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX task_history_task ON task_history(task_id, id);
  `,
  // 6: email/password login, admin flag and invite links (Google login stays as it is).
  `
  ALTER TABLE users ADD COLUMN password_hash TEXT;
  ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE invites (
    id INTEGER PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id),
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  `,
  // 7: a planned sprint can start by itself at 00:00 of its start date (scheduled_at = when it was scheduled).
  `
  ALTER TABLE sprints ADD COLUMN scheduled_at TEXT;
  `,
];

import BetterSqlite3 from 'better-sqlite3'
import fs from 'fs'
import path from 'path'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  pseudonym     TEXT    UNIQUE NOT NULL,
  password_hash TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS questions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL,
  option_a     TEXT NOT NULL,
  option_b     TEXT NOT NULL,
  image_url    TEXT,
  deadline     TEXT NOT NULL,
  resolved_at  TEXT,
  ground_truth TEXT CHECK(ground_truth IN ('A', 'B')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS votes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  question_id INTEGER NOT NULL REFERENCES questions(id),
  choice      TEXT    NOT NULL CHECK(choice IN ('A', 'B')),
  is_correct  INTEGER,
  voted_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_votes_user    ON votes(user_id);
CREATE INDEX IF NOT EXISTS idx_votes_question ON votes(question_id);

CREATE TABLE IF NOT EXISTS smi_questions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  question_date TEXT    NOT NULL UNIQUE,
  question_id   INTEGER REFERENCES questions(id),
  prev_close    REAL    NOT NULL,
  prev_date     TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS youtube_suggestions (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  suggested_date       TEXT    NOT NULL UNIQUE,
  video_a_id           TEXT    NOT NULL,
  video_a_title        TEXT    NOT NULL,
  video_a_channel      TEXT    NOT NULL,
  video_a_thumbnail    TEXT,
  video_a_subscribers  INTEGER,
  video_b_id           TEXT    NOT NULL,
  video_b_title        TEXT    NOT NULL,
  video_b_channel      TEXT    NOT NULL,
  video_b_thumbnail    TEXT,
  video_b_subscribers  INTEGER,
  approved             INTEGER NOT NULL DEFAULT 0,
  question_id          INTEGER REFERENCES questions(id),
  created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);
`

export function initDb(dbPath: string): BetterSqlite3.Database {
  const dir = path.dirname(dbPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const db = new BetterSqlite3(dbPath)

  // WAL mode: better read concurrency and crash safety
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(SCHEMA)

  // Additive column migrations — safe to run on every start
  const alterations = [
    'ALTER TABLE questions ADD COLUMN option_a_image TEXT',
    'ALTER TABLE questions ADD COLUMN option_b_image TEXT',
    'ALTER TABLE questions ADD COLUMN option_a_views INTEGER',
    'ALTER TABLE questions ADD COLUMN option_b_views INTEGER',
    'ALTER TABLE youtube_suggestions ADD COLUMN video_a_published_at TEXT',
    'ALTER TABLE youtube_suggestions ADD COLUMN video_a_views INTEGER',
    'ALTER TABLE youtube_suggestions ADD COLUMN video_b_published_at TEXT',
    'ALTER TABLE youtube_suggestions ADD COLUMN video_b_views INTEGER',
  ]
  for (const sql of alterations) {
    try {
      db.exec(sql)
    } catch {
      /* column already exists */
    }
  }

  return db
}

import BetterSqlite3 from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { normalizeEmail } from '../services/passwordReset'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  pseudonym     TEXT    UNIQUE NOT NULL,
  password_hash TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS password_resets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT    NOT NULL,
  expires_at TEXT    NOT NULL,
  used_at    TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token_hash);

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

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  endpoint   TEXT    NOT NULL UNIQUE,
  p256dh     TEXT    NOT NULL,
  auth       TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
`

/** The predictor tables, kept apart from SCHEMA so the one-time rebuild below can re-run them. */
const PREDICTOR_SCHEMA = `
-- The predictor's frozen configuration. One row per question series ('smi', 'youtube').
--
-- SMI and YouTube are separate prediction problems: each series runs its own expert
-- pool, weight vector, learning rate and round count, exactly as the lecture analysis
-- splits them. Written before the first round of that series is committed and then
-- effectively immutable: the learning rate, the expert pool and the fill seed all have to
-- be fixed *ahead of the data* or the regret bound does not apply. Storing them makes
-- that auditable rather than a claim.
CREATE TABLE IF NOT EXISTS predictor_season (
  series          TEXT    PRIMARY KEY CHECK(series IN ('smi', 'youtube')),
  window_start    TEXT    NOT NULL,
  window_end      TEXT    NOT NULL,
  t_planned       INTEGER NOT NULL,
  rate_mode       TEXT    NOT NULL CHECK(rate_mode IN ('fixed', 'anytime')),
  learning_rate   REAL    NOT NULL,
  tie_break       TEXT    NOT NULL DEFAULT 'A' CHECK(tie_break IN ('A', 'B')),
  fill_seed       INTEGER NOT NULL,
  -- Both NULL until the first batch is committed, then frozen: the pool is the set of
  -- users who existed when voting first closed. ln(N) feeds the learning rate and every
  -- bound, so it must not drift as people register later in the window.
  n_experts       INTEGER,
  expert_pool_json TEXT,
  created_at      TEXT    NOT NULL
);

-- One row per (question, prediction). Append-only ledger.
--
-- weights_json is the weight vector the predictor held when it committed, and is never
-- recomputed afterwards — replaying it later with hindsight is precisely the thing the
-- no-cheating precondition forbids. Within a series, questions that share a batch_key
-- (their deadline) are predicted simultaneously from one weight vector and scored
-- together; across series nothing is shared.
CREATE TABLE IF NOT EXISTS predictor_rounds (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  series        TEXT    NOT NULL CHECK(series IN ('smi', 'youtube')),
  question_id   INTEGER NOT NULL UNIQUE REFERENCES questions(id),
  batch_key     TEXT    NOT NULL,
  -- counts rounds within the series: SMI round 3 and YouTube round 3 are unrelated
  round_index   INTEGER NOT NULL,
  committed_at  TEXT    NOT NULL,
  learning_rate REAL    NOT NULL,
  weights_json  TEXT    NOT NULL,
  votes_json    TEXT    NOT NULL,
  weight_a      REAL    NOT NULL,
  weight_b      REAL    NOT NULL,
  n_voters      INTEGER NOT NULL,
  n_manual      INTEGER NOT NULL,
  wm_prediction TEXT    NOT NULL CHECK(wm_prediction IN ('A', 'B')),
  mv_prediction TEXT    NOT NULL CHECK(mv_prediction IN ('A', 'B')),
  truth         TEXT    CHECK(truth IN ('A', 'B')),
  wm_correct    INTEGER,
  mv_correct    INTEGER,
  p_follow_i    REAL,
  scored_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_predictor_rounds_batch ON predictor_rounds(batch_key);
CREATE INDEX IF NOT EXISTS idx_predictor_rounds_order ON predictor_rounds(series, round_index);
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
  rebuildPredictorTablesForSeries(db)
  db.exec(PREDICTOR_SCHEMA)

  // Additive column migrations — safe to run on every start
  const alterations = [
    'ALTER TABLE users ADD COLUMN email TEXT',
    'ALTER TABLE users ADD COLUMN email_notifications INTEGER NOT NULL DEFAULT 1',
    'ALTER TABLE questions ADD COLUMN option_a_image TEXT',
    'ALTER TABLE questions ADD COLUMN option_b_image TEXT',
    'ALTER TABLE questions ADD COLUMN option_a_views INTEGER',
    'ALTER TABLE questions ADD COLUMN option_b_views INTEGER',
    'ALTER TABLE youtube_suggestions ADD COLUMN video_a_published_at TEXT',
    'ALTER TABLE youtube_suggestions ADD COLUMN video_a_views INTEGER',
    'ALTER TABLE youtube_suggestions ADD COLUMN video_b_published_at TEXT',
    'ALTER TABLE youtube_suggestions ADD COLUMN video_b_views INTEGER',
    // Voting window: questions are hidden until published_at, and deadline closes voting
    'ALTER TABLE questions ADD COLUMN published_at TEXT',
    // Measurement window — starts when voting closes so the outcome is never observable
    // to voters. NULL for question types that are not measured over a window.
    'ALTER TABLE questions ADD COLUMN race_starts_at TEXT',
    'ALTER TABLE questions ADD COLUMN race_ends_at TEXT',
    // View counts snapshotted at each end of the measurement window, with the instant they
    // were actually taken so the true window length stays auditable in the export
    'ALTER TABLE youtube_suggestions ADD COLUMN race_start_views_a INTEGER',
    'ALTER TABLE youtube_suggestions ADD COLUMN race_start_views_b INTEGER',
    'ALTER TABLE youtube_suggestions ADD COLUMN race_start_at TEXT',
    'ALTER TABLE youtube_suggestions ADD COLUMN race_end_views_a INTEGER',
    'ALTER TABLE youtube_suggestions ADD COLUMN race_end_views_b INTEGER',
    'ALTER TABLE youtube_suggestions ADD COLUMN race_end_at TEXT',
    // When the "new question" announcement dispatcher last processed this question. Set
    // whether or not mails went out (a question published too long ago is marked and
    // skipped), so it reads as "the notifier is done with this row" — see
    // services/notifications.ts.
    'ALTER TABLE questions ADD COLUMN notified_at TEXT',
  ]
  for (const sql of alterations) {
    try {
      db.exec(sql)
    } catch {
      /* column already exists */
    }
  }

  // Deferred until after the email column exists (fresh DBs get it via SCHEMA + ALTER above)
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)')

  foldEmailsToCanonicalForm(db)

  return db
}

/**
 * Rebuild the predictor tables when they still have the single-series shape.
 *
 * The first design ran one predictor over SMI and YouTube questions interleaved, which
 * mixes two unrelated prediction problems into one weight vector. The per-series shape is
 * keyed by `series` and has no migration path for the old rows: a ledger row is only
 * meaningful together with the weights it was committed from, and those belonged to the
 * combined run. So the old tables are dropped and the next tick recommits every closed
 * question from the votes, which are the source of truth. Detected by the missing
 * `series` column, so it runs exactly once; fresh databases never enter it.
 */
function rebuildPredictorTablesForSeries(db: BetterSqlite3.Database): void {
  const columns = db.prepare('PRAGMA table_info(predictor_season)').all() as { name: string }[]
  if (columns.length === 0 || columns.some((c) => c.name === 'series')) return

  const rows = (db.prepare('SELECT COUNT(*) AS n FROM predictor_rounds').get() as { n: number }).n
  db.exec('DROP TABLE IF EXISTS predictor_rounds')
  db.exec('DROP TABLE IF EXISTS predictor_season')
  console.warn(
    `[migrate] predictor tables rebuilt for per-series predictors; ${rows} ledger row(s) ` +
      'from the single-series run were discarded. POST /admin/predictor/tick recommits ' +
      'every closed question from the votes.',
  )
}

/**
 * Fold stored emails to their canonical form (trimmed, lower-cased).
 *
 * Rows written before `normalizeEmail` existed can carry mixed case or stray whitespace.
 * Every lookup that matters — login by email, password reset — compared them with SQLite's
 * case-sensitive BINARY collation, so such a row was unreachable by the address its owner
 * actually types. The route handlers now compare on `lower(email)`, which fixes reads; this
 * fixes the stored data so the unique index means what it says.
 *
 * Rows that would collide with another account once folded are left untouched and logged:
 * choosing which of two accounts keeps the address is an operator's decision, not a
 * migration's, and a UNIQUE violation here would take the whole boot down.
 */
function foldEmailsToCanonicalForm(db: BetterSqlite3.Database): void {
  const foldable = db
    .prepare(
      `SELECT id, email FROM users
       WHERE email IS NOT NULL AND email <> lower(trim(email))`,
    )
    .all() as { id: number; email: string }[]

  if (foldable.length === 0) return

  const clashing = new Set(
    (
      db
        .prepare(
          `SELECT lower(trim(email)) AS folded FROM users
           WHERE email IS NOT NULL
           GROUP BY folded HAVING count(*) > 1`,
        )
        .all() as { folded: string }[]
    ).map((r) => r.folded),
  )

  const update = db.prepare('UPDATE users SET email = ? WHERE id = ?')

  db.transaction(() => {
    for (const row of foldable) {
      const folded = normalizeEmail(row.email)
      if (clashing.has(folded)) {
        console.warn(
          `[migrate] user ${row.id} (${row.email}) folds onto another account's address — ` +
            'left unchanged; merge the duplicates by hand',
        )
        continue
      }
      update.run(folded, row.id)
    }
  })()
}

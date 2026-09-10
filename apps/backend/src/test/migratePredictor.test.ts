import { describe, it, expect, afterAll } from 'vitest'
import BetterSqlite3 from 'better-sqlite3'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { initDb } from '../db/migrate'

// The production database was created by the single-series predictor (one season row with
// id = 1, ledger rows without a series). That shape cannot carry per-series predictors, so
// initDb rebuilds the two predictor tables once — and must leave everything else alone.
describe('Predictor tables rebuild for per-series predictors', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expert-vote-predictor-migrate-'))
  const dbPath = path.join(dir, 'old.db')

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  function seedSingleSeriesShape() {
    // Boot once to get every other table, then replace the predictor tables with the old DDL.
    const fresh = initDb(dbPath)
    fresh
      .prepare(
        "INSERT INTO users (pseudonym, email, password_hash) VALUES ('Ada', 'ada@example.com', 'x')",
      )
      .run()
    fresh
      .prepare(
        `INSERT INTO questions (title, description, option_a, option_b, deadline)
         VALUES ('Q', 'd', 'A', 'B', '2026-08-31T10:00:00.000Z')`,
      )
      .run()
    fresh.close()

    const raw = new BetterSqlite3(dbPath)
    raw.exec(`
      DROP TABLE predictor_rounds;
      DROP TABLE predictor_season;
      CREATE TABLE predictor_season (
        id INTEGER PRIMARY KEY CHECK(id = 1), window_start TEXT NOT NULL, window_end TEXT NOT NULL,
        t_planned INTEGER NOT NULL, rate_mode TEXT NOT NULL, learning_rate REAL NOT NULL,
        tie_break TEXT NOT NULL DEFAULT 'A', fill_seed INTEGER NOT NULL, n_experts INTEGER,
        expert_pool_json TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE predictor_rounds (
        id INTEGER PRIMARY KEY AUTOINCREMENT, question_id INTEGER NOT NULL UNIQUE REFERENCES questions(id),
        batch_key TEXT NOT NULL, round_index INTEGER NOT NULL, committed_at TEXT NOT NULL,
        learning_rate REAL NOT NULL, weights_json TEXT NOT NULL, votes_json TEXT NOT NULL,
        weight_a REAL NOT NULL, weight_b REAL NOT NULL, n_voters INTEGER NOT NULL, n_manual INTEGER NOT NULL,
        wm_prediction TEXT NOT NULL, mv_prediction TEXT NOT NULL, truth TEXT, wm_correct INTEGER,
        mv_correct INTEGER, p_follow_i REAL, scored_at TEXT
      );
      INSERT INTO predictor_season VALUES (1, 's', 'e', 20, 'anytime', 1.0, 'A', 1, 1, '["Ada"]', 'c');
      INSERT INTO predictor_rounds
        (question_id, batch_key, round_index, committed_at, learning_rate, weights_json, votes_json,
         weight_a, weight_b, n_voters, n_manual, wm_prediction, mv_prediction)
      VALUES (1, 'k', 1, 'c', 1.0, '{}', '{}', 1, 0, 1, 1, 'A', 'A');
    `)
    raw.close()
  }

  it('drops the single-series ledger and recreates the tables keyed by series', () => {
    seedSingleSeriesShape()

    const db = initDb(dbPath)
    const seasonCols = (
      db.prepare('PRAGMA table_info(predictor_season)').all() as { name: string }[]
    ).map((c) => c.name)
    const roundCols = (
      db.prepare('PRAGMA table_info(predictor_rounds)').all() as { name: string }[]
    ).map((c) => c.name)
    const seasons = (
      db.prepare('SELECT COUNT(*) AS n FROM predictor_season').get() as { n: number }
    ).n
    const rounds = (db.prepare('SELECT COUNT(*) AS n FROM predictor_rounds').get() as { n: number })
      .n
    const users = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n
    db.close()

    expect(seasonCols).toContain('series')
    expect(seasonCols).not.toContain('id')
    expect(roundCols).toContain('series')
    expect(seasons).toBe(0)
    expect(rounds).toBe(0)
    expect(users).toBe(1) // nothing outside the predictor was touched
  })

  it('is a no-op on the next boot', () => {
    const db = initDb(dbPath)
    db.prepare(
      `INSERT INTO predictor_season
         (series, window_start, window_end, t_planned, rate_mode, learning_rate, fill_seed, created_at)
       VALUES ('smi', 's', 'e', 9, 'anytime', 1.0, 1, 'c')`,
    ).run()
    db.close()

    const again = initDb(dbPath)
    const seasons = (
      again.prepare('SELECT COUNT(*) AS n FROM predictor_season').get() as { n: number }
    ).n
    again.close()

    expect(seasons).toBe(1)
  })
})

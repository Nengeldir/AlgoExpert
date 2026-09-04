import { describe, it, expect, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { initDb } from '../db/migrate'

// This migration is what repairs accounts that were written before emails were
// normalised — the rows that were unreachable by the address their owner actually types.
// It only runs at initDb time, so unlike the rest of the suite it needs a file-backed DB.
describe('Email folding migration', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expert-vote-migrate-'))
  const dbPath = path.join(dir, 'fold.db')

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  function seed(rows: string[]) {
    const db = initDb(dbPath)
    const insert = db.prepare('INSERT INTO users (pseudonym, email, password_hash) VALUES (?, ?, ?)')
    rows.forEach((email, i) => insert.run(`legacy${i}`, email, 'x'))
    db.close()
  }

  it('folds a legacy mixed-case address on the next boot', () => {
    seed(['First.Last@ETHZ.ch', ' padded@example.com '])

    const db = initDb(dbPath)
    const emails = (db.prepare('SELECT email FROM users ORDER BY pseudonym').all() as {
      email: string
    }[]).map((r) => r.email)
    db.close()

    expect(emails).toEqual(['first.last@ethz.ch', 'padded@example.com'])
  })

  it('leaves colliding rows alone rather than failing the boot', () => {
    // Two accounts that differ only by case: folding either onto the other would violate
    // idx_users_email and take the process down on start.
    const db = initDb(dbPath)
    db.prepare('DELETE FROM users').run()
    const insert = db.prepare('INSERT INTO users (pseudonym, email, password_hash) VALUES (?, ?, ?)')
    insert.run('dupe_a', 'Clash@ethz.ch', 'x')
    insert.run('dupe_b', 'clash@ethz.ch', 'x')
    db.close()

    const reopened = initDb(dbPath)
    const emails = (reopened.prepare('SELECT email FROM users ORDER BY pseudonym').all() as {
      email: string
    }[]).map((r) => r.email)
    reopened.close()

    expect(emails).toEqual(['Clash@ethz.ch', 'clash@ethz.ch'])
  })
})

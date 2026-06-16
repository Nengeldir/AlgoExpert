import bcrypt from 'bcrypt'
import { initDb } from './migrate'

const DB_PATH = process.env.DATABASE_PATH ?? './data/app.db'
const db = initDb(DB_PATH)

const now = new Date()
const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)

const SALT_ROUNDS = 10

async function seed() {
  console.log('Seeding database...')

  // Create test users
  const passwordHash = await bcrypt.hash('password123', SALT_ROUNDS)
  const adminHash = await bcrypt.hash('adminpass', SALT_ROUNDS)

  const insertUser = db.prepare(
    'INSERT OR IGNORE INTO users (pseudonym, password_hash) VALUES (?, ?)',
  )
  insertUser.run('alice', passwordHash)
  insertUser.run('bob', passwordHash)
  insertUser.run('admin-viewer', adminHash)

  // Question 1: open today (for voting)
  const insertQuestion = db.prepare(`
    INSERT OR IGNORE INTO questions (title, description, option_a, option_b, image_url, deadline)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  const q1 = insertQuestion.run(
    'Coin Flip Challenge',
    'A fair coin is flipped 10 times. Will heads appear more than 5 times?',
    'Yes (>5 heads)',
    'No (≤5 heads)',
    null,
    tomorrow.toISOString(),
  )

  // Question 2: closed and resolved (for history)
  const q2 = db
    .prepare(
      `
    INSERT OR IGNORE INTO questions (title, description, option_a, option_b, deadline, resolved_at, ground_truth)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      'Weather Forecast',
      'Will it rain in Zurich tomorrow?',
      'Yes, it will rain',
      'No, it will stay dry',
      yesterday.toISOString(),
      yesterday.toISOString(),
      'B',
    )

  // Question 3: closed, not yet resolved
  const q3 = insertQuestion.run(
    'Market Prediction',
    'Will the SMI index close higher than today at end of trading day?',
    'Yes, higher',
    'No, same or lower',
    null,
    yesterday.toISOString(),
  )

  // Add votes for alice on resolved question
  const aliceRow = db.prepare('SELECT id FROM users WHERE pseudonym = ?').get('alice') as
    | { id: number }
    | undefined
  const bobRow = db.prepare('SELECT id FROM users WHERE pseudonym = ?').get('bob') as
    | { id: number }
    | undefined

  if (aliceRow && q2.lastInsertRowid) {
    db.prepare(
      `
      INSERT OR IGNORE INTO votes (user_id, question_id, choice, is_correct)
      VALUES (?, ?, ?, ?)
    `,
    ).run(aliceRow.id, q2.lastInsertRowid, 'A', 0)
  }

  if (bobRow && q2.lastInsertRowid) {
    db.prepare(
      `
      INSERT OR IGNORE INTO votes (user_id, question_id, choice, is_correct)
      VALUES (?, ?, ?, ?)
    `,
    ).run(bobRow.id, q2.lastInsertRowid, 'B', 1)
  }

  // Vote on open question
  if (aliceRow && q1.lastInsertRowid) {
    db.prepare(
      `
      INSERT OR IGNORE INTO votes (user_id, question_id, choice)
      VALUES (?, ?, ?)
    `,
    ).run(aliceRow.id, q1.lastInsertRowid, 'A')
  }

  console.log('Seed complete.')
  console.log('Test users: alice / password123, bob / password123')
  console.log(
    `Questions created: open(${q1.lastInsertRowid}), resolved(${q2.lastInsertRowid}), closed(${q3.lastInsertRowid})`,
  )
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})

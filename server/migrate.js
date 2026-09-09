// Applies schema.sql against the configured database. Safe to re-run
// (every statement is CREATE TABLE/INDEX IF NOT EXISTS or plain CREATE INDEX
// guarded by the catch below for repeat runs).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { pool } from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')

const statements = sql
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean)

const run = async () => {
  const conn = await pool.getConnection()
  try {
    for (const stmt of statements) {
      try {
        await conn.query(stmt)
      } catch (err) {
        // Duplicate index/key errors are expected on re-run since MySQL has
        // no "CREATE INDEX IF NOT EXISTS".
        if (err.code === 'ER_DUP_KEYNAME' || err.code === 'ER_DUP_FIELDNAME') continue
        throw err
      }
    }
    console.log('Schema applied.')
  } finally {
    conn.release()
    await pool.end()
  }
}

run().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})

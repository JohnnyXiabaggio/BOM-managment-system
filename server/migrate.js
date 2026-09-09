// Applies schema.sql against the SQLite database file. Safe to re-run —
// every statement is CREATE TABLE/INDEX IF NOT EXISTS.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { db, dbFile } from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')

db.exec(sql)
console.log(`Schema applied to ${dbFile}`)

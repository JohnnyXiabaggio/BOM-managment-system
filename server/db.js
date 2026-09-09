import Database from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import 'dotenv/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dbFile = process.env.DB_FILE
  ? path.resolve(process.cwd(), process.env.DB_FILE)
  : path.join(__dirname, 'data', 'plm_demo.sqlite')

mkdirSync(path.dirname(dbFile), { recursive: true })

export const db = new Database(dbFile)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

export { dbFile }

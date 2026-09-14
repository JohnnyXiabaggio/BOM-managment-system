import mysql from 'mysql2/promise'
import 'dotenv/config'

export const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'plm_app',
  password: process.env.DB_PASSWORD || 'plm_app_pw',
  database: process.env.DB_NAME || 'plm_demo',
  waitForConnections: true,
  connectionLimit: 10,
  // Return DATE/DATETIME as plain strings instead of JS Date objects —
  // avoids timezone-shift surprises when a stored '2026-09-01' comes back
  // as '2026-08-31' depending on the server/client timezone.
  dateStrings: true,
})

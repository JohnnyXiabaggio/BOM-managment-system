import express from 'express'
import cors from 'cors'
import 'dotenv/config'
import { pool } from './db.js'

const app = express()
app.use(cors())
app.use(express.json())

const itemRowToJson = (row) => ({
  id: row.id,
  parent: row.parent_id,
  find: row.find_no,
  pn: row.part_number,
  rev: row.revision,
  name: row.name,
  kind: row.kind,
  qty: Number(row.qty),
  uom: row.uom,
  mb: row.make_buy,
  mass: Number(row.mass_kg),
  cost: Number(row.unit_cost),
  state: row.lifecycle_state,
  eff: row.effective_date || '—',
  owner: row.owner,
  cls: row.classification,
  plant: row.plant,
  supplier: row.supplier,
})

const crRowToJson = (row) => ({
  id: row.id,
  ecoNumber: row.eco_number,
  title: row.title,
  description: row.description,
  itemId: row.item_id,
  partPn: row.part_number,
  partName: row.name,
  priority: row.priority,
  status: row.status,
  submittedBy: row.submitted_by,
  submittedAt: row.submitted_at,
  decidedBy: row.decided_by,
  decidedAt: row.decided_at,
})

const activityRowToJson = (row) => ({
  id: row.id,
  happenedAt: row.happened_at,
  actor: row.actor,
  action: row.action,
  itemId: row.item_id,
  partPn: row.part_number,
  partName: row.name,
  changeRequestId: row.change_request_id,
  ecoNumber: row.eco_number,
  detail: row.detail,
})

// Wraps an async route handler so a rejected promise reaches Express's
// error handler instead of crashing the process.
const h = (fn) => (req, res, next) => fn(req, res, next).catch(next)

app.get('/api/health', (req, res) => res.json({ ok: true }))

app.get(
  '/api/items',
  h(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM items ORDER BY id')
    res.json(rows.map(itemRowToJson))
  }),
)

app.get(
  '/api/items/:id/history',
  h(async (req, res) => {
    const [rows] = await pool.query(
      'SELECT * FROM revision_history WHERE item_id = ? ORDER BY happened_on DESC, id DESC',
      [req.params.id],
    )
    res.json(rows.map((r) => ({ when: r.happened_on, what: r.what, who: r.who })))
  }),
)

const CR_SELECT = `
  SELECT cr.*, i.part_number, i.name
  FROM change_requests cr
  JOIN items i ON i.id = cr.item_id
`

app.get(
  '/api/change-requests',
  h(async (req, res) => {
    const [rows] = await pool.query(`${CR_SELECT} ORDER BY cr.submitted_at DESC, cr.id DESC`)
    res.json(rows.map(crRowToJson))
  }),
)

app.post(
  '/api/change-requests',
  h(async (req, res) => {
    const { itemId, title, description, priority, submittedBy } = req.body || {}
    if (!itemId || !title || !String(title).trim()) {
      return res.status(400).json({ error: 'itemId and title are required' })
    }
    const [[item]] = await pool.query('SELECT id FROM items WHERE id = ?', [itemId])
    if (!item) return res.status(404).json({ error: `Unknown item "${itemId}"` })

    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM change_requests')
    const ecoNumber = `ECO-${4471 + n + 1}`
    const by = submittedBy || 'M. Reyes'

    const [result] = await pool.query(
      `INSERT INTO change_requests
        (eco_number, title, description, item_id, priority, status, submitted_by, submitted_at)
       VALUES (?, ?, ?, ?, ?, 'submitted', ?, NOW())`,
      [ecoNumber, String(title).trim(), description || null, itemId, priority || 'Normal', by],
    )
    await pool.query(
      `INSERT INTO activity_log (actor, action, item_id, change_request_id, detail)
       VALUES (?, 'cr_submitted', ?, ?, ?)`,
      [by, itemId, result.insertId, `Submitted ${ecoNumber} — ${String(title).trim()}`],
    )

    const [[row]] = await pool.query(`${CR_SELECT} WHERE cr.id = ?`, [result.insertId])
    res.status(201).json(crRowToJson(row))
  }),
)

app.patch(
  '/api/change-requests/:id',
  h(async (req, res) => {
    const { status, decidedBy } = req.body || {}
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'status must be "approved" or "rejected"' })
    }
    const [[existing]] = await pool.query(`${CR_SELECT} WHERE cr.id = ?`, [req.params.id])
    if (!existing) return res.status(404).json({ error: 'Change request not found' })
    if (existing.status !== 'submitted') {
      return res.status(409).json({ error: `Change request is already ${existing.status}` })
    }

    const by = decidedBy || 'M. Reyes'
    await pool.query(
      'UPDATE change_requests SET status = ?, decided_by = ?, decided_at = NOW() WHERE id = ?',
      [status, by, req.params.id],
    )
    await pool.query(
      `INSERT INTO activity_log (actor, action, item_id, change_request_id, detail)
       VALUES (?, ?, ?, ?, ?)`,
      [
        by,
        status === 'approved' ? 'cr_approved' : 'cr_rejected',
        existing.item_id,
        existing.id,
        `${status === 'approved' ? 'Approved' : 'Rejected'} ${existing.eco_number} — ${existing.title}`,
      ],
    )

    const [[row]] = await pool.query(`${CR_SELECT} WHERE cr.id = ?`, [req.params.id])
    res.json(crRowToJson(row))
  }),
)

app.get(
  '/api/activity',
  h(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500)
    const [rows] = await pool.query(
      `SELECT a.*, i.part_number, i.name, cr.eco_number
       FROM activity_log a
       LEFT JOIN items i ON i.id = a.item_id
       LEFT JOIN change_requests cr ON cr.id = a.change_request_id
       ORDER BY a.happened_at DESC, a.id DESC
       LIMIT ?`,
      [limit],
    )
    res.json(rows.map(activityRowToJson))
  }),
)

app.use((err, req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
})

const port = Number(process.env.API_PORT || 4000)
app.listen(port, () => {
  console.log(`PLM API listening on http://localhost:${port}`)
})

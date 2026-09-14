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

// Thrown by handlers and helpers to answer with a specific status; anything
// else reaching the error handler is a 500.
class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/** Runs `fn` inside a transaction, rolling back if it throws. */
const tx = async (fn) => {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const out = await fn(conn)
    await conn.commit()
    return out
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

const parseLimit = (raw, fallback, max) => {
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'limit must be a positive integer')
  return Math.min(n, max)
}

// The editable item columns, keyed by the JSON field names the client uses.
// `revision` is absent on purpose: revisions move through POST /revise.
const ITEM_FIELDS = [
  { key: 'find', col: 'find_no', label: 'Find number', kind: 'text', max: 10 },
  { key: 'pn', col: 'part_number', label: 'Part number', kind: 'text', max: 20, required: true },
  { key: 'name', col: 'name', label: 'Name', kind: 'text', max: 120, required: true },
  { key: 'kind', col: 'kind', label: 'Type', kind: 'enum', values: ['asm', 'part'] },
  { key: 'qty', col: 'qty', label: 'Qty', kind: 'number', min: 0 },
  { key: 'uom', col: 'uom', label: 'UOM', kind: 'text', max: 10 },
  { key: 'mb', col: 'make_buy', label: 'Make/buy', kind: 'enum', values: ['Make', 'Buy'] },
  { key: 'mass', col: 'mass_kg', label: 'Mass kg', kind: 'number', min: 0 },
  { key: 'cost', col: 'unit_cost', label: 'Unit cost', kind: 'number', min: 0 },
  { key: 'state', col: 'lifecycle_state', label: 'State', kind: 'enum', values: ['rel', 'wip', 'rev', 'obs'] },
  { key: 'eff', col: 'effective_date', label: 'Effective', kind: 'date' },
  { key: 'owner', col: 'owner', label: 'Owner', kind: 'text', max: 80 },
  { key: 'cls', col: 'classification', label: 'Classification', kind: 'text', max: 120 },
  { key: 'plant', col: 'plant', label: 'Plant', kind: 'text', max: 80 },
  { key: 'supplier', col: 'supplier', label: 'Supplier', kind: 'text', max: 120 },
]

const FIELD_BY_COL = Object.fromEntries(ITEM_FIELDS.map((f) => [f.col, f]))

/**
 * True when a stored value and an incoming one differ. Numbers need a
 * numeric comparison because MySQL hands DECIMAL columns back as strings
 * ("6.000"), which never string-matches the "6" a client sends.
 */
const fieldChanged = (field, before, after) =>
  field.kind === 'number'
    ? Number(before) !== Number(after)
    : String(before ?? '') !== String(after ?? '')

const showValue = (field, value) => {
  if (value === null || value === undefined || value === '') return '—'
  return field.kind === 'number' ? String(Number(value)) : String(value)
}

const CREATE_DEFAULTS = {
  find: '',
  kind: 'part',
  qty: 1,
  uom: 'EA',
  mb: 'Make',
  mass: 0,
  cost: 0,
  state: 'wip',
  eff: null,
  cls: '',
  plant: '',
  supplier: '—',
}

function coerceField(field, raw) {
  if (field.kind === 'text') {
    const v = String(raw ?? '').trim()
    if (field.required && !v) throw new HttpError(400, `"${field.key}" is required`)
    if (v.length > field.max) throw new HttpError(400, `"${field.key}" must be at most ${field.max} characters`)
    return v
  }
  if (field.kind === 'number') {
    const v = Number(raw)
    if (!Number.isFinite(v)) throw new HttpError(400, `"${field.key}" must be a number`)
    if (v < field.min) throw new HttpError(400, `"${field.key}" must be at least ${field.min}`)
    return v
  }
  if (field.kind === 'enum') {
    if (!field.values.includes(raw)) {
      throw new HttpError(400, `"${field.key}" must be one of ${field.values.join(', ')}`)
    }
    return raw
  }
  // date
  if (raw === null || raw === undefined || raw === '' || raw === '—') return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) {
    throw new HttpError(400, `"${field.key}" must be an ISO date (YYYY-MM-DD) or empty`)
  }
  return String(raw)
}

/**
 * Validates an item payload into `{ column: value }` pairs. With
 * `partial`, only the keys actually present are read, so PATCH can send
 * a subset; otherwise missing keys fall back to CREATE_DEFAULTS.
 */
function readItemFields(body, { partial }) {
  const out = {}
  for (const field of ITEM_FIELDS) {
    const present = Object.prototype.hasOwnProperty.call(body, field.key)
    if (partial) {
      if (present) out[field.col] = coerceField(field, body[field.key])
      continue
    }
    if (present) out[field.col] = coerceField(field, body[field.key])
    else if (field.required) throw new HttpError(400, `"${field.key}" is required`)
    else out[field.col] = CREATE_DEFAULTS[field.key]
  }
  return out
}

const slugify = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 16)

/** Derives a short, unused primary key for a new item from its part number. */
async function freeItemId(conn, partNumber) {
  const base = slugify(partNumber) || 'item'
  for (let n = 1; n <= 99; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`
    const [[taken]] = await conn.query('SELECT id FROM items WHERE id = ?', [candidate])
    if (!taken) return candidate
  }
  throw new HttpError(409, `Couldn't derive a free id for "${partNumber}"`)
}

/** `/A` -> `/B`, `/Z` -> `/AA`, `01` -> `02`. */
function nextRevision(rev) {
  const m = /^(.*?)(\d+|[A-Za-z])$/.exec(rev || '')
  if (!m) return '/B'
  const [, prefix, tail] = m
  if (/^\d+$/.test(tail)) return prefix + String(Number(tail) + 1).padStart(tail.length, '0')
  const isUpper = tail === tail.toUpperCase()
  if (tail.toUpperCase() === 'Z') return prefix + (isUpper ? 'AA' : 'aa')
  const bumped = String.fromCharCode(tail.toUpperCase().charCodeAt(0) + 1)
  return prefix + (isUpper ? bumped : bumped.toLowerCase())
}

const actorOf = (body) => {
  const raw = String(body?.actor || '').trim()
  if (raw.length > 80) throw new HttpError(400, '"actor" must be at most 80 characters')
  return raw || 'M. Reyes'
}

const logActivity = (conn, { actor, action, itemId, crId = null, detail }) =>
  conn.query(
    `INSERT INTO activity_log (actor, action, item_id, change_request_id, detail)
     VALUES (?, ?, ?, ?, ?)`,
    [actor, action, itemId, crId, clip(detail, 300)],
  )

const logHistory = (conn, { itemId, revision, what, who }) =>
  conn.query(
    'INSERT INTO revision_history (item_id, revision, happened_on, what, who) VALUES (?, ?, CURDATE(), ?, ?)',
    [itemId, revision, clip(what, 200), who],
  )

const loadItem = async (conn, id) => {
  const [[row]] = await conn.query('SELECT * FROM items WHERE id = ?', [id])
  if (!row) throw new HttpError(404, `Unknown item "${id}"`)
  return row
}

app.get('/api/health', (req, res) => res.json({ ok: true }))

app.get(
  '/api/items',
  h(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM items ORDER BY id')
    res.json(rows.map(itemRowToJson))
  }),
)

// SQL-backed search across the fields an engineer would recognise a part
// by, with optional lifecycle / make-buy / kind narrowing.
app.get(
  '/api/items/search',
  h(async (req, res) => {
    const q = String(req.query.q || '').trim()
    const limit = parseLimit(req.query.limit, 50, 200)

    const where = []
    const params = []

    if (q) {
      // Escape the LIKE wildcards so a literal % or _ in the query matches itself.
      const needle = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
      where.push('(part_number LIKE ? OR name LIKE ? OR classification LIKE ? OR supplier LIKE ?)')
      params.push(needle, needle, needle, needle)
    }

    const inFilter = (raw, column, allowed, label) => {
      const values = String(raw || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (!values.length) return
      const bad = values.find((v) => !allowed.includes(v))
      if (bad) throw new HttpError(400, `"${label}" must be one of ${allowed.join(', ')}`)
      where.push(`${column} IN (${values.map(() => '?').join(',')})`)
      params.push(...values)
    }
    inFilter(req.query.state, 'lifecycle_state', ['rel', 'wip', 'rev', 'obs'], 'state')
    inFilter(req.query.mb, 'make_buy', ['Make', 'Buy'], 'mb')
    inFilter(req.query.kind, 'kind', ['asm', 'part'], 'kind')

    const [rows] = await pool.query(
      `SELECT * FROM items
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY part_number
       LIMIT ?`,
      [...params, limit],
    )
    res.json(rows.map(itemRowToJson))
  }),
)

app.get(
  '/api/items/:id/history',
  h(async (req, res) => {
    await loadItem(pool, req.params.id)
    const [rows] = await pool.query(
      'SELECT * FROM revision_history WHERE item_id = ? ORDER BY happened_on DESC, id DESC',
      [req.params.id],
    )
    res.json(rows.map((r) => ({ when: r.happened_on, rev: r.revision, what: r.what, who: r.who })))
  }),
)

// Create — adds a new part or sub-assembly under an existing parent.
app.post(
  '/api/items',
  h(async (req, res) => {
    const body = req.body || {}
    const actor = actorOf(body)
    const parentId = String(body.parent || '').trim()
    if (!parentId) throw new HttpError(400, '"parent" is required — new items are added under an assembly')

    const set = readItemFields(body, { partial: false })
    const revision = coerceField({ key: 'rev', kind: 'text', max: 5, required: true }, body.rev || '/A')
    if (!set.owner) set.owner = actor

    const item = await tx(async (conn) => {
      const parent = await loadItem(conn, parentId)
      const id = await freeItemId(conn, set.part_number)

      await conn.query(
        `INSERT INTO items
          (id, parent_id, find_no, part_number, revision, name, kind, qty, uom,
           make_buy, mass_kg, unit_cost, lifecycle_state, effective_date,
           owner, classification, plant, supplier)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, parentId, set.find_no, set.part_number, revision, set.name, set.kind,
          set.qty, set.uom, set.make_buy, set.mass_kg, set.unit_cost,
          set.lifecycle_state, set.effective_date, set.owner, set.classification,
          set.plant, set.supplier,
        ],
      )

      // A parent that now has children is an assembly, whatever it was seeded as.
      if (parent.kind !== 'asm') {
        await conn.query("UPDATE items SET kind = 'asm' WHERE id = ?", [parentId])
      }

      await logHistory(conn, {
        itemId: id,
        revision,
        what: `Item created at revision ${revision} under ${parent.part_number}`,
        who: actor,
      })
      await logActivity(conn, {
        actor,
        action: 'item_created',
        itemId: id,
        detail: `Created ${set.part_number} ${revision} — ${set.name} under ${parent.part_number}`,
      })

      return loadItem(conn, id)
    })

    res.status(201).json(itemRowToJson(item))
  }),
)

// Modify — updates the editable attributes of an existing item.
app.patch(
  '/api/items/:id',
  h(async (req, res) => {
    const body = req.body || {}
    const actor = actorOf(body)
    const set = readItemFields(body, { partial: true })
    const cols = Object.keys(set)
    if (!cols.length) throw new HttpError(400, 'No editable fields supplied')

    const item = await tx(async (conn) => {
      const existing = await loadItem(conn, req.params.id)

      const changes = cols
        .filter((col) => fieldChanged(FIELD_BY_COL[col], existing[col], set[col]))
        .map((col) => {
          const field = FIELD_BY_COL[col]
          return `${field.label} ${showValue(field, existing[col])} → ${showValue(field, set[col])}`
        })
      if (!changes.length) return existing

      await conn.query(`UPDATE items SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [
        ...cols.map((c) => set[c]),
        req.params.id,
      ])

      const summary = changes.join(', ')
      await logHistory(conn, {
        itemId: req.params.id,
        revision: existing.revision,
        what: `Modified ${summary}`,
        who: actor,
      })
      await logActivity(conn, {
        actor,
        action: 'item_modified',
        itemId: req.params.id,
        detail: `Modified ${existing.part_number} ${existing.revision} — ${summary}`,
      })

      return loadItem(conn, req.params.id)
    })

    res.json(itemRowToJson(item))
  }),
)

// Revise — bumps the item to a new working revision, which is no longer
// effective until it is released again.
app.post(
  '/api/items/:id/revise',
  h(async (req, res) => {
    const body = req.body || {}
    const actor = actorOf(body)
    const note = String(body.note || '').trim()

    const item = await tx(async (conn) => {
      const existing = await loadItem(conn, req.params.id)
      const revision = body.revision
        ? coerceField({ key: 'revision', kind: 'text', max: 5, required: true }, body.revision)
        : nextRevision(existing.revision)
      if (revision === existing.revision) {
        throw new HttpError(409, `Item is already at revision ${revision}`)
      }

      await conn.query(
        "UPDATE items SET revision = ?, lifecycle_state = 'wip', effective_date = NULL WHERE id = ?",
        [revision, req.params.id],
      )

      const reason = note ? ` — ${note}` : ''
      await logHistory(conn, {
        itemId: req.params.id,
        revision,
        what: `Revised ${existing.revision} → ${revision}${reason}`,
        who: actor,
      })
      await logActivity(conn, {
        actor,
        action: 'item_revised',
        itemId: req.params.id,
        detail: `Revised ${existing.part_number} ${existing.revision} → ${revision}${reason}`,
      })

      return loadItem(conn, req.params.id)
    })

    res.json(itemRowToJson(item))
  }),
)

// Delete — removes a leaf item. Its audit trail is kept: activity rows are
// detached from the deleted row rather than deleted with it.
app.delete(
  '/api/items/:id',
  h(async (req, res) => {
    const actor = actorOf(req.query)

    const removed = await tx(async (conn) => {
      const existing = await loadItem(conn, req.params.id)
      if (!existing.parent_id) throw new HttpError(409, 'The top-level item cannot be deleted')

      const [kids] = await conn.query('SELECT id FROM items WHERE parent_id = ?', [req.params.id])
      if (kids.length) {
        throw new HttpError(409, `Item has ${kids.length} child line(s) — delete those first`)
      }

      await conn.query(
        `UPDATE activity_log SET change_request_id = NULL
         WHERE change_request_id IN (SELECT id FROM change_requests WHERE item_id = ?)`,
        [req.params.id],
      )
      await conn.query('UPDATE activity_log SET item_id = NULL WHERE item_id = ?', [req.params.id])
      await conn.query('DELETE FROM change_requests WHERE item_id = ?', [req.params.id])
      await conn.query('DELETE FROM revision_history WHERE item_id = ?', [req.params.id])
      await conn.query('DELETE FROM items WHERE id = ?', [req.params.id])

      await logActivity(conn, {
        actor,
        action: 'item_deleted',
        itemId: null,
        detail: `Deleted ${existing.part_number} ${existing.revision} — ${existing.name}`,
      })

      return existing
    })

    res.json({
      deleted: removed.id,
      pn: removed.part_number,
      rev: removed.revision,
      name: removed.name,
      parent: removed.parent_id,
    })
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
    const limit = parseLimit(req.query.limit, 100, 500)
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
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message })
  }
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
})

const port = Number(process.env.API_PORT || 4000)
app.listen(port, () => {
  console.log(`PLM API listening on http://localhost:${port}`)
})

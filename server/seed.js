// Populates `items` and `revision_history` from seed-data.js. Safe to
// re-run: it truncates the demo tables first (change_requests and
// activity_log too, since they reference items) so the dataset is
// always in a known state.
import { pool } from './db.js'
import { KEYS, ROWS } from './seed-data.js'

const asRow = (arr) => Object.fromEntries(KEYS.map((k, i) => [k, arr[i]]))

const run = async () => {
  const conn = await pool.getConnection()
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0')
    await conn.query('TRUNCATE TABLE activity_log')
    await conn.query('TRUNCATE TABLE change_requests')
    await conn.query('TRUNCATE TABLE revision_history')
    await conn.query('TRUNCATE TABLE items')
    await conn.query('SET FOREIGN_KEY_CHECKS = 1')

    const items = ROWS.map(asRow)

    for (const it of items) {
      await conn.query(
        `INSERT INTO items
          (id, parent_id, find_no, part_number, revision, name, kind, qty, uom,
           make_buy, mass_kg, unit_cost, lifecycle_state, effective_date,
           owner, classification, plant, supplier)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          it.id, it.parent, it.find, it.pn, it.rev, it.name, it.kind, it.qty,
          it.uom, it.mb, it.mass, it.cost, it.state,
          it.eff === '—' ? null : it.eff,
          it.owner, it.cls, it.plant, it.supplier,
        ],
      )
    }

    for (const it of items) {
      const history = [{ happened_on: '2026-07-02', what: 'Item created from template', who: 'M. Reyes' }]
      if (it.eff !== '—') {
        history.push({ happened_on: it.eff, what: `Revision ${it.rev} released`, who: it.owner })
      }
      if (it.state === 'wip' || it.state === 'rev') {
        history.push({ happened_on: '2026-08-24', what: 'Structure line quantities revised', who: it.owner })
      }
      for (const h of history) {
        await conn.query(
          'INSERT INTO revision_history (item_id, happened_on, what, who) VALUES (?, ?, ?, ?)',
          [it.id, h.happened_on, h.what, h.who],
        )
      }
    }

    console.log(`Seeded ${items.length} items and their revision history.`)
  } finally {
    conn.release()
    await pool.end()
  }
}

run().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})

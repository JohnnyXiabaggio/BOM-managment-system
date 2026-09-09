// Populates `items` and `revision_history` from seed-data.js. Safe to
// re-run: it deletes the demo tables first (change_requests and
// activity_log too, since they reference items) so the dataset is
// always in a known state.
import { db, dbFile } from './db.js'
import { KEYS, ROWS } from './seed-data.js'

const asRow = (arr) => Object.fromEntries(KEYS.map((k, i) => [k, arr[i]]))

const insertItem = db.prepare(`
  INSERT INTO items
    (id, parent_id, find_no, part_number, revision, name, kind, qty, uom,
     make_buy, mass_kg, unit_cost, lifecycle_state, effective_date,
     owner, classification, plant, supplier)
  VALUES (@id, @parent, @find, @pn, @rev, @name, @kind, @qty, @uom,
          @mb, @mass, @cost, @state, @eff, @owner, @cls, @plant, @supplier)
`)

const insertHistory = db.prepare(`
  INSERT INTO revision_history (item_id, happened_on, what, who) VALUES (?, ?, ?, ?)
`)

const seed = db.transaction((items) => {
  db.prepare('DELETE FROM activity_log').run()
  db.prepare('DELETE FROM change_requests').run()
  db.prepare('DELETE FROM revision_history').run()
  db.prepare('DELETE FROM items').run()
  db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('change_requests','revision_history','activity_log')").run()

  for (const it of items) {
    insertItem.run({ ...it, eff: it.eff === '—' ? null : it.eff })
  }

  for (const it of items) {
    const history = [{ happened_on: '2026-07-02', what: 'Item created from template', who: 'M. Reyes' }]
    if (it.eff !== '—') {
      history.push({ happened_on: it.eff, what: `Revision ${it.rev} released`, who: it.owner })
    }
    if (it.state === 'wip' || it.state === 'rev') {
      history.push({ happened_on: '2026-08-24', what: 'Structure line quantities revised', who: it.owner })
    }
    for (const h of history) insertHistory.run(it.id, h.happened_on, h.what, h.who)
  }
})

const items = ROWS.map(asRow)
seed(items)
console.log(`Seeded ${items.length} items and their revision history into ${dbFile}`)

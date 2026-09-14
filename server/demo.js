// A scripted, repeatable demonstration of the PLM workflow end to end
// against the live API (and therefore MySQL): search the BOM, create a
// part, modify it, revise it, run a change request over it, and delete
// it again — printing the audit trail the database recorded along the way.
// Run with the API server already up: `npm run server` in one terminal,
// then `npm run demo` in another.
import 'dotenv/config'

const base = `http://localhost:${process.env.API_PORT || 4000}`

let stepNo = 0
const step = (title) => console.log(`\n\x1b[1m[${++stepNo}] ${title}\x1b[0m`)
const line = (label, value) => console.log(`    ${label}: ${value}`)

async function api(path, options) {
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`${options?.method || 'GET'} ${path} -> ${res.status}: ${body?.error || res.statusText}`)
  return body
}

/** Runs a call that is supposed to be refused and reports the refusal. */
async function expectRefusal(label, path, options) {
  try {
    await api(path, options)
    console.log(`    ${label}: UNEXPECTED — the call succeeded`)
  } catch (err) {
    line(label, err.message)
  }
}

async function main() {
  console.log('PLM demo — BOM management workflow, backed by MySQL')
  console.log(`API: ${base}`)

  step('Check the API is up')
  await api('/api/health')
  console.log('    OK')

  step('Load the product structure')
  const items = await api('/api/items')
  const parent = items.find((it) => it.id === 'cma')
  line('Items loaded', items.length)
  line('Target assembly', `${parent.pn} ${parent.rev} — ${parent.name}`)

  step('Search the items table for cell hardware (SQL LIKE + filters)')
  const found = await api('/api/items/search?q=cell&state=rel&mb=Buy')
  found.forEach((it) => line(it.pn, `${it.rev} ${it.name} — ${it.supplier}`))

  step('Create a new part under the module assembly')
  const created = await api('/api/items', {
    method: 'POST',
    body: JSON.stringify({
      parent: parent.id,
      find: '10.3',
      pn: 'SNS-21300',
      name: 'Module Temperature Sensor',
      kind: 'part',
      qty: 4,
      uom: 'EA',
      mb: 'Buy',
      mass: 0.04,
      cost: 11.25,
      state: 'wip',
      owner: 'L. Novak',
      cls: 'PWT / ESS / Sensor',
      plant: 'Supplier DC',
      supplier: 'Nihon Cell Co.',
      actor: 'L. Novak',
    }),
  })
  line('Created', `${created.pn} ${created.rev} — ${created.name} (id ${created.id})`)
  line('Placed under', `${parent.pn} at find number ${created.find}`)

  step('The new part is now findable by search')
  const hits = await api('/api/items/search?q=temperature')
  hits.forEach((it) => line(it.pn, `${it.rev} ${it.name} — ${it.state}`))

  step('Modify it — quantity and cost were wrong')
  const modified = await api(`/api/items/${created.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ qty: 6, cost: 9.8, actor: 'L. Novak' }),
  })
  line('Qty', `${created.qty} → ${modified.qty}`)
  line('Unit cost', `${created.cost} → ${modified.cost}`)

  step('Revise it to the next revision')
  const revised = await api(`/api/items/${created.id}/revise`, {
    method: 'POST',
    body: JSON.stringify({ note: 'Thermistor tolerance tightened to ±0.5 K', actor: 'L. Novak' }),
  })
  line('Revision', `${modified.rev} → ${revised.rev}`)
  line('Lifecycle', `${revised.state} (a new revision is not effective until released)`)
  await expectRefusal('Revising to the same revision is refused', `/api/items/${created.id}/revise`, {
    method: 'POST',
    body: JSON.stringify({ revision: revised.rev }),
  })

  step("The part's revision history, straight from the database")
  const history = await api(`/api/items/${created.id}/history`)
  history.forEach((h) => line(`${h.when} ${h.rev}`, `${h.what} · ${h.who}`))

  step('Raise a change request to get the new revision released')
  const cr = await api('/api/change-requests', {
    method: 'POST',
    body: JSON.stringify({
      itemId: created.id,
      title: `Release ${created.pn} ${revised.rev}`,
      description: 'New sensor line item, reviewed with the supplier.',
      priority: 'High',
      submittedBy: 'L. Novak',
    }),
  })
  line('Created', `${cr.ecoNumber} — "${cr.title}"`)
  line('Status', cr.status)

  step('Worklist now shows it as pending decision')
  const openCrs = (await api('/api/change-requests')).filter((c) => c.status === 'submitted')
  line('Open change requests', openCrs.length)
  openCrs.slice(0, 5).forEach((c) => line(c.ecoNumber, `${c.title} (${c.partPn})`))

  step('Approve the change request')
  const approved = await api(`/api/change-requests/${cr.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'approved', decidedBy: 'K. Ito' }),
  })
  line('Status', `${approved.status} by ${approved.decidedBy} at ${approved.decidedAt}`)
  await expectRefusal('Deciding it twice is refused', `/api/change-requests/${cr.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'rejected' }),
  })

  step('Release the revision by modifying its state and effectivity')
  const released = await api(`/api/items/${created.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ state: 'rel', eff: '2026-10-01', actor: 'K. Ito' }),
  })
  line('Lifecycle', `${released.state} effective ${released.eff}`)

  step('Structure integrity is enforced by the database')
  await expectRefusal('Deleting an assembly with children', `/api/items/${parent.id}`, { method: 'DELETE' })
  await expectRefusal('Deleting the top-level item', '/api/items/root', { method: 'DELETE' })

  step('Delete the part again, so this demo can be re-run')
  const deleted = await api(`/api/items/${created.id}?actor=L.%20Novak`, { method: 'DELETE' })
  line('Deleted', `${deleted.pn} ${deleted.rev} — ${deleted.name}`)
  await expectRefusal('It is really gone', `/api/items/${created.id}/history`)

  step('The activity log holds the whole trail')
  const activity = await api('/api/activity?limit=12')
  activity.reverse().forEach((a) => line(`${a.happenedAt} ${a.actor}`, a.detail))

  console.log(
    '\nDone. Every line above was a real MySQL read or write. Run `npm run db:seed` to reset the dataset,',
  )
  console.log('or open the app and repeat the same steps from the Structure screen.')
}

main().catch((err) => {
  console.error('\nDemo failed:', err.message)
  console.error('Is the API running? Try `npm run server` in another terminal first.')
  process.exit(1)
})

// A scripted, repeatable demonstration of the PLM workflow end to end
// against the live API (and therefore MySQL): pick a part, submit a
// change request, approve it, and show the resulting activity trail.
// Run with the API server already up: `npm run server` in one terminal,
// then `npm run demo` in another.
import 'dotenv/config'

const base = `http://localhost:${process.env.API_PORT || 4000}`

const step = (n, title) => console.log(`\n\x1b[1m[${n}] ${title}\x1b[0m`)
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

async function main() {
  console.log('PLM demo — Structure Explorer workflow, backed by MySQL')
  console.log(`API: ${base}`)

  step(1, 'Check the API is up')
  await api('/api/health')
  console.log('    OK')

  step(2, 'Load the product structure')
  const items = await api('/api/items')
  const target = items.find((it) => it.id === 'bus')
  line('Items loaded', items.length)
  line('Target part', `${target.pn} ${target.rev} — ${target.name} (state: ${target.state})`)

  step(3, "Check the part's revision history before any change")
  const historyBefore = await api(`/api/items/${target.id}/history`)
  historyBefore.forEach((h) => line(h.when, `${h.what} · ${h.who}`))

  step(4, 'Submit a change request against it')
  const cr = await api('/api/change-requests', {
    method: 'POST',
    body: JSON.stringify({
      itemId: target.id,
      title: 'Swap busbar material to reduce mass',
      description: 'Copper to aluminum for cost and mass reduction.',
      priority: 'High',
      submittedBy: 'M. Reyes',
    }),
  })
  line('Created', `${cr.ecoNumber} — "${cr.title}"`)
  line('Status', cr.status)

  step(5, 'Worklist now shows it as pending decision')
  const openCrs = (await api('/api/change-requests')).filter((c) => c.status === 'submitted')
  line('Open change requests', openCrs.length)
  openCrs.slice(0, 5).forEach((c) => line(c.ecoNumber, `${c.title} (${c.partPn})`))

  step(6, 'Approve the change request')
  const approved = await api(`/api/change-requests/${cr.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'approved', decidedBy: 'K. Ito' }),
  })
  line('Status', `${approved.status} by ${approved.decidedBy} at ${approved.decidedAt}`)

  step(7, 'Rejecting it again should now be refused (already decided)')
  try {
    await api(`/api/change-requests/${cr.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'rejected' }) })
    console.log('    Unexpected: this should have failed')
  } catch (err) {
    line('Refused as expected', err.message)
  }

  step(8, 'The activity log now shows the full audit trail')
  const activity = await api('/api/activity?limit=5')
  activity.forEach((a) => line(a.happenedAt, `${a.actor} — ${a.detail}`))

  console.log('\nDone. Everything above is a real MySQL write — re-run `npm run db:seed` to reset, or `npm run demo` again to add another change request.')
}

main().catch((err) => {
  console.error('\nDemo failed:', err.message)
  console.error('Is the API running? Try `npm run server` in another terminal first.')
  process.exit(1)
})

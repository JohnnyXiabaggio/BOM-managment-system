import { useMemo, useState, type MouseEvent } from 'react'
import {
  ITEMS,
  STATE_LABEL,
  chainOf,
  kidsOf,
  rollupMass,
  type LifecycleState,
} from '../data/structure'

type TabKey = 'props' | 'where' | 'files' | 'history'

interface TreeRow {
  id: string
  pn: string
  rev: string
  name: string
  depth: number
  selected: boolean
  hasKids: boolean
  open: boolean
}

interface BomRow {
  id: string
  find: string
  pn: string
  rev: string
  name: string
  qty: number
  uom: string
  mb: string
  mass: string
  cost: string
  state: LifecycleState
  eff: string
  owner: string
  depth: number
  selected: boolean
  hasKids: boolean
  open: boolean
}

function StateBadge({ state, label }: { state: LifecycleState; label: string }) {
  return <span className={`plm-st ${state}`}>{label}</span>
}

function matchesFilter(id: string, needle: string): boolean {
  const it = ITEMS[id]
  return it.pn.toLowerCase().includes(needle) || it.name.toLowerCase().includes(needle)
}

/** ids of every node that must stay visible/expanded to surface a filter match */
function filterVisibility(needle: string): { visible: Set<string>; forceOpen: Set<string> } {
  const visible = new Set<string>()
  const forceOpen = new Set<string>()
  const walk = (id: string, ancestors: string[]): boolean => {
    const kids = kidsOf(id)
    let selfOrDescendantMatches = matchesFilter(id, needle)
    kids.forEach((k) => {
      if (walk(k, [...ancestors, id])) selfOrDescendantMatches = true
    })
    if (selfOrDescendantMatches) {
      visible.add(id)
      ancestors.forEach((a) => {
        visible.add(a)
        forceOpen.add(a)
      })
    }
    return selfOrDescendantMatches
  }
  walk('root', [])
  return { visible, forceOpen }
}

export default function StructureExplorer() {
  const [open, setOpen] = useState<Record<string, boolean>>({ root: true, hvb: true, cma: true })
  const [sel, setSel] = useState('hvb')
  const [root, setRoot] = useState('hvb')
  const [tab, setTab] = useState<TabKey>('props')
  const [treeFilter, setTreeFilter] = useState('')

  const toggle = (id: string) => {
    setOpen((prev) => {
      const next = { ...prev }
      if (next[id]) delete next[id]
      else next[id] = true
      return next
    })
  }

  const pick = (id: string) => {
    const hasKids = kidsOf(id).length > 0
    setSel(id)
    setRoot(hasKids ? id : ITEMS[id].parent || id)
    if (hasKids) setOpen((prev) => ({ ...prev, [id]: true }))
  }

  const needle = treeFilter.trim().toLowerCase()
  const filtered = useMemo(() => (needle ? filterVisibility(needle) : null), [needle])

  const treeRows = useMemo<TreeRow[]>(() => {
    const rows: TreeRow[] = []
    const walk = (id: string, depth: number) => {
      if (filtered && !filtered.visible.has(id)) return
      const kids = kidsOf(id)
      const isOpen = filtered ? filtered.forceOpen.has(id) || !!open[id] : !!open[id]
      const it = ITEMS[id]
      rows.push({
        id,
        pn: it.pn,
        rev: it.rev,
        name: it.name,
        depth,
        selected: sel === id,
        hasKids: kids.length > 0,
        open: isOpen,
      })
      if (isOpen) kids.forEach((k) => walk(k, depth + 1))
    }
    walk('root', 0)
    return rows
  }, [open, sel, filtered])

  const bomRows = useMemo<BomRow[]>(() => {
    const rows: BomRow[] = []
    const addLines = (id: string, depth: number) => {
      kidsOf(id).forEach((k) => {
        const it = ITEMS[k]
        const kids = kidsOf(k)
        const isOpen = !!open[k]
        rows.push({
          id: k,
          find: it.find,
          pn: it.pn,
          rev: it.rev,
          name: it.name,
          qty: it.qty,
          uom: it.uom,
          mb: it.mb,
          mass: it.mass.toFixed(2),
          cost: it.cost ? it.cost.toFixed(2) : '—',
          state: it.state,
          eff: it.eff,
          owner: it.owner,
          depth,
          selected: sel === k,
          hasKids: kids.length > 0,
          open: isOpen,
        })
        if (isOpen) addLines(k, depth + 1)
      })
    }
    addLines(root, 0)
    return rows
  }, [root, open, sel])

  const selItem = ITEMS[sel]
  const rootItem = ITEMS[root]
  const crumbs = chainOf(root)
  const parent = selItem.parent ? ITEMS[selItem.parent] : null
  const selHasKids = kidsOf(sel).length > 0
  const nextRev = String.fromCharCode(selItem.rev.charCodeAt(1) + 1)

  const propGroups = [
    {
      title: 'Identification',
      rows: [
        { k: 'Item type', v: selHasKids ? 'Design Assembly' : 'Design Part' },
        { k: 'Classification', v: selItem.cls },
        { k: 'Program', v: 'VP2 · D-Segment BEV' },
        { k: 'Find number', v: selItem.find || '—' },
      ],
    },
    {
      title: 'Lifecycle',
      rows: [
        { k: 'Revision', v: `${selItem.rev} · ${STATE_LABEL[selItem.state]}` },
        { k: 'Next revision', v: `/${nextRev} · in work (ECO-4471)` },
        { k: 'Effectivity', v: selItem.eff === '—' ? 'not effective' : `${selItem.eff} → open` },
        { k: 'Owner', v: selItem.owner },
      ],
    },
    {
      title: 'Manufacturing',
      rows: [
        { k: 'Make / buy', v: `${selItem.mb} · ${selItem.plant}` },
        { k: 'Quantity per', v: `${selItem.qty} ${selItem.uom}` },
        { k: 'Unit mass', v: `${selItem.mass.toFixed(2)} kg` },
        { k: 'Rolled-up mass', v: `${rollupMass(sel).toFixed(2)} kg` },
        { k: 'Unit cost', v: selItem.cost ? selItem.cost.toFixed(2) : '—' },
        { k: 'Supplier', v: selItem.supplier },
      ],
    },
  ]

  const base = selItem.pn + selItem.rev.replace('/', '_')
  const files = [
    { ext: 'JT', name: `${base}.jt`, size: '41.2 MB' },
    { ext: 'DRW', name: `${base}_sheet1.pdf`, size: '2.1 MB' },
    { ext: 'XLS', name: `${selItem.pn}_mass_rollup.xlsx`, size: '318 KB' },
  ]
  const history = [
    { when: '2026-08-24', what: `Revision ${selItem.rev} released`, who: selItem.owner },
    { when: '2026-08-11', what: 'Change ECO-4471 attached', who: 'Change board' },
    { when: '2026-07-30', what: 'Structure line quantities revised', who: selItem.owner },
    { when: '2026-07-02', what: 'Item created from template', who: 'M. Reyes' },
  ]
  const whereUsed = parent
    ? [{ pn: parent.pn, rev: parent.rev, name: parent.name, qty: `${selItem.qty} ${selItem.uom}`, find: selItem.find }]
    : []

  const stopAnd = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation()
    fn()
  }

  return (
    <div className="plm" style={{ width: '100%', minHeight: '100vh', border: 'none' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, height: 46, padding: '0 14px', background: 'var(--color-accent-900)', color: 'var(--color-bg)' }}>
        <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 17, letterSpacing: '.16em' }}>AXIS PLM</span>
        <span style={{ width: 1, height: 20, background: 'color-mix(in srgb, var(--color-bg) 28%, transparent)' }} />
        <span style={{ fontSize: 12.5 }}>
          Program <b style={{ fontWeight: 500 }}>VP2 · D-Segment BEV</b> <span style={{ opacity: 0.6 }}>▾</span>
        </span>
        <span
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: 340,
            height: 28,
            padding: '0 10px',
            border: '1px solid color-mix(in srgb, var(--color-bg) 30%, transparent)',
            fontSize: 12,
            color: 'color-mix(in srgb, var(--color-bg) 65%, transparent)',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-4.5-4.5" />
          </svg>
          Part number, name, or saved query
          <span style={{ marginLeft: 'auto', fontSize: 10, letterSpacing: '.08em' }}>⌘K</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 12, color: 'color-mix(in srgb, var(--color-bg) 72%, transparent)' }}>
          <span>
            Worklist <b style={{ color: 'var(--color-accent-300)' }}>4</b>
          </span>
          <span style={{ width: 1, height: 20, background: 'color-mix(in srgb, var(--color-bg) 28%, transparent)' }} />
          <span>M. Reyes · Design Eng</span>
        </span>
      </div>

      {/* Nav */}
      <div style={{ display: 'flex', background: 'var(--color-accent-900)', borderBottom: '1px solid var(--color-divider)' }}>
        <span className="plm-nav">Home</span>
        <span className="plm-nav">My Worklist</span>
        <span className="plm-nav on">Structure</span>
        <span className="plm-nav">Changes</span>
        <span className="plm-nav">Search</span>
        <span className="plm-nav">Documents</span>
        <span className="plm-nav">Manufacturing</span>
        <span className="plm-nav">Reports</span>
      </div>

      {/* Breadcrumb / toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 40, padding: '0 14px', borderBottom: '1px solid var(--color-divider)', background: 'var(--color-neutral-100)' }}>
        <span style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 7 }}>
          <span className="plm-mut">VP2</span>
          {crumbs.map((c) => (
            <span key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span className="plm-mut">›</span>
              <span className="plm-mut" style={{ cursor: 'pointer' }} onClick={() => pick(c.id)}>
                {c.pn} {c.name}
              </span>
            </span>
          ))}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="plm-chip">
            Effectivity <b style={{ fontWeight: 500 }}>2026-09-01</b>
          </span>
          <span className="plm-chip">
            View <b style={{ fontWeight: 500 }}>As-Designed</b> ▾
          </span>
          <button className="btn btn-secondary" style={{ height: 28, fontSize: 12, padding: '0 10px' }}>
            Compare Revisions
          </button>
          <button className="btn btn-secondary" style={{ height: 28, fontSize: 12, padding: '0 10px' }}>
            Export
          </button>
          <button className="btn btn-primary blueprint" style={{ height: 28, fontSize: 12, padding: '0 12px' }}>
            <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
            New Change Request
          </button>
        </span>
      </div>

      {/* Panes */}
      <div style={{ display: 'flex', alignItems: 'stretch', flex: 1 }}>
        {/* Tree pane */}
        <div style={{ width: 292, flex: 'none', borderRight: '1px solid var(--color-divider)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', height: 30, padding: '0 12px', borderBottom: '1px solid var(--color-divider)' }}>
            <span className="plm-hd">Product structure</span>
            <span className="plm-mut" style={{ marginLeft: 'auto', fontSize: 10.5 }}>
              {treeRows.length} nodes shown
            </span>
          </div>
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--color-divider)' }}>
            <input
              className="input"
              style={{ height: 26, minHeight: 26, fontSize: 12, background: 'transparent' }}
              placeholder="Filter tree"
              value={treeFilter}
              onChange={(e) => setTreeFilter(e.target.value)}
            />
          </div>
          <div style={{ overflow: 'auto', flex: 1 }}>
            {treeRows.map((row) => (
              <div
                key={row.id}
                className={`plm-tr${row.selected ? ' sel' : ''}`}
                style={{ paddingLeft: 8 + row.depth * 16 }}
                onClick={() => pick(row.id)}
              >
                <span className="plm-cv" onClick={row.hasKids ? stopAnd(() => toggle(row.id)) : undefined}>
                  {row.hasKids ? (row.open ? '▾' : '▸') : ''}
                </span>
                <span className={`plm-gl${row.hasKids ? '' : ' leaf'}`} />
                <span className="plm-mono">{row.pn}</span>
                <span>{row.name}</span>
                <span className="plm-mono plm-mut" style={{ marginLeft: 'auto' }}>
                  {row.rev}
                </span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 'auto', borderTop: '1px solid var(--color-divider)', padding: '8px 12px' }}>
            <div className="plm-hd" style={{ marginBottom: 6 }}>
              Saved queries
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11.5 }}>
              <span>
                Parts pending release · <span className="plm-mut">18</span>
              </span>
              <span>
                Mass over target · <span className="plm-mut">6</span>
              </span>
              <span>
                Supplier-owned, VP2 · <span className="plm-mut">142</span>
              </span>
            </div>
          </div>
        </div>

        {/* Structure table pane */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 30, padding: '0 12px', borderBottom: '1px solid var(--color-divider)' }}>
            <span className="plm-hd">
              Structure lines — {rootItem.pn} {rootItem.rev}
            </span>
            <span className="plm-mut" style={{ fontSize: 10.5 }}>
              {bomRows.length} lines
            </span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <span className="plm-chip">Expand 2 levels ▾</span>
              <span className="plm-chip">Columns ▾</span>
              <span className="plm-chip">Filter</span>
            </span>
          </div>
          <div style={{ overflow: 'auto', flex: 1 }}>
            <table className="plm-tbl">
              <thead>
                <tr>
                  <th>Find</th>
                  <th>Part number</th>
                  <th>Rev</th>
                  <th>Name</th>
                  <th className="plm-r">Qty</th>
                  <th>UOM</th>
                  <th>M/B</th>
                  <th className="plm-r">Mass kg</th>
                  <th className="plm-cost plm-r">Unit cost</th>
                  <th>State</th>
                  <th>Effective</th>
                  <th>Owner</th>
                </tr>
              </thead>
              <tbody>
                {bomRows.map((r) => (
                  <tr key={r.id} className={r.selected ? 'sel' : ''} onClick={() => pick(r.id)}>
                    <td className={r.depth ? 'plm-mono plm-mut' : 'plm-mono'}>{r.find}</td>
                    <td className="plm-mono">{r.pn}</td>
                    <td className="plm-mono">{r.rev}</td>
                    <td>
                      <span className="plm-ind" style={{ width: r.depth * 16, display: r.depth ? 'inline-block' : 'none' }} />
                      <span
                        className="plm-cv"
                        style={{ display: 'inline-block' }}
                        onClick={r.hasKids ? stopAnd(() => toggle(r.id)) : undefined}
                      >
                        {r.hasKids ? (r.open ? '▾' : '▸') : ''}
                      </span>
                      <span className={`plm-gl${r.hasKids ? '' : ' leaf'}`} style={{ display: 'inline-block', margin: '0 7px 0 2px' }} />
                      {r.name}
                    </td>
                    <td className="plm-r">{r.qty}</td>
                    <td>{r.uom}</td>
                    <td>{r.mb}</td>
                    <td className="plm-r">{r.mass}</td>
                    <td className="plm-cost plm-r">{r.cost}</td>
                    <td>
                      <StateBadge state={r.state} label={STATE_LABEL[r.state]} />
                    </td>
                    <td className="plm-mono">{r.eff}</td>
                    <td>{r.owner}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 14, height: 28, padding: '0 12px', borderTop: '1px solid var(--color-divider)', fontSize: 10.5 }} className="plm-mut">
            <span>
              Rolled-up mass <b style={{ fontWeight: 500, color: 'var(--color-text)' }}>{rollupMass(root).toFixed(1)} kg</b>
            </span>
            <span>{bomRows.length} lines</span>
            <span>Levels 1–{chainOf(root).length + 1}</span>
            <span>Access Read/Write</span>
            <span style={{ marginLeft: 'auto' }}>Last indexed 04:12 UTC</span>
          </div>
        </div>

        {/* Properties pane */}
        <div style={{ width: 336, flex: 'none', borderLeft: '1px solid var(--color-divider)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', borderBottom: '1px solid var(--color-divider)' }}>
            <span className={`plm-tab${tab === 'props' ? ' on' : ''}`} onClick={() => setTab('props')}>
              Properties
            </span>
            <span className={`plm-tab${tab === 'where' ? ' on' : ''}`} onClick={() => setTab('where')}>
              Where-Used
            </span>
            <span className={`plm-tab${tab === 'files' ? ' on' : ''}`} onClick={() => setTab('files')}>
              Files
            </span>
            <span className={`plm-tab${tab === 'history' ? ' on' : ''}`} onClick={() => setTab('history')}>
              History
            </span>
          </div>
          <div style={{ padding: '12px 12px 10px', borderBottom: '1px solid var(--color-divider)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className="plm-mono" style={{ fontSize: 13 }}>
                {selItem.pn}
              </span>
              <span className="plm-mono plm-mut">{selItem.rev}</span>
              <span style={{ marginLeft: 'auto' }}>
                <StateBadge state={selItem.state} label={STATE_LABEL[selItem.state]} />
              </span>
            </div>
            <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 19, marginTop: 2 }}>{selItem.name}</div>
            <div className="plm-mut" style={{ fontSize: 11 }}>
              {selHasKids ? 'Assembly' : 'Part'} · {selItem.cls}
            </div>
          </div>

          {tab === 'props' && (
            <div style={{ overflow: 'auto', flex: 1 }}>
              {propGroups.map((g) => (
                <div key={g.title}>
                  <div className="plm-hd" style={{ padding: '9px 12px 4px' }}>
                    {g.title}
                  </div>
                  {g.rows.map((p) => (
                    <div className="plm-prop" key={p.k}>
                      <span className="plm-mut">{p.k}</span>
                      <span>{p.v}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {tab === 'where' && (
            <div style={{ overflow: 'auto', flex: 1 }}>
              <div className="plm-hd" style={{ padding: '9px 12px 4px' }}>
                Used in
              </div>
              {whereUsed.map((w) => (
                <div className="plm-prop" style={{ gridTemplateColumns: '1fr auto' }} key={w.pn}>
                  <span>
                    <span className="plm-mono">{w.pn}</span> {w.name}
                  </span>
                  <span className="plm-mut">
                    Find {w.find} · {w.qty}
                  </span>
                </div>
              ))}
              {!parent && (
                <div className="plm-prop">
                  <span className="plm-mut">Top level</span>
                  <span>Not used in a parent structure</span>
                </div>
              )}
              <div className="plm-mut" style={{ padding: '10px 12px', fontSize: 11 }}>
                Where-used is shown one level up; use the breadcrumb to walk to program level.
              </div>
            </div>
          )}

          {tab === 'files' && (
            <div style={{ overflow: 'auto', flex: 1 }}>
              <div className="plm-hd" style={{ padding: '9px 12px 4px' }}>
                Attached datasets
              </div>
              {files.map((d) => (
                <div className="plm-prop" style={{ gridTemplateColumns: '36px 1fr auto' }} key={d.name}>
                  <span className="plm-mono plm-mut">{d.ext}</span>
                  <span>{d.name}</span>
                  <span className="plm-mut">{d.size}</span>
                </div>
              ))}
            </div>
          )}

          {tab === 'history' && (
            <div style={{ overflow: 'auto', flex: 1 }}>
              <div className="plm-hd" style={{ padding: '9px 12px 4px' }}>
                Revision history
              </div>
              {history.map((h, i) => (
                <div className="plm-prop" style={{ gridTemplateColumns: '74px 1fr' }} key={i}>
                  <span className="plm-mono plm-mut">{h.when}</span>
                  <span>
                    {h.what}
                    <span className="plm-mut"> · {h.who}</span>
                  </span>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 'auto', borderTop: '1px solid var(--color-divider)', padding: '9px 12px', fontSize: 10.5 }} className="plm-mut">
            Click a tree node or a structure line to load it here.
          </div>
        </div>
      </div>
    </div>
  )
}

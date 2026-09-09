import { useMemo, useState, type MouseEvent } from 'react'
import {
  ITEMS,
  STATE_LABEL,
  SAVED_QUERIES,
  chainOf,
  isEffectiveAsOf,
  kidsOf,
  rollupMass,
  savedQueryIds,
  searchItems,
  type LifecycleState,
  type SavedQueryKey,
} from '../data/structure'
import Popover from './Popover'
import Dialog from './Dialog'

type TabKey = 'props' | 'where' | 'files' | 'history'
type ColKey = 'uom' | 'mb' | 'cost' | 'eff' | 'owner'
type ViewKey = 'design' | 'planned' | 'built'

const OPTIONAL_COLS: { key: ColKey; label: string }[] = [
  { key: 'uom', label: 'UOM' },
  { key: 'mb', label: 'Make / Buy' },
  { key: 'cost', label: 'Unit cost' },
  { key: 'eff', label: 'Effective' },
  { key: 'owner', label: 'Owner' },
]

const ALL_STATES: LifecycleState[] = ['rel', 'wip', 'rev', 'obs']
const ALL_MB: ('Make' | 'Buy')[] = ['Make', 'Buy']
const VIEW_LABEL: Record<ViewKey, string> = { design: 'As-Designed', planned: 'As-Planned', built: 'As-Built' }

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
  mb: 'Make' | 'Buy'
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

interface ChangeRequest {
  id: string
  title: string
  description: string
  part: string
  priority: string
  submittedAt: string
}

function StateBadge({ state, label }: { state: LifecycleState; label: string }) {
  return <span className={`plm-st ${state}`}>{label}</span>
}

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
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

  // header controls
  const [search, setSearch] = useState('')
  const [effDate, setEffDate] = useState('2026-09-01')
  const [view, setView] = useState<ViewKey>('design')
  const [compareOpen, setCompareOpen] = useState(false)
  const [crOpen, setCrOpen] = useState(false)
  const [crDraft, setCrDraft] = useState({ title: '', description: '', priority: 'Normal' })
  const [changeRequests, setChangeRequests] = useState<ChangeRequest[]>([])

  // table toolbar controls
  const [query, setQuery] = useState<SavedQueryKey | null>(null)
  const [visibleCols, setVisibleCols] = useState<Record<ColKey, boolean>>({
    uom: true,
    mb: true,
    cost: false,
    eff: true,
    owner: true,
  })
  const [stateFilter, setStateFilter] = useState<Set<LifecycleState>>(new Set(ALL_STATES))
  const [mbFilter, setMbFilter] = useState<Set<'Make' | 'Buy'>>(new Set(ALL_MB))

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

  const expandToDepth = (n: number) => {
    const next: Record<string, boolean> = {}
    const walk = (id: string, depth: number) => {
      if (depth >= n) return
      const kids = kidsOf(id)
      if (kids.length) {
        next[id] = true
        kids.forEach((k) => walk(k, depth + 1))
      }
    }
    walk('root', 0)
    setOpen(next)
  }
  const expandAll = () => {
    const next: Record<string, boolean> = {}
    Object.keys(ITEMS).forEach((id) => {
      if (kidsOf(id).length) next[id] = true
    })
    setOpen(next)
  }
  const collapseAll = () => setOpen({})

  const toggleCol = (k: ColKey) => setVisibleCols((prev) => ({ ...prev, [k]: !prev[k] }))
  const toggleState = (s: LifecycleState) =>
    setStateFilter((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
  const toggleMb = (m: 'Make' | 'Buy') =>
    setMbFilter((prev) => {
      const next = new Set(prev)
      if (next.has(m)) next.delete(m)
      else next.add(m)
      return next
    })
  const clearFilters = () => {
    setStateFilter(new Set(ALL_STATES))
    setMbFilter(new Set(ALL_MB))
  }
  const filtersActive = stateFilter.size < ALL_STATES.length || mbFilter.size < ALL_MB.length

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
    let list: BomRow[]
    if (query) {
      list = savedQueryIds(query)
        .map((k) => {
          const it = ITEMS[k]
          return {
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
            depth: 0,
            selected: sel === k,
            hasKids: false,
            open: false,
          }
        })
        .sort((a, b) => a.pn.localeCompare(b.pn))
    } else {
      const out: BomRow[] = []
      const addLines = (id: string, depth: number) => {
        kidsOf(id).forEach((k) => {
          const it = ITEMS[k]
          const kids = kidsOf(k)
          const isOpen = !!open[k]
          out.push({
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
      list = out
    }
    return list.filter((r) => stateFilter.has(r.state) && mbFilter.has(r.mb))
  }, [root, open, sel, query, stateFilter, mbFilter])

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

  const searchResults = useMemo(() => searchItems(search), [search])
  const onPickSearch = (id: string) => {
    pick(id)
    setSearch('')
  }

  const pendingPreview = useMemo(
    () => savedQueryIds('pending').slice(0, 4).map((id) => ITEMS[id]),
    [],
  )
  const worklistCount = pendingPreview.length + changeRequests.length

  const submitCr = () => {
    if (!crDraft.title.trim()) return
    const id = `ECO-${4471 + changeRequests.length + 1}`
    setChangeRequests((prev) => [
      ...prev,
      {
        id,
        title: crDraft.title.trim(),
        description: crDraft.description.trim(),
        part: `${selItem.pn} ${selItem.rev}`,
        priority: crDraft.priority,
        submittedAt: '2026-09-09',
      },
    ])
    setCrDraft({ title: '', description: '', priority: 'Normal' })
    setCrOpen(false)
  }

  const exportCsv = () => {
    const cols: { key: ColKey | 'find' | 'pn' | 'rev' | 'name' | 'qty' | 'mass' | 'stateLabel'; label: string }[] = [
      { key: 'find', label: 'Find' },
      { key: 'pn', label: 'Part number' },
      { key: 'rev', label: 'Rev' },
      { key: 'name', label: 'Name' },
      { key: 'qty', label: 'Qty' },
      ...(visibleCols.uom ? [{ key: 'uom' as const, label: 'UOM' }] : []),
      ...(visibleCols.mb ? [{ key: 'mb' as const, label: 'M/B' }] : []),
      { key: 'mass', label: 'Mass kg' },
      ...(visibleCols.cost ? [{ key: 'cost' as const, label: 'Unit cost' }] : []),
      { key: 'stateLabel', label: 'State' },
      ...(visibleCols.eff ? [{ key: 'eff' as const, label: 'Effective' }] : []),
      ...(visibleCols.owner ? [{ key: 'owner' as const, label: 'Owner' }] : []),
    ]
    const lines = [cols.map((c) => csvEscape(c.label)).join(',')]
    bomRows.forEach((r) => {
      const rec: Record<string, string> = {
        find: r.find,
        pn: r.pn,
        rev: r.rev,
        name: r.name,
        qty: String(r.qty),
        uom: r.uom,
        mb: r.mb,
        mass: r.mass,
        cost: r.cost,
        stateLabel: STATE_LABEL[r.state],
        eff: r.eff,
        owner: r.owner,
      }
      lines.push(cols.map((c) => csvEscape(rec[c.key] ?? '')).join(','))
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${rootItem.pn}_structure.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="plm" style={{ width: '100%', minHeight: '100vh', border: 'none' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, height: 46, padding: '0 14px', background: 'var(--color-accent-900)', color: 'var(--color-bg)' }}>
        <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 17, letterSpacing: '.16em' }}>AXIS PLM</span>
        <span style={{ width: 1, height: 20, background: 'color-mix(in srgb, var(--color-bg) 28%, transparent)' }} />

        <Popover
          trigger={({ toggle }) => (
            <span data-testid="program-trigger" style={{ fontSize: 12.5, cursor: 'pointer' }} onClick={toggle}>
              Program <b style={{ fontWeight: 500 }}>VP2 · D-Segment BEV</b> <span style={{ opacity: 0.6 }}>▾</span>
            </span>
          )}
        >
          <div className="plm-menu-title">Programs</div>
          <div className="plm-menu-item on">VP2 · D-Segment BEV</div>
          <div className="plm-menu-empty">Other programs aren't available in this demo dataset.</div>
        </Popover>

        <div className="plm-search-wrap" style={{ marginLeft: 'auto' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              height: 28,
              padding: '0 10px',
              border: '1px solid color-mix(in srgb, var(--color-bg) 30%, transparent)',
              fontSize: 12,
              color: 'var(--color-bg)',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-4.5-4.5" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Part number, name, or saved query"
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'var(--color-bg)',
                fontSize: 12,
              }}
            />
            <span style={{ fontSize: 10, letterSpacing: '.08em', opacity: 0.65 }}>⌘K</span>
          </div>
          {search.trim() && (
            <div className="plm-search-panel">
              {searchResults.length === 0 && <div className="plm-menu-empty">No matches for "{search}"</div>}
              {searchResults.map((it) => (
                <div key={it.id} className="plm-search-row" onClick={() => onPickSearch(it.id)}>
                  <span className="plm-mono">{it.pn}</span>
                  <span className="plm-mono plm-mut">{it.rev}</span>
                  <span>{it.name}</span>
                  <span className="plm-mut" style={{ marginLeft: 'auto' }}>
                    <StateBadge state={it.state} label={STATE_LABEL[it.state]} />
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <Popover
          align="right"
          trigger={({ toggle }) => (
            <span data-testid="worklist-trigger" style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 12, cursor: 'pointer' }} onClick={toggle}>
              <span>
                Worklist <b style={{ color: 'var(--color-accent-300)' }}>{worklistCount}</b>
              </span>
              <span style={{ width: 1, height: 20, background: 'color-mix(in srgb, var(--color-bg) 28%, transparent)' }} />
              <span>M. Reyes · Design Eng</span>
            </span>
          )}
        >
          {({ close }) => (
            <>
              <div className="plm-menu-title">Pending review</div>
              {pendingPreview.map((it) => (
                <div
                  key={it.id}
                  className="plm-menu-item"
                  onClick={() => {
                    pick(it.id)
                    close()
                  }}
                >
                  <span className="plm-mono">{it.pn}</span>
                  <span>{it.name}</span>
                  <span style={{ marginLeft: 'auto' }}>
                    <StateBadge state={it.state} label={STATE_LABEL[it.state]} />
                  </span>
                </div>
              ))}
              <div className="plm-menu-sep" />
              <div className="plm-menu-title">My change requests</div>
              {changeRequests.length === 0 && <div className="plm-menu-empty">None submitted yet.</div>}
              {changeRequests.map((cr) => (
                <div key={cr.id} className="plm-menu-item" style={{ cursor: 'default' }}>
                  <span className="plm-mono">{cr.id}</span>
                  <span>{cr.title}</span>
                  <span className="plm-mut" style={{ marginLeft: 'auto', fontSize: 10.5 }}>
                    {cr.priority}
                  </span>
                </div>
              ))}
            </>
          )}
        </Popover>
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
          <Popover
            trigger={({ toggle }) => (
              <span className="plm-chip" style={{ cursor: 'pointer' }} onClick={toggle}>
                Effectivity <b style={{ fontWeight: 500 }}>{effDate}</b>
              </span>
            )}
          >
            <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 11.5 }} className="plm-mut">
                View structure as of
              </label>
              <input
                className="input"
                type="date"
                value={effDate}
                onChange={(e) => setEffDate(e.target.value)}
                style={{ height: 30, fontSize: 12 }}
              />
              <div className="plm-mut" style={{ fontSize: 10.5 }}>
                Rows not yet effective on this date are dimmed in the Effective column.
              </div>
            </div>
          </Popover>

          <Popover
            trigger={({ toggle }) => (
              <span className="plm-chip" style={{ cursor: 'pointer' }} onClick={toggle}>
                View <b style={{ fontWeight: 500 }}>{VIEW_LABEL[view]}</b> ▾
              </span>
            )}
          >
            {({ close }) => (
              <>
                {(Object.keys(VIEW_LABEL) as ViewKey[]).map((v) => (
                  <div
                    key={v}
                    className={`plm-menu-item${view === v ? ' on' : ''}`}
                    onClick={() => {
                      setView(v)
                      close()
                    }}
                  >
                    {VIEW_LABEL[v]}
                  </div>
                ))}
              </>
            )}
          </Popover>

          <button className="btn btn-secondary" style={{ height: 28, fontSize: 12, padding: '0 10px' }} onClick={() => setCompareOpen(true)}>
            Compare Revisions
          </button>
          <button className="btn btn-secondary" style={{ height: 28, fontSize: 12, padding: '0 10px' }} onClick={exportCsv}>
            Export
          </button>
          <button
            className="btn btn-primary blueprint"
            style={{ height: 28, fontSize: 12, padding: '0 12px' }}
            onClick={() => setCrOpen(true)}
          >
            <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
            New Change Request
          </button>
        </span>
      </div>

      {view !== 'design' && (
        <div style={{ padding: '4px 14px', fontSize: 11, background: 'var(--color-accent-100)', color: 'var(--color-accent-800)' }}>
          {VIEW_LABEL[view]} structure isn't available in this demo dataset — showing As-Designed data.
        </div>
      )}

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
              {SAVED_QUERIES.map((q) => (
                <span
                  key={q.key}
                  style={{ cursor: 'pointer', color: query === q.key ? 'var(--color-accent-800)' : undefined, fontWeight: query === q.key ? 500 : 400 }}
                  onClick={() => setQuery((prev) => (prev === q.key ? null : q.key))}
                >
                  {q.label} · <span className="plm-mut">{savedQueryIds(q.key).length}</span>
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Structure table pane */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 30, padding: '0 12px', borderBottom: '1px solid var(--color-divider)' }}>
            <span className="plm-hd">
              {query ? SAVED_QUERIES.find((q) => q.key === query)?.label : `Structure lines — ${rootItem.pn} ${rootItem.rev}`}
            </span>
            <span className="plm-mut" style={{ fontSize: 10.5 }}>
              {bomRows.length} lines
            </span>
            {query && (
              <span className="plm-chip" style={{ cursor: 'pointer' }} onClick={() => setQuery(null)}>
                Clear query ✕
              </span>
            )}
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <Popover
                trigger={({ toggle }) => (
                  <span className="plm-chip" style={{ cursor: 'pointer' }} onClick={toggle}>
                    Expand levels ▾
                  </span>
                )}
              >
                {({ close }) => (
                  <>
                    <div className="plm-menu-item" onClick={() => { expandToDepth(1); close() }}>Expand 1 level</div>
                    <div className="plm-menu-item" onClick={() => { expandToDepth(2); close() }}>Expand 2 levels</div>
                    <div className="plm-menu-item" onClick={() => { expandToDepth(3); close() }}>Expand 3 levels</div>
                    <div className="plm-menu-sep" />
                    <div className="plm-menu-item" onClick={() => { expandAll(); close() }}>Expand all</div>
                    <div className="plm-menu-item" onClick={() => { collapseAll(); close() }}>Collapse all</div>
                  </>
                )}
              </Popover>

              <Popover
                trigger={({ toggle }) => (
                  <span className="plm-chip" style={{ cursor: 'pointer' }} onClick={toggle}>
                    Columns ▾
                  </span>
                )}
              >
                {OPTIONAL_COLS.map((c) => (
                  <div key={c.key} className="plm-menu-item" onClick={() => toggleCol(c.key)}>
                    <input type="checkbox" checked={visibleCols[c.key]} onChange={() => toggleCol(c.key)} onClick={(e) => e.stopPropagation()} />
                    {c.label}
                  </div>
                ))}
              </Popover>

              <Popover
                align="right"
                trigger={({ toggle }) => (
                  <span className="plm-chip" style={{ cursor: 'pointer' }} onClick={toggle}>
                    Filter{filtersActive ? ` (${stateFilter.size + mbFilter.size})` : ''}
                  </span>
                )}
              >
                <div className="plm-menu-title">State</div>
                {ALL_STATES.map((s) => (
                  <div key={s} className="plm-menu-item" onClick={() => toggleState(s)}>
                    <input type="checkbox" checked={stateFilter.has(s)} onChange={() => toggleState(s)} onClick={(e) => e.stopPropagation()} />
                    {STATE_LABEL[s]}
                  </div>
                ))}
                <div className="plm-menu-sep" />
                <div className="plm-menu-title">Make / Buy</div>
                {ALL_MB.map((m) => (
                  <div key={m} className="plm-menu-item" onClick={() => toggleMb(m)}>
                    <input type="checkbox" checked={mbFilter.has(m)} onChange={() => toggleMb(m)} onClick={(e) => e.stopPropagation()} />
                    {m}
                  </div>
                ))}
                <div className="plm-menu-sep" />
                <div className="plm-menu-item" onClick={clearFilters}>Clear filters</div>
              </Popover>
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
                  {visibleCols.uom && <th>UOM</th>}
                  {visibleCols.mb && <th>M/B</th>}
                  <th className="plm-r">Mass kg</th>
                  {visibleCols.cost && <th className="plm-r">Unit cost</th>}
                  <th>State</th>
                  {visibleCols.eff && <th>Effective</th>}
                  {visibleCols.owner && <th>Owner</th>}
                </tr>
              </thead>
              <tbody>
                {bomRows.map((r) => {
                  const rowEffective = isEffectiveAsOf(ITEMS[r.id], effDate)
                  return (
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
                      {visibleCols.uom && <td>{r.uom}</td>}
                      {visibleCols.mb && <td>{r.mb}</td>}
                      <td className="plm-r">{r.mass}</td>
                      {visibleCols.cost && <td className="plm-r">{r.cost}</td>}
                      <td>
                        <StateBadge state={r.state} label={STATE_LABEL[r.state]} />
                      </td>
                      {visibleCols.eff && (
                        <td className={rowEffective ? 'plm-mono' : 'plm-mono plm-mut'} title={rowEffective ? undefined : `Not effective as of ${effDate}`}>
                          {r.eff}
                        </td>
                      )}
                      {visibleCols.owner && <td>{r.owner}</td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 14, height: 28, padding: '0 12px', borderTop: '1px solid var(--color-divider)', fontSize: 10.5 }} className="plm-mut">
            {query ? (
              <>
                <span>{bomRows.length} results</span>
                <span>
                  Total unit mass{' '}
                  <b style={{ fontWeight: 500, color: 'var(--color-text)' }}>
                    {bomRows.reduce((s, r) => s + parseFloat(r.mass), 0).toFixed(1)} kg
                  </b>
                </span>
              </>
            ) : (
              <>
                <span>
                  Rolled-up mass <b style={{ fontWeight: 500, color: 'var(--color-text)' }}>{rollupMass(root).toFixed(1)} kg</b>
                </span>
                <span>{bomRows.length} lines</span>
                <span>Levels 1–{chainOf(root).length + 1}</span>
              </>
            )}
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

      {compareOpen && (
        <Dialog
          title="Compare Revisions"
          onClose={() => setCompareOpen(false)}
          actions={
            <button className="btn btn-secondary" onClick={() => setCompareOpen(false)}>
              Close
            </button>
          }
        >
          <div className="plm-mut" style={{ fontSize: 11.5 }}>
            {selItem.pn} · {selItem.name}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="blueprint" style={{ padding: '10px 12px' }}>
              <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
              <div className="plm-hd" style={{ marginBottom: 6 }}>Current</div>
              <div className="plm-mono" style={{ fontSize: 15, marginBottom: 4 }}>{selItem.rev}</div>
              <StateBadge state={selItem.state} label={STATE_LABEL[selItem.state]} />
              <div style={{ marginTop: 8, fontSize: 11.5 }}>{history[0].what}</div>
              <div className="plm-mut" style={{ fontSize: 10.5 }}>{history[0].when} · {history[0].who}</div>
            </div>
            <div className="blueprint" style={{ padding: '10px 12px' }}>
              <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
              <div className="plm-hd" style={{ marginBottom: 6 }}>Previous logged change</div>
              <div className="plm-mono" style={{ fontSize: 15, marginBottom: 4 }}>{selItem.rev}</div>
              <div style={{ marginTop: 8, fontSize: 11.5 }}>{history[1].what}</div>
              <div className="plm-mut" style={{ fontSize: 10.5 }}>{history[1].when} · {history[1].who}</div>
            </div>
          </div>
          <div className="plm-mut" style={{ fontSize: 10.5 }}>
            Field-level diffing between full revisions isn't available in this demo dataset.
          </div>
        </Dialog>
      )}

      {crOpen && (
        <Dialog
          title="New Change Request"
          onClose={() => setCrOpen(false)}
          actions={
            <>
              <button className="btn btn-secondary" onClick={() => setCrOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={submitCr} disabled={!crDraft.title.trim()}>
                Submit
              </button>
            </>
          }
        >
          <div className="field">
            <label>Affected part</label>
            <div className="plm-mono" style={{ fontSize: 13 }}>
              {selItem.pn} {selItem.rev} · {selItem.name}
            </div>
          </div>
          <div className="field">
            <label>Title</label>
            <input
              className="input"
              value={crDraft.title}
              onChange={(e) => setCrDraft((d) => ({ ...d, title: e.target.value }))}
              placeholder="Short summary of the change"
            />
          </div>
          <div className="field">
            <label>Description</label>
            <textarea
              className="input"
              value={crDraft.description}
              onChange={(e) => setCrDraft((d) => ({ ...d, description: e.target.value }))}
              placeholder="What's changing and why"
            />
          </div>
          <div className="field">
            <label>Priority</label>
            <select
              className="input"
              value={crDraft.priority}
              onChange={(e) => setCrDraft((d) => ({ ...d, priority: e.target.value }))}
            >
              <option>Low</option>
              <option>Normal</option>
              <option>High</option>
              <option>Urgent</option>
            </select>
          </div>
        </Dialog>
      )}
    </div>
  )
}

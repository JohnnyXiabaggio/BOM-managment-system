import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import {
  ITEMS,
  STATE_LABEL,
  SAVED_QUERIES,
  chainOf,
  isEffectiveAsOf,
  kidsOf,
  loadStructureData,
  rollupMass,
  savedQueryIds,
  searchItems,
  type LifecycleState,
  type SavedQueryKey,
  type StructureItem,
} from '../data/structure'
import { api, type ActivityEntry, type ChangeRequest, type HistoryEntry } from '../data/api'
import Popover from './Popover'
import Dialog from './Dialog'

const CURRENT_USER = 'M. Reyes'

type TabKey = 'props' | 'where' | 'files' | 'history'
type ColKey = 'uom' | 'mb' | 'cost' | 'eff' | 'owner'
type ViewKey = 'design' | 'planned' | 'built'
type NavKey = 'home' | 'worklist' | 'structure' | 'changes' | 'search' | 'documents' | 'manufacturing' | 'reports'

const NAV_ITEMS: { key: NavKey; label: string }[] = [
  { key: 'home', label: 'Home' },
  { key: 'worklist', label: 'My Worklist' },
  { key: 'structure', label: 'Structure' },
  { key: 'changes', label: 'Changes' },
  { key: 'search', label: 'Search' },
  { key: 'documents', label: 'Documents' },
  { key: 'manufacturing', label: 'Manufacturing' },
  { key: 'reports', label: 'Reports' },
]
const NAV_LABEL: Record<NavKey, string> = Object.fromEntries(NAV_ITEMS.map((n) => [n.key, n.label])) as Record<NavKey, string>

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

/** Every editable item attribute, held as form strings and coerced on submit. */
interface ItemDraft {
  find: string
  pn: string
  rev: string
  name: string
  kind: 'asm' | 'part'
  qty: string
  uom: string
  mb: 'Make' | 'Buy'
  mass: string
  cost: string
  state: LifecycleState
  eff: string
  owner: string
  cls: string
  plant: string
  supplier: string
}

/** The draft fields that are plain free-text; the rest are fixed-choice selects. */
type DraftTextKey = Exclude<keyof ItemDraft, 'kind' | 'mb' | 'state'>

const blankDraft = (owner: string): ItemDraft => ({
  find: '',
  pn: '',
  rev: '/A',
  name: '',
  kind: 'part',
  qty: '1',
  uom: 'EA',
  mb: 'Make',
  mass: '0',
  cost: '0',
  state: 'wip',
  eff: '',
  owner,
  cls: '',
  plant: '',
  supplier: '—',
})

const draftOf = (it: StructureItem): ItemDraft => ({
  find: it.find,
  pn: it.pn,
  rev: it.rev,
  name: it.name,
  kind: it.kind,
  qty: String(it.qty),
  uom: it.uom,
  mb: it.mb,
  mass: String(it.mass),
  cost: String(it.cost),
  state: it.state,
  eff: it.eff === '—' ? '' : it.eff,
  owner: it.owner,
  cls: it.cls,
  plant: it.plant,
  supplier: it.supplier,
})

function StateBadge({ state, label }: { state: LifecycleState; label: string }) {
  return <span className={`plm-st ${state}`}>{label}</span>
}

function CrStatusBadge({ status }: { status: ChangeRequest['status'] }) {
  const cls = status === 'approved' ? 'rel' : status === 'rejected' ? 'obs' : 'rev'
  const label = status === 'approved' ? 'Approved' : status === 'rejected' ? 'Rejected' : 'Submitted'
  return <StateBadge state={cls} label={label} />
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
  const [activeNav, setActiveNav] = useState<NavKey>('structure')
  const [navSearch, setNavSearch] = useState('')
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
  const [crSubmitting, setCrSubmitting] = useState(false)
  const [crError, setCrError] = useState('')
  const [changeRequests, setChangeRequests] = useState<ChangeRequest[]>([])
  const [decidingId, setDecidingId] = useState<number | null>(null)
  const [historyRows, setHistoryRows] = useState<HistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [activityLoading, setActivityLoading] = useState(false)

  // BOM item management. One dialog is open at a time, so a single
  // busy/error pair serves create, modify, revise and delete.
  const [dataVersion, setDataVersion] = useState(0)
  const [itemDialog, setItemDialog] = useState<{ mode: 'create'; parent: string } | { mode: 'edit' } | null>(null)
  const [itemDraft, setItemDraft] = useState<ItemDraft>(() => blankDraft(CURRENT_USER))
  const [reviseDraft, setReviseDraft] = useState({ note: '', revision: '' })
  const [reviseOpen, setReviseOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [itemBusy, setItemBusy] = useState(false)
  const [itemError, setItemError] = useState('')
  const [banner, setBanner] = useState('')

  // SQL-backed search page
  const [navSearchFilters, setNavSearchFilters] = useState<{ state: Set<LifecycleState>; mb: Set<'Make' | 'Buy'> }>({
    state: new Set(ALL_STATES),
    mb: new Set(ALL_MB),
  })
  const [navSearchRows, setNavSearchRows] = useState<StructureItem[]>([])
  const [navSearchBusy, setNavSearchBusy] = useState(false)
  const [navSearchError, setNavSearchError] = useState('')

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

  const refreshChangeRequests = () => api.changeRequests().then(setChangeRequests).catch(() => {})

  useEffect(() => {
    refreshChangeRequests()
  }, [])

  useEffect(() => {
    let cancelled = false
    setHistoryLoading(true)
    api
      .itemHistory(sel)
      .then((rows) => {
        if (!cancelled) setHistoryRows(rows)
      })
      .catch(() => {
        if (!cancelled) setHistoryRows([])
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sel, dataVersion])

  useEffect(() => {
    if (activeNav !== 'changes') return
    let cancelled = false
    setActivityLoading(true)
    api
      .activity()
      .then((rows) => {
        if (!cancelled) setActivity(rows)
      })
      .catch(() => {
        if (!cancelled) setActivity([])
      })
      .finally(() => {
        if (!cancelled) setActivityLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeNav])

  useEffect(() => {
    if (!banner) return
    const t = setTimeout(() => setBanner(''), 5000)
    return () => clearTimeout(t)
  }, [banner])

  // Search page queries the items table directly, so it reflects the
  // database rather than the copy of the tree held in the browser.
  useEffect(() => {
    if (activeNav !== 'search') return
    const q = navSearch.trim()
    if (!q) {
      setNavSearchRows([])
      setNavSearchError('')
      return
    }
    let cancelled = false
    setNavSearchBusy(true)
    const t = setTimeout(() => {
      api
        .searchItems({
          q,
          state: [...navSearchFilters.state],
          mb: [...navSearchFilters.mb],
          limit: 100,
        })
        .then((rows) => {
          if (cancelled) return
          setNavSearchRows(rows)
          setNavSearchError('')
        })
        .catch((err) => {
          if (cancelled) return
          setNavSearchRows([])
          setNavSearchError(err instanceof Error ? err.message : String(err))
        })
        .finally(() => {
          if (!cancelled) setNavSearchBusy(false)
        })
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [activeNav, navSearch, navSearchFilters, dataVersion])

  const decideCr = async (id: number, status: 'approved' | 'rejected') => {
    setDecidingId(id)
    try {
      await api.decideChangeRequest(id, status, CURRENT_USER)
      await refreshChangeRequests()
    } catch (err) {
      console.error(err)
    } finally {
      setDecidingId(null)
    }
  }

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

  /** Loads an item and switches back to the Structure tab, for links from other nav pages. */
  const goToStructure = (id: string) => {
    pick(id)
    setActiveNav('structure')
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
  const filtered = useMemo(() => (needle ? filterVisibility(needle) : null), [needle, dataVersion])

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
  }, [open, sel, filtered, dataVersion])

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
  }, [root, open, sel, query, stateFilter, mbFilter, dataVersion])

  const selItem = ITEMS[sel]
  const rootItem = ITEMS[root]
  const crumbs = chainOf(root)
  const parent = selItem.parent ? ITEMS[selItem.parent] : null
  const selHasKids = kidsOf(sel).length > 0

  /**
   * Re-reads the structure after a write. Selection is re-pointed at the
   * top if the item it referred to is no longer in the database, which can
   * happen when someone else deletes it.
   */
  const reload = async () => {
    await loadStructureData()
    setSel((cur) => (ITEMS[cur] ? cur : 'root'))
    setRoot((cur) => (ITEMS[cur] ? cur : 'root'))
    setDataVersion((v) => v + 1)
  }

  /** Coerces the form draft into an API payload, rejecting bad numbers first. */
  const draftFields = () => {
    const qty = Number(itemDraft.qty)
    const mass = Number(itemDraft.mass)
    const cost = Number(itemDraft.cost)
    if (!itemDraft.pn.trim()) throw new Error('Part number is required')
    if (!itemDraft.name.trim()) throw new Error('Name is required')
    if (![qty, mass, cost].every((n) => Number.isFinite(n) && n >= 0)) {
      throw new Error('Qty, mass and unit cost must be numbers of 0 or more')
    }
    return {
      find: itemDraft.find.trim(),
      pn: itemDraft.pn.trim(),
      name: itemDraft.name.trim(),
      kind: itemDraft.kind,
      qty,
      uom: itemDraft.uom.trim() || 'EA',
      mb: itemDraft.mb,
      mass,
      cost,
      state: itemDraft.state,
      eff: itemDraft.eff || '—',
      owner: itemDraft.owner.trim() || CURRENT_USER,
      cls: itemDraft.cls.trim(),
      plant: itemDraft.plant.trim(),
      supplier: itemDraft.supplier.trim() || '—',
    }
  }

  /**
   * Shared shell for the item writes: runs one, refreshes the tree from the
   * database, moves the selection to the item named by `select`, and reports
   * the outcome. Errors stay in the open dialog so they can be corrected.
   */
  const runItemWrite = async (fn: () => Promise<{ message: string; select?: string }>) => {
    setItemBusy(true)
    setItemError('')
    try {
      const { message, select } = await fn()
      await reload()
      if (select && ITEMS[select]) {
        setSel(select)
        setRoot(kidsOf(select).length ? select : ITEMS[select].parent || select)
        const ancestors = chainOf(select).slice(0, -1)
        setOpen((prev) => ({ ...prev, ...Object.fromEntries(ancestors.map((a) => [a.id, true])) }))
      }
      setBanner(message)
      setItemDialog(null)
      setReviseOpen(false)
      setDeleteOpen(false)
    } catch (err) {
      setItemError(err instanceof Error ? err.message : String(err))
    } finally {
      setItemBusy(false)
    }
  }

  /** Labelled text input bound to one of the draft's string fields. */
  const draftInput = (label: string, key: DraftTextKey, opts: { placeholder?: string; type?: string } = {}) => (
    <div className="field">
      <label>{label}</label>
      <input
        className="input"
        type={opts.type || 'text'}
        placeholder={opts.placeholder}
        value={itemDraft[key]}
        onChange={(e) => {
          const value = e.target.value
          setItemDraft((d) => {
            const next = { ...d }
            next[key] = value
            return next
          })
        }}
      />
    </div>
  )

  const openCreate = () => {
    setItemError('')
    setItemDraft(blankDraft(CURRENT_USER))
    setItemDialog({ mode: 'create', parent: selHasKids ? sel : selItem.parent || root })
  }

  const openEdit = () => {
    setItemError('')
    setItemDraft(draftOf(selItem))
    setItemDialog({ mode: 'edit' })
  }

  const saveItem = () =>
    runItemWrite(async () => {
      const fields = draftFields()
      if (itemDialog?.mode === 'create') {
        const parentPn = ITEMS[itemDialog.parent]?.pn ?? itemDialog.parent
        const created = await api.createItem({
          parent: itemDialog.parent,
          rev: itemDraft.rev.trim() || '/A',
          actor: CURRENT_USER,
          ...fields,
        })
        return { message: `Created ${created.pn} ${created.rev} under ${parentPn}`, select: created.id }
      }
      const updated = await api.updateItem(sel, { actor: CURRENT_USER, ...fields })
      return { message: `Saved changes to ${updated.pn} ${updated.rev}`, select: updated.id }
    })

  const doRevise = () =>
    runItemWrite(async () => {
      const updated = await api.reviseItem(sel, {
        note: reviseDraft.note.trim() || undefined,
        revision: reviseDraft.revision.trim() || undefined,
        actor: CURRENT_USER,
      })
      setReviseDraft({ note: '', revision: '' })
      return { message: `${updated.pn} revised to ${updated.rev} — now In Work`, select: updated.id }
    })

  const doDelete = () =>
    runItemWrite(async () => {
      const gone = await api.deleteItem(sel, CURRENT_USER)
      return { message: `Deleted ${gone.pn} ${gone.rev} — ${gone.name}`, select: gone.parent || 'root' }
    })

  const openCrForSel = changeRequests.find((cr) => cr.itemId === sel && cr.status === 'submitted')

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
        { k: 'Open change request', v: openCrForSel ? `${openCrForSel.ecoNumber} · submitted ${openCrForSel.submittedAt.slice(0, 10)}` : 'None' },
        { k: 'Effectivity', v: selItem.eff === '—' ? 'not effective' : `${selItem.eff} → open` },
        { k: 'Owner', v: selItem.owner },
      ],
    },
    {
      title: 'Manufacturing',
      rows: [
        { k: 'Make / buy', v: [selItem.mb, selItem.plant].filter(Boolean).join(' · ') },
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
  const whereUsed = parent
    ? [{ pn: parent.pn, rev: parent.rev, name: parent.name, qty: `${selItem.qty} ${selItem.uom}`, find: selItem.find }]
    : []

  const stopAnd = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation()
    fn()
  }

  const searchResults = useMemo(() => searchItems(search), [search, dataVersion])
  const onPickSearch = (id: string) => {
    pick(id)
    setSearch('')
  }

  const pendingAll = useMemo(() => savedQueryIds('pending').map((id) => ITEMS[id]), [dataVersion])
  const pendingPreview = pendingAll.slice(0, 4)
  const openChangeRequests = changeRequests.filter((cr) => cr.status === 'submitted')
  const worklistCount = pendingPreview.length + openChangeRequests.length

  const submitCr = async () => {
    if (!crDraft.title.trim()) return
    setCrSubmitting(true)
    setCrError('')
    try {
      await api.submitChangeRequest({
        itemId: sel,
        title: crDraft.title.trim(),
        description: crDraft.description.trim(),
        priority: crDraft.priority,
        submittedBy: CURRENT_USER,
      })
      await refreshChangeRequests()
      setCrDraft({ title: '', description: '', priority: 'Normal' })
      setCrOpen(false)
    } catch (err) {
      setCrError(err instanceof Error ? err.message : String(err))
    } finally {
      setCrSubmitting(false)
    }
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
              {changeRequests.slice(0, 5).map((cr) => (
                <div
                  key={cr.id}
                  className="plm-menu-item"
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    pick(cr.itemId)
                    close()
                  }}
                >
                  <span className="plm-mono">{cr.ecoNumber}</span>
                  <span>{cr.title}</span>
                  <span style={{ marginLeft: 'auto' }}>
                    <CrStatusBadge status={cr.status} />
                  </span>
                </div>
              ))}
            </>
          )}
        </Popover>
      </div>

      {/* Nav */}
      <div style={{ display: 'flex', background: 'var(--color-accent-900)', borderBottom: '1px solid var(--color-divider)' }}>
        {NAV_ITEMS.map((n) => (
          <span
            key={n.key}
            className={`plm-nav${activeNav === n.key ? ' on' : ''}`}
            style={{ cursor: 'pointer' }}
            onClick={() => setActiveNav(n.key)}
          >
            {n.label}
          </span>
        ))}
      </div>

      {banner && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '6px 14px',
            fontSize: 11.5,
            background: 'var(--color-accent-100)',
            color: 'var(--color-accent-800)',
            borderBottom: '1px solid var(--color-divider)',
          }}
        >
          <span>{banner}</span>
          <span style={{ marginLeft: 'auto', cursor: 'pointer' }} onClick={() => setBanner('')}>
            ✕
          </span>
        </div>
      )}

      {activeNav === 'structure' && (
      <>
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
            onClick={() => {
              setCrError('')
              setCrOpen(true)
            }}
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
              <span
                className="plm-chip"
                data-testid="new-item"
                style={{ cursor: 'pointer' }}
                title={`Add a line under ${selHasKids ? selItem.pn : parent?.pn ?? rootItem.pn}`}
                onClick={openCreate}
              >
                + New item
              </span>

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
              {[selHasKids ? 'Assembly' : 'Part', selItem.cls].filter(Boolean).join(' · ')}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              <button
                className="btn btn-secondary"
                data-testid="edit-item"
                style={{ height: 24, fontSize: 11, padding: '0 9px' }}
                onClick={openEdit}
              >
                Edit
              </button>
              <button
                className="btn btn-secondary"
                data-testid="revise-item"
                style={{ height: 24, fontSize: 11, padding: '0 9px' }}
                onClick={() => {
                  setItemError('')
                  setReviseDraft({ note: '', revision: '' })
                  setReviseOpen(true)
                }}
              >
                Revise
              </button>
              <button
                className="btn btn-secondary"
                data-testid="delete-item"
                style={{ height: 24, fontSize: 11, padding: '0 9px' }}
                disabled={!selItem.parent}
                title={selItem.parent ? undefined : 'The top-level item cannot be deleted'}
                onClick={() => {
                  setItemError('')
                  setDeleteOpen(true)
                }}
              >
                Delete
              </button>
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
              {historyLoading && <div className="plm-menu-empty">Loading…</div>}
              {!historyLoading && historyRows.length === 0 && <div className="plm-menu-empty">No recorded history.</div>}
              {historyRows.map((h, i) => (
                <div className="plm-prop" style={{ gridTemplateColumns: '74px 30px 1fr' }} key={i}>
                  <span className="plm-mono plm-mut">{h.when}</span>
                  <span className="plm-mono plm-mut">{h.rev}</span>
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
      </>
      )}

      {activeNav === 'worklist' && (
        <div style={{ padding: 24, maxWidth: 720 }}>
          <div className="plm-hd" style={{ marginBottom: 10 }}>Pending review ({pendingAll.length})</div>
          <div className="plm" style={{ border: '1px solid var(--color-divider)', marginBottom: 24 }}>
            {pendingAll.map((it) => (
              <div key={it.id} className="plm-prop" style={{ gridTemplateColumns: '110px 1fr auto', cursor: 'pointer' }} onClick={() => goToStructure(it.id)}>
                <span className="plm-mono">{it.pn}</span>
                <span>{it.name}</span>
                <StateBadge state={it.state} label={STATE_LABEL[it.state]} />
              </div>
            ))}
            {pendingAll.length === 0 && <div className="plm-menu-empty">Nothing pending review.</div>}
          </div>
          <div className="plm-hd" style={{ marginBottom: 10 }}>Change requests ({changeRequests.length})</div>
          <div className="plm" style={{ border: '1px solid var(--color-divider)' }}>
            {changeRequests.map((cr) => (
              <div key={cr.id} className="plm-prop" style={{ gridTemplateColumns: '90px 1fr auto', alignItems: 'center' }}>
                <span
                  className="plm-mono"
                  style={{ cursor: 'pointer' }}
                  onClick={() => goToStructure(cr.itemId)}
                  title="Open this part in Structure"
                >
                  {cr.ecoNumber}
                </span>
                <span>
                  {cr.title}
                  <span className="plm-mut">
                    {' '}
                    · {cr.partPn} {cr.partName} · {cr.priority} · submitted by {cr.submittedBy} on {cr.submittedAt.slice(0, 10)}
                    {cr.status !== 'submitted' && ` · ${cr.status} by ${cr.decidedBy} on ${cr.decidedAt?.slice(0, 10)}`}
                  </span>
                </span>
                {cr.status === 'submitted' ? (
                  <span style={{ display: 'flex', gap: 6 }}>
                    <button
                      className="btn btn-secondary"
                      style={{ height: 24, fontSize: 11, padding: '0 8px' }}
                      disabled={decidingId === cr.id}
                      onClick={() => decideCr(cr.id, 'rejected')}
                    >
                      Reject
                    </button>
                    <button
                      className="btn btn-primary"
                      style={{ height: 24, fontSize: 11, padding: '0 8px' }}
                      disabled={decidingId === cr.id}
                      onClick={() => decideCr(cr.id, 'approved')}
                    >
                      Approve
                    </button>
                  </span>
                ) : (
                  <CrStatusBadge status={cr.status} />
                )}
              </div>
            ))}
            {changeRequests.length === 0 && (
              <div className="plm-menu-empty">
                None submitted yet — select a part in Structure and use "New Change Request".
              </div>
            )}
          </div>
        </div>
      )}

      {activeNav === 'search' && (
        <div style={{ padding: 24, maxWidth: 820 }}>
          <input
            className="input"
            autoFocus
            style={{ height: 36, fontSize: 14, marginBottom: 10 }}
            placeholder="Search part number, name, classification or supplier"
            value={navSearch}
            onChange={(e) => setNavSearch(e.target.value)}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
            {ALL_STATES.map((s) => (
              <span
                key={s}
                className="plm-chip"
                style={{ cursor: 'pointer', opacity: navSearchFilters.state.has(s) ? 1 : 0.45 }}
                onClick={() =>
                  setNavSearchFilters((prev) => {
                    const state = new Set(prev.state)
                    if (state.has(s)) state.delete(s)
                    else state.add(s)
                    return { ...prev, state }
                  })
                }
              >
                {STATE_LABEL[s]}
              </span>
            ))}
            <span style={{ width: 1, height: 18, background: 'var(--color-divider)' }} />
            {ALL_MB.map((m) => (
              <span
                key={m}
                className="plm-chip"
                style={{ cursor: 'pointer', opacity: navSearchFilters.mb.has(m) ? 1 : 0.45 }}
                onClick={() =>
                  setNavSearchFilters((prev) => {
                    const mb = new Set(prev.mb)
                    if (mb.has(m)) mb.delete(m)
                    else mb.add(m)
                    return { ...prev, mb }
                  })
                }
              >
                {m}
              </span>
            ))}
            <span className="plm-mut" style={{ fontSize: 10.5, marginLeft: 'auto' }}>
              Queried with SQL against the items table
            </span>
          </div>
          <div className="plm" style={{ border: '1px solid var(--color-divider)' }}>
            {navSearch.trim() === '' && <div className="plm-menu-empty">Start typing to search the VP2 product structure.</div>}
            {navSearch.trim() !== '' && navSearchBusy && <div className="plm-menu-empty">Searching…</div>}
            {navSearchError && <div className="plm-menu-empty">Search failed — {navSearchError}</div>}
            {navSearch.trim() !== '' && !navSearchBusy && !navSearchError && navSearchRows.length === 0 && (
              <div className="plm-menu-empty">No matches for "{navSearch}"</div>
            )}
            {!navSearchBusy &&
              !navSearchError &&
              navSearchRows.map((it) => (
                <div
                  key={it.id}
                  className="plm-prop"
                  style={{ gridTemplateColumns: '110px 44px 1fr 130px auto', cursor: 'pointer' }}
                  onClick={() => goToStructure(it.id)}
                >
                  <span className="plm-mono">{it.pn}</span>
                  <span className="plm-mono plm-mut">{it.rev}</span>
                  <span>{it.name}</span>
                  <span className="plm-mut">{it.mb === 'Buy' ? it.supplier : it.plant}</span>
                  <StateBadge state={it.state} label={STATE_LABEL[it.state]} />
                </div>
              ))}
          </div>
          {navSearchRows.length > 0 && !navSearchBusy && (
            <div className="plm-mut" style={{ fontSize: 10.5, marginTop: 8 }}>
              {navSearchRows.length} row{navSearchRows.length === 1 ? '' : 's'} returned
            </div>
          )}
        </div>
      )}

      {activeNav === 'changes' && (
        <div style={{ padding: 24, maxWidth: 820 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
            <div className="plm-hd">Activity ({activity.length})</div>
            <span
              className="plm-chip"
              style={{ cursor: 'pointer' }}
              onClick={() => {
                setActivityLoading(true)
                api
                  .activity()
                  .then(setActivity)
                  .catch(() => setActivity([]))
                  .finally(() => setActivityLoading(false))
              }}
            >
              Refresh
            </span>
          </div>
          <div className="plm" style={{ border: '1px solid var(--color-divider)' }}>
            {activityLoading && <div className="plm-menu-empty">Loading…</div>}
            {!activityLoading && activity.length === 0 && (
              <div className="plm-menu-empty">
                No activity yet — submit a change request from Structure to see the workflow logged here.
              </div>
            )}
            {activity.map((a) => (
              <div key={a.id} className="plm-prop" style={{ gridTemplateColumns: '150px 1fr', cursor: a.itemId ? 'pointer' : 'default' }} onClick={() => a.itemId && goToStructure(a.itemId)}>
                <span className="plm-mono plm-mut">{a.happenedAt}</span>
                <span>
                  <b style={{ fontWeight: 500 }}>{a.actor}</b> — {a.detail}
                  {a.partPn && (
                    <span className="plm-mut">
                      {' '}
                      ({a.partPn} {a.partName})
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(activeNav === 'home' || activeNav === 'documents' || activeNav === 'manufacturing' || activeNav === 'reports') && (
        <div style={{ padding: 48, textAlign: 'center' }}>
          <div className="plm-hd" style={{ marginBottom: 8 }}>{NAV_LABEL[activeNav]}</div>
          <div className="plm-mut" style={{ fontSize: 13 }}>
            {NAV_LABEL[activeNav]} isn't built out in this demo — try{' '}
            <span style={{ color: 'var(--color-accent-700)', cursor: 'pointer' }} onClick={() => setActiveNav('structure')}>Structure</span>
            {' '}or{' '}
            <span style={{ color: 'var(--color-accent-700)', cursor: 'pointer' }} onClick={() => setActiveNav('worklist')}>My Worklist</span>.
          </div>
        </div>
      )}

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
          {historyRows.length < 2 ? (
            <div className="plm-mut" style={{ fontSize: 12 }}>
              Not enough recorded history on this item to compare revisions.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="blueprint" style={{ padding: '10px 12px' }}>
                <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
                <div className="plm-hd" style={{ marginBottom: 6 }}>Current</div>
                <div className="plm-mono" style={{ fontSize: 15, marginBottom: 4 }}>{selItem.rev}</div>
                <StateBadge state={selItem.state} label={STATE_LABEL[selItem.state]} />
                <div style={{ marginTop: 8, fontSize: 11.5 }}>{historyRows[0].what}</div>
                <div className="plm-mut" style={{ fontSize: 10.5 }}>{historyRows[0].when} · {historyRows[0].who}</div>
              </div>
              <div className="blueprint" style={{ padding: '10px 12px' }}>
                <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
                <div className="plm-hd" style={{ marginBottom: 6 }}>Previous logged change</div>
                <div className="plm-mono" style={{ fontSize: 15, marginBottom: 4 }}>{historyRows[1].rev || selItem.rev}</div>
                <div style={{ marginTop: 8, fontSize: 11.5 }}>{historyRows[1].what}</div>
                <div className="plm-mut" style={{ fontSize: 10.5 }}>{historyRows[1].when} · {historyRows[1].who}</div>
              </div>
            </div>
          )}
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
              <button className="btn btn-secondary" onClick={() => setCrOpen(false)} disabled={crSubmitting}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={submitCr} disabled={!crDraft.title.trim() || crSubmitting}>
                {crSubmitting ? 'Submitting…' : 'Submit'}
              </button>
            </>
          }
        >
          {crError && (
            <div className="plm-mut" style={{ fontSize: 11.5, color: 'var(--color-accent-800)' }}>
              {crError}
            </div>
          )}
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

      {itemDialog && (
        <Dialog
          title={itemDialog.mode === 'create' ? 'New BOM Item' : `Edit ${selItem.pn}`}
          onClose={() => setItemDialog(null)}
          actions={
            <>
              <button className="btn btn-secondary" onClick={() => setItemDialog(null)} disabled={itemBusy}>
                Cancel
              </button>
              <button className="btn btn-primary" data-testid="save-item" onClick={saveItem} disabled={itemBusy}>
                {itemBusy ? 'Saving…' : itemDialog.mode === 'create' ? 'Create item' : 'Save changes'}
              </button>
            </>
          }
        >
          {itemError && (
            <div style={{ fontSize: 11.5, color: 'var(--color-accent-800)' }}>{itemError}</div>
          )}
          <div className="field">
            <label>{itemDialog.mode === 'create' ? 'Parent assembly' : 'Item'}</label>
            <div className="plm-mono" style={{ fontSize: 13 }}>
              {itemDialog.mode === 'create'
                ? `${ITEMS[itemDialog.parent].pn} ${ITEMS[itemDialog.parent].rev} · ${ITEMS[itemDialog.parent].name}`
                : `${selItem.pn} ${selItem.rev} · ${selItem.name}`}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {draftInput('Part number', 'pn', { placeholder: 'ABC-12345' })}
            {itemDialog.mode === 'create' ? (
              draftInput('Revision', 'rev', { placeholder: '/A' })
            ) : (
              <div className="field">
                <label>Revision</label>
                <div className="plm-mono" style={{ fontSize: 13 }}>
                  {selItem.rev}
                  <span className="plm-mut" style={{ fontSize: 10.5 }}> · use Revise to change</span>
                </div>
              </div>
            )}
          </div>
          {draftInput('Name', 'name', { placeholder: 'Descriptive part name' })}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field">
              <label>Type</label>
              <select
                className="input"
                value={itemDraft.kind}
                onChange={(e) => setItemDraft((d) => ({ ...d, kind: e.target.value as 'asm' | 'part' }))}
              >
                <option value="part">Part</option>
                <option value="asm">Assembly</option>
              </select>
            </div>
            {draftInput('Find number', 'find', { placeholder: '110' })}
            {draftInput('Qty per', 'qty')}
            {draftInput('UOM', 'uom', { placeholder: 'EA' })}
            <div className="field">
              <label>Make / buy</label>
              <select
                className="input"
                value={itemDraft.mb}
                onChange={(e) => setItemDraft((d) => ({ ...d, mb: e.target.value as 'Make' | 'Buy' }))}
              >
                <option value="Make">Make</option>
                <option value="Buy">Buy</option>
              </select>
            </div>
            <div className="field">
              <label>Lifecycle state</label>
              <select
                className="input"
                value={itemDraft.state}
                onChange={(e) => setItemDraft((d) => ({ ...d, state: e.target.value as LifecycleState }))}
              >
                {ALL_STATES.map((s) => (
                  <option key={s} value={s}>
                    {STATE_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            {draftInput('Unit mass (kg)', 'mass')}
            {draftInput('Unit cost', 'cost')}
            {draftInput('Effective date', 'eff', { type: 'date' })}
            {draftInput('Owner', 'owner')}
          </div>
          {draftInput('Classification', 'cls', { placeholder: 'PWT / ESS / Module' })}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {draftInput('Plant', 'plant', { placeholder: 'Plant 2 · Line B' })}
            {draftInput('Supplier', 'supplier', { placeholder: '—' })}
          </div>
          <div className="plm-mut" style={{ fontSize: 10.5 }}>
            {itemDialog.mode === 'create'
              ? 'Creates a row in the items table plus a revision-history and activity-log entry.'
              : 'Saved changes are written to the items table and every changed field is recorded in the activity log.'}
          </div>
        </Dialog>
      )}

      {reviseOpen && (
        <Dialog
          title={`Revise ${selItem.pn}`}
          onClose={() => setReviseOpen(false)}
          actions={
            <>
              <button className="btn btn-secondary" onClick={() => setReviseOpen(false)} disabled={itemBusy}>
                Cancel
              </button>
              <button className="btn btn-primary" data-testid="confirm-revise" onClick={doRevise} disabled={itemBusy}>
                {itemBusy ? 'Revising…' : 'Revise'}
              </button>
            </>
          }
        >
          {itemError && <div style={{ fontSize: 11.5, color: 'var(--color-accent-800)' }}>{itemError}</div>}
          <div className="field">
            <label>Current revision</label>
            <div className="plm-mono" style={{ fontSize: 13 }}>
              {selItem.rev} · {STATE_LABEL[selItem.state]}
            </div>
          </div>
          <div className="field">
            <label>New revision</label>
            <input
              className="input"
              value={reviseDraft.revision}
              placeholder="Next in sequence"
              onChange={(e) => setReviseDraft((d) => ({ ...d, revision: e.target.value }))}
            />
          </div>
          <div className="field">
            <label>Reason</label>
            <textarea
              className="input"
              value={reviseDraft.note}
              placeholder="Why the item is being revised"
              onChange={(e) => setReviseDraft((d) => ({ ...d, note: e.target.value }))}
            />
          </div>
          <div className="plm-mut" style={{ fontSize: 10.5 }}>
            The item moves to In Work and loses its effectivity date until it is released again. The revision
            change is appended to its history.
          </div>
        </Dialog>
      )}

      {deleteOpen && (
        <Dialog
          title={`Delete ${selItem.pn}`}
          onClose={() => setDeleteOpen(false)}
          actions={
            <>
              <button className="btn btn-secondary" onClick={() => setDeleteOpen(false)} disabled={itemBusy}>
                Cancel
              </button>
              <button className="btn btn-primary" data-testid="confirm-delete" onClick={doDelete} disabled={itemBusy}>
                {itemBusy ? 'Deleting…' : 'Delete item'}
              </button>
            </>
          }
        >
          {itemError && <div style={{ fontSize: 11.5, color: 'var(--color-accent-800)' }}>{itemError}</div>}
          <div className="field">
            <label>Item</label>
            <div className="plm-mono" style={{ fontSize: 13 }}>
              {selItem.pn} {selItem.rev} · {selItem.name}
            </div>
          </div>
          {selHasKids ? (
            <div style={{ fontSize: 12 }}>
              This assembly still has {kidsOf(sel).length} child line{kidsOf(sel).length === 1 ? '' : 's'}. Delete
              those first — the database will refuse to remove a line that others hang from.
            </div>
          ) : (
            <div style={{ fontSize: 12 }}>
              The item and its revision history are removed from the database, along with any change requests
              raised against it. The activity log keeps a record of the deletion.
            </div>
          )}
        </Dialog>
      )}
    </div>
  )
}

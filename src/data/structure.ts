// VP2 (D-Segment BEV) as-designed product structure. The dataset itself
// now lives in SQLite (see server/) — this module fetches it once at
// startup and exposes the same tree-walking helpers the UI relies on.

export type LifecycleState = 'rel' | 'wip' | 'rev' | 'obs'

export interface StructureItem {
  id: string
  parent: string | null
  find: string
  pn: string
  rev: string
  name: string
  kind: 'asm' | 'part'
  qty: number
  uom: string
  mb: 'Make' | 'Buy'
  mass: number
  cost: number
  state: LifecycleState
  eff: string
  owner: string
  cls: string
  plant: string
  supplier: string
}

export let ITEMS: Record<string, StructureItem> = {}
export let KIDS: Record<string, string[]> = {}

/** Fetches the product structure from the API and builds the lookup maps. Call once at app startup. */
export async function loadStructureData(): Promise<void> {
  const res = await fetch('/api/items')
  if (!res.ok) throw new Error(`Failed to load items: ${res.status} ${res.statusText}`)
  const rows: StructureItem[] = await res.json()

  const items: Record<string, StructureItem> = {}
  const kids: Record<string, string[]> = {}
  rows.forEach((it) => {
    items[it.id] = it
    if (it.parent) (kids[it.parent] = kids[it.parent] || []).push(it.id)
  })
  ITEMS = items
  KIDS = kids
}

export const STATE_LABEL: Record<LifecycleState, string> = {
  rel: 'Released',
  wip: 'In Work',
  rev: 'Under Review',
  obs: 'Superseded',
}

export function kidsOf(id: string): string[] {
  return KIDS[id] || []
}

export function chainOf(id: string): StructureItem[] {
  const out: StructureItem[] = []
  let c: string | null = id
  while (c) {
    out.unshift(ITEMS[c])
    c = ITEMS[c].parent
  }
  return out
}

export function rollupMass(id: string): number {
  if (!kidsOf(id).length) return ITEMS[id].mass
  let m = 0
  const walk = (n: string, mult: number) => {
    kidsOf(n).forEach((k) => {
      const it = ITEMS[k]
      m += it.mass * it.qty * mult
      walk(k, mult * it.qty)
    })
  }
  walk(id, 1)
  return m
}

export function searchItems(query: string, limit = 8): StructureItem[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  return Object.values(ITEMS)
    .filter((it) => it.pn.toLowerCase().includes(needle) || it.name.toLowerCase().includes(needle))
    .slice(0, limit)
}

/** Threshold for the "Mass over target" saved query, in kg per unit mass. */
export const MASS_TARGET_KG = 5

export type SavedQueryKey = 'pending' | 'mass' | 'supplier'

export const SAVED_QUERIES: { key: SavedQueryKey; label: string }[] = [
  { key: 'pending', label: 'Parts pending release' },
  { key: 'mass', label: 'Mass over target' },
  { key: 'supplier', label: 'Supplier-owned, VP2' },
]

export function savedQueryIds(key: SavedQueryKey): string[] {
  const items = Object.values(ITEMS).filter((it) => it.parent !== null)
  switch (key) {
    case 'pending':
      return items.filter((it) => it.state === 'wip' || it.state === 'rev').map((it) => it.id)
    case 'mass':
      return items.filter((it) => it.mass > MASS_TARGET_KG).map((it) => it.id)
    case 'supplier':
      return items.filter((it) => it.mb === 'Buy').map((it) => it.id)
  }
}

export function isEffectiveAsOf(item: StructureItem, date: string): boolean {
  if (item.eff === '—') return false
  return item.eff <= date
}

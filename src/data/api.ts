// Thin client for the PLM demo API (server/index.js), backed by MySQL.

import type { LifecycleState, StructureItem } from './structure'

export type CrStatus = 'submitted' | 'approved' | 'rejected'

/** The item attributes the API lets a client write. */
export type ItemFields = Pick<
  StructureItem,
  'find' | 'pn' | 'name' | 'kind' | 'qty' | 'uom' | 'mb' | 'mass' | 'cost' | 'state' | 'eff' | 'owner' | 'cls' | 'plant' | 'supplier'
>

export interface ItemSearchFilters {
  q: string
  state?: LifecycleState[]
  mb?: ('Make' | 'Buy')[]
  limit?: number
}

export interface DeletedItem {
  deleted: string
  pn: string
  rev: string
  name: string
  parent: string | null
}

export interface ChangeRequest {
  id: number
  ecoNumber: string
  title: string
  description: string | null
  itemId: string
  partPn: string
  partName: string
  priority: string
  status: CrStatus
  submittedBy: string
  submittedAt: string
  decidedBy: string | null
  decidedAt: string | null
}

export interface ActivityEntry {
  id: number
  happenedAt: string
  actor: string
  action: string
  itemId: string | null
  partPn: string | null
  partName: string | null
  changeRequestId: number | null
  ecoNumber: string | null
  detail: string
}

export interface HistoryEntry {
  when: string
  rev: string
  what: string
  who: string
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `${res.status} ${res.statusText}`)
  }
  return res.json()
}

const send = <T>(path: string, method: string, body: unknown) =>
  fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => asJson<T>(r))

export const api = {
  itemHistory: (itemId: string) => fetch(`/api/items/${itemId}/history`).then((r) => asJson<HistoryEntry[]>(r)),

  /** SQL-backed item search — matches part number, name, classification and supplier. */
  searchItems: ({ q, state, mb, limit }: ItemSearchFilters) => {
    const params = new URLSearchParams({ q })
    if (state?.length) params.set('state', state.join(','))
    if (mb?.length) params.set('mb', mb.join(','))
    if (limit) params.set('limit', String(limit))
    return fetch(`/api/items/search?${params}`).then((r) => asJson<StructureItem[]>(r))
  },

  createItem: (input: { parent: string; rev?: string; actor?: string } & Partial<ItemFields>) =>
    send<StructureItem>('/api/items', 'POST', input),

  updateItem: (id: string, input: { actor?: string } & Partial<ItemFields>) =>
    send<StructureItem>(`/api/items/${id}`, 'PATCH', input),

  reviseItem: (id: string, input: { note?: string; revision?: string; actor?: string }) =>
    send<StructureItem>(`/api/items/${id}/revise`, 'POST', input),

  deleteItem: (id: string, actor: string) =>
    fetch(`/api/items/${id}?actor=${encodeURIComponent(actor)}`, { method: 'DELETE' }).then((r) =>
      asJson<DeletedItem>(r),
    ),

  changeRequests: () => fetch('/api/change-requests').then((r) => asJson<ChangeRequest[]>(r)),

  submitChangeRequest: (input: { itemId: string; title: string; description: string; priority: string; submittedBy: string }) =>
    send<ChangeRequest>('/api/change-requests', 'POST', input),

  decideChangeRequest: (id: number, status: 'approved' | 'rejected', decidedBy: string) =>
    send<ChangeRequest>(`/api/change-requests/${id}`, 'PATCH', { status, decidedBy }),

  activity: (limit = 100) => fetch(`/api/activity?limit=${limit}`).then((r) => asJson<ActivityEntry[]>(r)),
}

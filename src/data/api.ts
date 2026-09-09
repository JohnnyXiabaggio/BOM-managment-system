// Thin client for the PLM demo API (server/index.js), backed by MySQL.

export type CrStatus = 'submitted' | 'approved' | 'rejected'

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

export const api = {
  itemHistory: (itemId: string) => fetch(`/api/items/${itemId}/history`).then((r) => asJson<HistoryEntry[]>(r)),

  changeRequests: () => fetch('/api/change-requests').then((r) => asJson<ChangeRequest[]>(r)),

  submitChangeRequest: (input: { itemId: string; title: string; description: string; priority: string; submittedBy: string }) =>
    fetch('/api/change-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }).then((r) => asJson<ChangeRequest>(r)),

  decideChangeRequest: (id: number, status: 'approved' | 'rejected', decidedBy: string) =>
    fetch(`/api/change-requests/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, decidedBy }),
    }).then((r) => asJson<ChangeRequest>(r)),

  activity: (limit = 100) => fetch(`/api/activity?limit=${limit}`).then((r) => asJson<ActivityEntry[]>(r)),
}

import type { AccountState, AgentKind, AgentModel, ApprovalResponse, NewSessionInput, PolicyMode, SessionMeta, TimelineEvent, TimelineItem } from '@shared/types'

export interface RemoteState {
  version: string
  accounts: Record<AgentKind, AccountState>
  sessions: SessionMeta[]
  recentFolders: string[]
  defaultCwd?: string
  defaultPolicy: PolicyMode
  shareScreen: boolean
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`./api${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  if (!r.ok) {
    let msg = `${r.status}`
    try {
      msg = ((await r.json()) as { error?: string }).error ?? msg
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  return (await r.json()) as T
}

export const api = {
  state: () => req<RemoteState>('/state'),
  items: (id: string) => req<TimelineItem[]>(`/sessions/${id}/items`),
  send: (id: string, text: string) => req<{ ok: true }>(`/sessions/${id}/send`, { method: 'POST', body: JSON.stringify({ text }) }),
  interrupt: (id: string) => req<{ ok: true }>(`/sessions/${id}/interrupt`, { method: 'POST', body: '{}' }),
  policy: (id: string, policy: PolicyMode) => req<SessionMeta>(`/sessions/${id}/policy`, { method: 'POST', body: JSON.stringify({ policy }) }),
  approve: (resp: ApprovalResponse) => req<{ ok: true }>('/approve', { method: 'POST', body: JSON.stringify(resp) }),
  create: (input: NewSessionInput & { text?: string }) => req<SessionMeta>('/sessions', { method: 'POST', body: JSON.stringify(input) }),
  models: (agent: AgentKind) => req<AgentModel[]>(`/models?agent=${agent}`),
  events(onEvent: (ev: TimelineEvent) => void, onStatus: (ok: boolean) => void): () => void {
    const es = new EventSource('./api/events')
    es.addEventListener('hello', () => onStatus(true))
    es.addEventListener('tandem', (e) => onEvent(JSON.parse((e as MessageEvent).data) as TimelineEvent))
    es.onerror = () => onStatus(false)
    return () => es.close()
  }
}

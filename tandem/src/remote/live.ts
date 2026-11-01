import type { RemoteApi, RemoteState } from './types'
import type { AgentModel, SessionMeta, TimelineEvent, TimelineItem } from '@shared/types'

export const DEMO = false

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

export const api: RemoteApi = {
  state: () => req<RemoteState>('/state'),
  items: (id) => req<TimelineItem[]>(`/sessions/${id}/items`),
  send: (id, text) => req(`/sessions/${id}/send`, { method: 'POST', body: JSON.stringify({ text }) }),
  interrupt: (id) => req(`/sessions/${id}/interrupt`, { method: 'POST', body: '{}' }),
  policy: (id, policy) => req<SessionMeta>(`/sessions/${id}/policy`, { method: 'POST', body: JSON.stringify({ policy }) }),
  approve: (resp) => req('/approve', { method: 'POST', body: JSON.stringify(resp) }),
  create: (input) => req<SessionMeta>('/sessions', { method: 'POST', body: JSON.stringify(input) }),
  models: (agent) => req<AgentModel[]>(`/models?agent=${agent}`),
  async frame(src) {
    const r = await fetch(`./api/${src === 'screen' ? 'screen.jpg' : 'browser.png'}?ts=${Date.now()}`)
    if (!r.ok) {
      try {
        return { error: ((await r.json()) as { error?: string }).error ?? `${r.status}` }
      } catch {
        return { error: `${r.status}` }
      }
    }
    return { url: URL.createObjectURL(await r.blob()) }
  },
  events(onEvent, onStatus) {
    const es = new EventSource('./api/events')
    es.addEventListener('hello', () => onStatus(true))
    es.addEventListener('tandem', (e) => onEvent(JSON.parse((e as MessageEvent).data) as TimelineEvent))
    es.onerror = () => onStatus(false)
    return () => es.close()
  }
}

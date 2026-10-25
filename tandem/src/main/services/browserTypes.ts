/** Backend contract the MCP bridge drives. Kept free of Electron imports so the transport is unit-testable. */
import type { BrowserState } from '@shared/types'

export interface ConsoleEntry {
  ts: number
  level: string
  message: string
  source?: string
  line?: number
}

export interface NetworkEntry {
  ts: number
  method: string
  url: string
  status?: number
  resourceType?: string
  error?: string
  durationMs?: number
}

/** How a tool names an element: a ref from `snapshot` (e12), a CSS selector, visible text, or coordinates. */
export interface Target {
  ref?: string
  selector?: string
  text?: string
  x?: number
  y?: number
}

export interface Snapshot {
  url: string
  title: string
  elements: string[]
  text: string
}

export interface BrowserBackend {
  state(): BrowserState
  navigate(url: string): Promise<BrowserState>
  back(): Promise<BrowserState>
  forward(): Promise<BrowserState>
  reload(): Promise<BrowserState>
  snapshot(): Promise<Snapshot>
  screenshot(): Promise<{ base64: string; width: number; height: number }>
  click(target: Target, opts?: { button?: 'left' | 'right' | 'middle'; double?: boolean }): Promise<string>
  type(target: Target | undefined, text: string, opts?: { submit?: boolean; clear?: boolean }): Promise<string>
  pressKey(key: string, modifiers?: string[]): Promise<string>
  scroll(opts: { direction?: 'up' | 'down' | 'left' | 'right'; amount?: number; target?: Target }): Promise<string>
  selectOption(target: Target, value: string): Promise<string>
  getText(): Promise<string>
  evaluate(script: string): Promise<unknown>
  consoleMessages(limit?: number): ConsoleEntry[]
  networkRequests(limit?: number, filter?: string): NetworkEntry[]
  waitFor(opts: { selector?: string; text?: string; ms?: number; timeoutMs?: number }): Promise<string>
  setBusy(action?: string): void
}

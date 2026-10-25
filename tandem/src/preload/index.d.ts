import type { TandemApi } from '@shared/ipc'

declare global {
  interface Window {
    tandem: TandemApi
  }
}
export {}

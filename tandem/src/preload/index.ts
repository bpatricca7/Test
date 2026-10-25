import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type TandemApi } from '@shared/ipc'
import type { TimelineEvent } from '@shared/types'

const api: TandemApi = {
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  pickFolder: (d) => ipcRenderer.invoke(IPC.pickFolder, d),
  openExternal: (u) => ipcRenderer.invoke(IPC.openExternal, u),
  openPath: (p) => ipcRenderer.invoke(IPC.openPath, p),
  accountsGet: () => ipcRenderer.invoke(IPC.accountsGet),
  accountsRefresh: () => ipcRenderer.invoke(IPC.accountsRefresh),
  accountLogin: (a) => ipcRenderer.invoke(IPC.accountLogin, a),
  accountLogout: (a) => ipcRenderer.invoke(IPC.accountLogout, a),
  modelsList: (a) => ipcRenderer.invoke(IPC.modelsList, a),
  sessionsList: () => ipcRenderer.invoke(IPC.sessionsList),
  sessionCreate: (i) => ipcRenderer.invoke(IPC.sessionCreate, i),
  sessionItems: (id) => ipcRenderer.invoke(IPC.sessionItems, id),
  sessionSend: (i) => ipcRenderer.invoke(IPC.sessionSend, i),
  sessionInterrupt: (id) => ipcRenderer.invoke(IPC.sessionInterrupt, id),
  sessionApprove: (r) => ipcRenderer.invoke(IPC.sessionApprove, r),
  sessionSetPolicy: (id, p) => ipcRenderer.invoke(IPC.sessionSetPolicy, id, p),
  sessionSetModel: (id, m, e) => ipcRenderer.invoke(IPC.sessionSetModel, id, m, e),
  sessionSetCapabilities: (id, c) => ipcRenderer.invoke(IPC.sessionSetCapabilities, id, c),
  sessionRename: (id, t) => ipcRenderer.invoke(IPC.sessionRename, id, t),
  sessionDelete: (id) => ipcRenderer.invoke(IPC.sessionDelete, id),
  sessionClose: (id) => ipcRenderer.invoke(IPC.sessionClose, id),
  terminalOpen: (s) => ipcRenderer.invoke(IPC.terminalOpen, s),
  terminalWrite: (id, d) => ipcRenderer.invoke(IPC.terminalWrite, id, d),
  terminalResize: (id, c, r) => ipcRenderer.invoke(IPC.terminalResize, id, c, r),
  terminalClose: (id) => ipcRenderer.invoke(IPC.terminalClose, id),
  terminalList: () => ipcRenderer.invoke(IPC.terminalList),
  settingsGet: () => ipcRenderer.invoke(IPC.settingsGet),
  settingsSet: (p) => ipcRenderer.invoke(IPC.settingsSet, p),
  licenseGet: () => ipcRenderer.invoke(IPC.licenseGet),
  licenseActivate: (k) => ipcRenderer.invoke(IPC.licenseActivate, k),
  onEvent: (handler) => {
    const listener = (_e: IpcRendererEvent, ev: TimelineEvent): void => handler(ev)
    ipcRenderer.on(IPC.event, listener)
    return () => ipcRenderer.off(IPC.event, listener)
  }
}

contextBridge.exposeInMainWorld('tandem', api)

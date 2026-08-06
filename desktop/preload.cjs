/* eslint-disable @typescript-eslint/no-require-imports -- Electron sandboxed preload exposes a limited CommonJS API. */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("simpleDictionaryDesktop", {
  loadState: () => ipcRenderer.invoke("simple-dictionary:load-state"),
  saveState: (value) => ipcRenderer.invoke("simple-dictionary:save-state", value),
});

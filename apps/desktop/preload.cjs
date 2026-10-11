const { contextBridge, ipcRenderer } = require("electron");

const bootstrap = ipcRenderer.sendSync("folio:bootstrap");
if (bootstrap) {
  contextBridge.exposeInMainWorld("folioDesktop", Object.freeze({
    language: bootstrap.language,
    capabilities: bootstrap.capabilities,
    setLanguage: language => ipcRenderer.invoke("folio:language", language),
    refreshCapabilities: () => ipcRenderer.invoke("folio:capabilities"),
    maintenance: command => ipcRenderer.invoke("folio:maintenance", command),
  }));
}

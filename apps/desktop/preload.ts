import { contextBridge } from "electron";
// Identification only: all file access stays behind the local API and native selection grants.
contextBridge.exposeInMainWorld("folio", Object.freeze({ isDesktop: true }));

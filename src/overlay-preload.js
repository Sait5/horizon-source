const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  onOpen: (callback) => ipcRenderer.on('overlay:open', (_event, mode, payload) => callback(mode, payload)),
  onVpn: (callback) => ipcRenderer.on('vpn:state', (_event, state) => callback(state)),
  onVault: (callback) => ipcRenderer.on('vault:changed', () => callback()),
  onTheme: (callback) => ipcRenderer.on('theme', (_event, palette) => callback(palette)),
  onSuggest: (callback) => ipcRenderer.on('suggest:update', (_event, data) => callback(data)),
  onFind: (callback) => ipcRenderer.on('find:result', (_event, data) => callback(data)),
  onDownloads: (callback) => ipcRenderer.on('downloads:update', (_event, list) => callback(list)),
  onAccount: (callback) => ipcRenderer.on('account:changed', (_event, state) => callback(state)),
  close: () => ipcRenderer.send('overlay:close'),
  call: async (method, ...args) => {
    const result = await ipcRenderer.invoke('overlay:call', method, args);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  },
});

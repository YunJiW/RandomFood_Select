const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getMenus:      ()           => ipcRenderer.invoke('get-menus'),
  addMenu:       (data)       => ipcRenderer.invoke('add-menu', data),
  updateMenu:    (data)       => ipcRenderer.invoke('update-menu', data),
  deleteMenu:    (id)         => ipcRenderer.invoke('delete-menu', id),
  toggleExclude: (id)         => ipcRenderer.invoke('toggle-exclude', id),
  pickRandom:    ()           => ipcRenderer.invoke('pick-random'),
  getHistory:    ()           => ipcRenderer.invoke('get-history'),
  clearHistory:  ()           => ipcRenderer.invoke('clear-history'),
});

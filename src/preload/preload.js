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
  toggleFavorite:(id)         => ipcRenderer.invoke('toggle-favorite', id),
  recordPick:    (menuName)   => ipcRenderer.invoke('record-pick', menuName),
  closeApp:      ()           => ipcRenderer.invoke('close-app'),
  minimizeApp:   ()           => ipcRenderer.send('minimize-app'),
  maximizeApp:   ()           => ipcRenderer.send('maximize-app'),
  resizeForTab:  (tab)        => ipcRenderer.send('resize-for-tab', tab),
});

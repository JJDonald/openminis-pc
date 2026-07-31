// =============================================================================
// OpenMinis PC - Preload Script
// Bridges theme changes from the renderer to the main process so the custom
// window titlebar (window controls overlay) stays aligned with the app theme.
// =============================================================================

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  /**
   * Notify the main process about the resolved theme ('light' | 'dark')
   * so it can repaint the native window-control overlay colors.
   */
  setTheme: (theme) => {
    ipcRenderer.send('theme-changed', theme === 'light' ? 'light' : 'dark');
  },
});

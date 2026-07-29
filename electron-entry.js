// =============================================================================
// OpenMinis PC - Electron Main Entry
// Native desktop window using the local agent server
// =============================================================================

const { app, BrowserWindow, shell, dialog, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

const PORT = 19840;
let mainWindow = null;
let server = null;
let tray = null;
let isQuitting = false;

// ---- Error Dialog Helper ----
function showError(title, message) {
  console.error(`[OpenMinis] ${title}: ${message}`);
  try {
    dialog.showErrorBox(title, message);
  } catch {
    // dialog might not be available yet
  }
}

// ---- Start the backend server ----
function startBackendServer() {
  return new Promise((resolve, reject) => {
    try {
      // Load the compiled server module
      const serverPath = path.join(__dirname, 'dist', 'main', 'server');
      console.log('[OpenMinis] Loading server from:', serverPath);

      const { startServer } = require(serverPath);
      startServer(PORT, false).then((srv) => {
        server = srv;
        console.log('[OpenMinis] Backend server ready on port', PORT);
        resolve();
      }).catch((err) => {
        console.error('[OpenMinis] Server start error:', err.message);
        reject(new Error('Server failed to start: ' + err.message));
      });
    } catch (err) {
      console.error('[OpenMinis] Module load error:', err.message);
      reject(new Error('Cannot load server module: ' + err.message +
        '\n\nMake sure you have run: npm run build'));
    }
  });
}

// ---- Create Window ----
function createWindow() {
  console.log('[OpenMinis] Creating window...');

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'OpenMinis',
    icon: path.join(__dirname, 'resources', 'icon.png'),
    backgroundColor: '#1a1a2e',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Remove default menu
  mainWindow.setMenuBarVisibility(false);

  mainWindow.once('ready-to-show', () => {
    console.log('[OpenMinis] Window ready, showing...');
    mainWindow.show();
    // Open DevTools in development
    // mainWindow.webContents.openDevTools();
  });

  // ---- Tray behavior: close → hide to tray ----
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      console.log('[OpenMinis] Window hidden to tray');
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open external links in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://localhost:' + PORT) || url.startsWith('file://')) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Handle page load errors
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('[OpenMinis] Page load failed:', errorDescription);
  });

  const url = `http://localhost:${PORT}`;
  console.log('[OpenMinis] Loading URL:', url);
  mainWindow.loadURL(url);
}

// ---- Wait for server to be ready ----
function waitForServer(retries = 20) {
  return new Promise((resolve, reject) => {
    function check(remaining) {
      http.get(`http://localhost:${PORT}/`, (res) => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          retry(remaining);
        }
      }).on('error', () => {
        retry(remaining);
      });
    }

    function retry(remaining) {
      if (remaining <= 0) {
        reject(new Error('Server did not start in time'));
      } else {
        setTimeout(() => check(remaining - 1), 300);
      }
    }

    check(retries);
  });
}

// ---- System Tray ----
function createTray() {
  // Find tray icon: try resources/tray-icon.png, then icon.png, then create fallback
  let trayIconPath = path.join(__dirname, 'resources', 'tray-icon.png');
  if (!fs.existsSync(trayIconPath)) {
    trayIconPath = path.join(__dirname, 'resources', 'icon.png');
  }

  let trayIcon;
  if (fs.existsSync(trayIconPath)) {
    trayIcon = nativeImage.createFromPath(trayIconPath);
    // Resize to 16x16 for proper tray display
    trayIcon = trayIcon.resize({ width: 16, height: 16 });
  } else {
    // Fallback: create a simple 16x16 icon programmatically
    console.log('[OpenMinis] No tray icon found, using fallback');
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('OpenMinis');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show OpenMinis',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // Click tray icon to toggle window
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });

  console.log('[OpenMinis] System tray created');
}

// ---- App Lifecycle ----
app.whenReady().then(async () => {
  console.log('[OpenMinis] Electron app starting...');
  console.log('[OpenMinis] App dir:', __dirname);

  try {
    await startBackendServer();
    await waitForServer();
    createWindow();
    createTray();
    console.log('[OpenMinis] App ready!');
  } catch (err) {
    console.error('[OpenMinis] Startup failed:', err.message);
    showError('OpenMinis - Startup Error',
      'Failed to start OpenMinis.\n\n' + err.message +
      '\n\nPlease make sure you have run:\n  npm run build' +
      '\n\nThen try again with:\n  start-electron.bat');
    app.quit();
  }
});

app.on('window-all-closed', () => {
  // On Windows/Linux, keep app running in tray; on macOS, it's normal to keep alive
  // Don't quit — the app lives in the system tray
  if (process.platform === 'darwin') {
    // macOS convention: keep app alive even with no windows
  }
  // Windows/Linux: stay alive for tray
  console.log('[OpenMinis] All windows closed, staying in tray');
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  console.log('[OpenMinis] Shutting down...');
  isQuitting = true;
  if (tray) {
    tray.destroy();
    tray = null;
  }
  if (server) {
    server.close();
    server = null;
  }
});

// Log unhandled errors
process.on('uncaughtException', (err) => {
  console.error('[OpenMinis] Uncaught exception:', err);
});

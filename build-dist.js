// =============================================================================
// OpenMinis PC - Distribution Builder
// Assembles a full Electron app folder for packaging
// =============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname);
const DIST = path.join(ROOT, 'release', 'OpenMinis');
const ELECTRON_SRC = path.join(process.env.LOCALAPPDATA || '', 'electron', 'Cache', 'electron-v28.0.0-win32-x64');

console.log('=== OpenMinis Distribution Builder ===\n');
console.log('Root:', ROOT);
console.log('Electron:', ELECTRON_SRC);
console.log('Output:', DIST);

// Build into a fresh release directory. If a previous build exists, use a unique
// output directory so no bulk deletion of the Electron runtime is required.
const releaseRoot = path.join(ROOT, 'release');
if (fs.existsSync(releaseRoot)) {
  const backupRoot = `${releaseRoot}-previous-${Date.now()}`;
  fs.renameSync(releaseRoot, backupRoot);
  console.log('Previous release preserved at:', backupRoot);
}

// Create directories
fs.mkdirSync(path.join(DIST, 'resources', 'app'), { recursive: true });
fs.mkdirSync(path.join(DIST, 'locales'), { recursive: true });

// ---- Copy Electron binaries ----
console.log('\n[1/5] Copying Electron runtime...');
const electronFiles = fs.readdirSync(ELECTRON_SRC).filter(f => {
  return !['resources', ' locales'].includes(f.toLowerCase()) &&
         f !== 'swiftshader' &&
         !f.startsWith('locales');
});

for (const f of electronFiles) {
  const src = path.join(ELECTRON_SRC, f);
  if (fs.statSync(src).isFile()) {
    fs.copyFileSync(src, path.join(DIST, f));
  }
}

// Rename electron.exe → OpenMinis.exe
const electronExe = path.join(DIST, 'electron.exe');
const openminisExe = path.join(DIST, 'OpenMinis.exe');
if (fs.existsSync(electronExe)) {
  fs.renameSync(electronExe, openminisExe);
  console.log('  Renamed electron.exe → OpenMinis.exe');
}

// Copy locales
console.log('[2/5] Copying locales...');
const localesSrc = path.join(ELECTRON_SRC, 'locales');
if (fs.existsSync(localesSrc)) {
  const localeFiles = fs.readdirSync(localesSrc).filter(f => f.endsWith('.pak'));
  for (const f of localeFiles.slice(0, 5)) {  // Just a few for size
    fs.copyFileSync(path.join(localesSrc, f), path.join(DIST, 'locales', f));
  }
}

// ---- Copy app files ----
console.log('[3/5] Copying application code...');
const APP = path.join(DIST, 'resources', 'app');

// package.json for Electron
const appPkg = {
  name: 'openminis',
  version: '1.0.0',
  main: 'electron-entry.js',
};
fs.writeFileSync(path.join(APP, 'package.json'), JSON.stringify(appPkg, null, 2));

// electron-entry.js
fs.copyFileSync(path.join(ROOT, 'electron-entry.js'), path.join(APP, 'electron-entry.js'));

// dist (compiled TypeScript)
copyDir(path.join(ROOT, 'dist'), path.join(APP, 'dist'));

// src/renderer (UI files)
copyDir(path.join(ROOT, 'src', 'renderer'), path.join(APP, 'src', 'renderer'));

// resources (icons)
const resourcesDir = path.join(ROOT, 'resources');
if (fs.existsSync(resourcesDir)) {
  copyDir(resourcesDir, path.join(APP, 'resources'));
  console.log('  Copied resources (icons)');
} else {
  fs.mkdirSync(path.join(APP, 'resources'), { recursive: true });
}

// node_modules (only what's needed)
console.log('[4/5] Copying node_modules...');
const neededModules = ['marked'];
fs.mkdirSync(path.join(APP, 'node_modules'), { recursive: true });
for (const mod of neededModules) {
  const src = path.join(ROOT, 'node_modules', mod);
  if (fs.existsSync(src)) {
    copyDir(src, path.join(APP, 'node_modules', mod));
  }
}

// ---- Create app icon (simple placeholder) ----
console.log('[5/5] Creating launcher...');

// Create a VBS launcher for desktop shortcut
const vbsLauncher = `
Set WshShell = CreateObject("WScript.Shell")
Dim appDir
appDir = WshShell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\\OpenMinis"
WshShell.CurrentDirectory = appDir
WshShell.Run """" & appDir & "\\OpenMinis.exe" & """", 1, False
`;
fs.writeFileSync(path.join(ROOT, 'release', 'launcher.vbs'), vbsLauncher.trim());

// Copy launcher to dist folder too
fs.writeFileSync(path.join(DIST, 'launcher.vbs'), vbsLauncher.trim());

// ---- Summary ----
console.log('\n=== Build Complete ===');
console.log('Output:', DIST);

const dirs = getDirSize(DIST);
console.log('Total size:', (dirs / 1024 / 1024).toFixed(1), 'MB');

// ---- Helpers ----
function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

function getDirSize(dir) {
  let size = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) size += getDirSize(p);
      else size += fs.statSync(p).size;
    }
  } catch { /* skip */ }
  return size;
}

const { execSync } = require('child_process');
const path = require('path');

const cacheDir = path.join(process.env.LOCALAPPDATA || '', 'electron', 'Cache');
const zipPath = path.join(cacheDir, 'electron-v28.0.0-win32-x64.zip');
const destDir = path.join(cacheDir, 'electron-v28.0.0-win32-x64');

console.log('Extracting:', zipPath);
console.log('To:', destDir);

const cmd = `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`;
console.log('Running:', cmd);

try {
  execSync(cmd, { stdio: 'inherit' });
  console.log('Extraction complete!');
} catch (e) {
  console.error('Extraction failed:', e.message);
}

/**
 * Mazaj OS - Electron Main Process Entry Point
 * 1. Boots the Express Server (loading compiled .jsc in production or raw JS in dev)
 * 2. Spawns Cloudflare Tunnel (bin/cloudflared.exe) in hidden background process
 * 3. Reads and logs generated trycloudflare.com URL
 * 4. Launches Fullscreen Borderless Kiosk Window pointing to http://localhost:3000/portal.html
 */

const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const bytenode = require('bytenode');

// Load environment variables (prefer .env.production if present)
const prodEnvPath = path.join(__dirname, '.env.production');
const defaultEnvPath = path.join(__dirname, '.env');
try {
  const dotenv = require('dotenv');
  if (fs.existsSync(prodEnvPath)) {
    dotenv.config({ path: prodEnvPath });
  } else if (fs.existsSync(defaultEnvPath)) {
    dotenv.config({ path: defaultEnvPath });
  }
} catch (e) {}

let mainWindow = null;
let cloudflaredProcess = null;
let expressServer = null;

// Determine if running from bytecode compiled bundle
const isPackaged = app.isPackaged || process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;

/**
 * Configure database path in User Data directory for cross-update persistence
 */
function setupUserDataStorage() {
  const userDataPath = app.getPath('userData');
  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
  }

  const targetDb = path.join(userDataPath, 'cafe.db');
  process.env.DATABASE_PATH = targetDb;

  // Copy initial seed DB on first install if not existing
  const sourceDb = path.join(__dirname, 'cafe.db');
  if (!fs.existsSync(targetDb) && fs.existsSync(sourceDb)) {
    try {
      fs.copyFileSync(sourceDb, targetDb);
      console.log(`[Storage] Initialized persistent database at: ${targetDb}`);
    } catch (e) {
      console.error('[Storage] Error copying initial DB:', e);
    }
  }
}

/**
 * 1. Start Express Server
 */
function startExpressServer() {
  try {
    setupUserDataStorage();

    const serverJscPath = path.join(__dirname, 'dist_bytecode/server.jsc');
    if (isPackaged && fs.existsSync(serverJscPath)) {
      console.log('[Server] Loading protected V8 Bytecode (server.jsc)...');
      bytenode.runBytecodeFile(serverJscPath);
    } else {
      console.log('[Server] Loading standard Express server (src/server.js)...');
      require('./src/server.js');
    }
  } catch (err) {
    console.error('[Server] Failed to launch backend service:', err);
    dialog.showErrorBox('خطأ في إطلاق النظام', `تعذر تشغيل خادم النظام الداخلي:\n${err.message}`);
  }
}

/**
 * 2. Start Cloudflare Tunnel (bin/cloudflared.exe)
 */
function startCloudflareTunnel() {
  const isWin = process.platform === 'win32';
  const binName = isWin ? 'cloudflared.exe' : 'cloudflared';
  
  // Look in resources or local bin/
  const possiblePaths = [
    path.join(__dirname, 'bin', binName),
    path.join(__dirname, 'bin', 'cloudflared-windows-amd64.exe'),
    path.join(process.resourcesPath, 'bin', binName),
    path.join(process.resourcesPath, 'bin', 'cloudflared-windows-amd64.exe')
  ];

  let binaryPath = possiblePaths.find(p => fs.existsSync(p));

  if (!binaryPath) {
    console.warn(`[Cloudflare] Binary not found in bin/${binName}. Remote tunnel disabled.`);
    return;
  }

  try {
    const tunnelToken = (process.env.CLOUDFLARE_TUNNEL_TOKEN || '').trim();
    const tunnelArgs = tunnelToken
      ? ['tunnel', '--no-autoupdate', 'run', '--token', tunnelToken]
      : ['tunnel', '--url', `http://localhost:${PORT}`];

    console.log(`[Cloudflare] Spawning tunnel child process (${tunnelToken ? 'Permanent Named Tunnel' : 'Ephemeral Quick Tunnel'}) from: ${binaryPath}`);
    cloudflaredProcess = spawn(binaryPath, tunnelArgs, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    // Parse tunnel output for generated public URL
    const parseOutput = (data) => {
      const text = data.toString();
      const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (match) {
        const publicUrl = match[0];
        console.log('\n======================================================');
        console.log(`🌐 CLOUDFLARE PUBLIC TUNNEL ACTIVE: ${publicUrl}`);
        console.log('======================================================\n');
        process.env.PUBLIC_TUNNEL_URL = publicUrl;
      }
    };

    cloudflaredProcess.stdout.on('data', parseOutput);
    cloudflaredProcess.stderr.on('data', parseOutput);

    cloudflaredProcess.on('error', (err) => {
      console.error('[Cloudflare] Tunnel process error:', err.message);
    });

    cloudflaredProcess.on('exit', (code) => {
      console.log(`[Cloudflare] Tunnel process exited with code ${code}`);
    });
  } catch (err) {
    console.error('[Cloudflare] Could not start tunnel:', err.message);
  }
}

/**
 * 3. Create Fullscreen Borderless Desktop Window
 */
function createMainWindow() {
  mainWindow = new BrowserWindow({
    fullscreen: true,
    frame: false,
    autoHideMenuBar: true,
    kiosk: false, // Allows admin exit via window controls or shortcut
    backgroundColor: '#020617',
    icon: path.join(__dirname, 'public/icons/icon-512x512.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true
    }
  });

  // Load portal / entry point
  const targetUrl = `http://localhost:${PORT}/portal.html`;
  
  // Wait slightly for Express to bind
  setTimeout(() => {
    mainWindow.loadURL(targetUrl).catch(() => {
      // Fallback to root if portal.html isn't standard
      mainWindow.loadURL(`http://localhost:${PORT}/index.html`);
    });
  }, 1000);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// App Lifecycle
app.whenReady().then(() => {
  startExpressServer();
  startCloudflareTunnel();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  // Cleanup child processes on exit
  if (cloudflaredProcess) {
    try {
      cloudflaredProcess.kill();
    } catch (e) {}
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (cloudflaredProcess) {
    try {
      cloudflaredProcess.kill();
    } catch (e) {}
  }
});

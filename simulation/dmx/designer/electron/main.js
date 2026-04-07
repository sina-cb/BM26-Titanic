import { app, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = process.env.NODE_ENV === 'development';

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "Fixture Designer",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // Remove menu bar for cleaner UI
  win.setMenuBarVisibility(false);

  if (isDev) {
    // In dev, Vite serves the app on 5173
    win.loadURL('http://localhost:5173');
    // win.webContents.openDevTools();
  } else {
    // In prod, load from the built dist folder
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

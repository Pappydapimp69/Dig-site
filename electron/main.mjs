// Desktop wrapper for Steam builds.
import { app, BrowserWindow } from 'electron';
import { startServer } from '../scripts/serve.mjs';

async function createWindow() {
  const server = await startServer(0);
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#070b07',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true },
  });
  win.loadURL(`http://127.0.0.1:${server.address().port}/`);
  win.on('closed', () => server.close());
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

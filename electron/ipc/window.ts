import { ipcMain, BrowserWindow } from 'electron';

// Window controls for the custom title bar (the window is frameless).
export function registerWindowIpc(): void {
  const fromSender = (e: Electron.IpcMainInvokeEvent) => BrowserWindow.fromWebContents(e.sender);

  ipcMain.handle('window:minimize', (e) => fromSender(e)?.minimize());
  ipcMain.handle('window:toggleMaximize', (e) => {
    const win = fromSender(e);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  // Goes through the normal 'close' event, so pending saves still flush.
  ipcMain.handle('window:close', (e) => fromSender(e)?.close());
  ipcMain.handle('window:isMaximized', (e) => fromSender(e)?.isMaximized() ?? false);
}

/** Tells the renderer when the maximize/restore button should change icon. */
export function forwardMaximizedState(win: BrowserWindow): void {
  const send = () => win.webContents.send('window:maximized', win.isMaximized());
  win.on('maximize', send);
  win.on('unmaximize', send);
}

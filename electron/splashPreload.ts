import { contextBridge, ipcRenderer } from 'electron';

// The splash window only needs two signals: the main process saying the app
// window is ready, and the splash saying its exit animation has finished.
contextBridge.exposeInMainWorld('splash', {
  onFinish: (callback: () => void) => {
    ipcRenderer.once('splash:finish', () => callback());
  },
  done: () => ipcRenderer.send('splash:done'),
});

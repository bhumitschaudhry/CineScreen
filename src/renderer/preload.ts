import { contextBridge, ipcRenderer } from 'electron';
import type { RecordingConfig, CursorConfig, ZoomConfig, MouseEffectsConfig, PermissionStatus, RecordingState } from '../types';

contextBridge.exposeInMainWorld('electronAPI', {
  checkPermissions: (): Promise<PermissionStatus> =>
    ipcRenderer.invoke('check-permissions'),

  requestPermissions: (): Promise<void> =>
    ipcRenderer.invoke('request-permissions'),

  startRecording: (config: RecordingConfig): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('start-recording', config),

  stopRecording: (config: {
    cursorConfig: CursorConfig;
    zoomConfig?: ZoomConfig;
    mouseEffectsConfig?: MouseEffectsConfig;
  }): Promise<{ success: boolean; outputPath: string }> =>
    ipcRenderer.invoke('stop-recording', config),

  getRecordingState: (): Promise<RecordingState> =>
    ipcRenderer.invoke('get-recording-state'),

  selectOutputPath: (): Promise<string | null> =>
    ipcRenderer.invoke('select-output-path'),

  onDebugLog: (callback: (message: string) => void) => {
    ipcRenderer.on('debug-log', (_event, message: string) => callback(message));
  },

  removeDebugLogListener: () => {
    ipcRenderer.removeAllListeners('debug-log');
  },
});


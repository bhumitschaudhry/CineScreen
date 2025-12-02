import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { setLogSender } from './screen-capture';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { ScreenCapture } from './screen-capture';
import { MouseTracker } from './mouse-tracker';
import { VideoProcessor } from '../processing/video-processor';
import {
  checkAllPermissions,
  requestMissingPermissions,
} from './permissions';
import type { RecordingConfig, CursorConfig, RecordingState } from '../types';

// Debug logging helper
const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';
const debugLog = (...args: unknown[]) => {
  const message = args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
  ).join(' ');
  const logEntry = `[Main] ${message}`;
  
  if (DEBUG) {
    console.log(logEntry);
  }
  
  // Send log to renderer if window exists
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('debug-log', logEntry);
  }
};

let mainWindow: BrowserWindow | null = null;
let screenCapture: ScreenCapture | null = null;
let mouseTracker: MouseTracker | null = null;
let recordingState: RecordingState = {
  isRecording: false,
};

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

function createWindow(): void {
  const preloadPath = isDev
    ? join(__dirname, '../renderer/preload.js') // In dev, preload is compiled to dist/main/renderer
    : join(__dirname, '../renderer/preload.js');

  mainWindow = new BrowserWindow({
    width: 500,
    height: 800,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: 'Mac Screen Recorder',
    resizable: true,
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Set up log forwarding for screen capture after window is ready
  mainWindow.webContents.once('did-finish-load', () => {
    setLogSender((message: string) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('debug-log', message);
      }
    });
  });
}

app.whenReady().then(() => {
  debugLog('App ready, creating window');
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      debugLog('App activated, creating new window');
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers

ipcMain.handle('check-permissions', async () => {
  debugLog('IPC: check-permissions called');
  const permissions = await checkAllPermissions();
  debugLog('Permissions result:', permissions);
  return permissions;
});

ipcMain.handle('request-permissions', async () => {
  debugLog('IPC: request-permissions called');
  await requestMissingPermissions();
  debugLog('Request permissions completed');
});

ipcMain.handle('start-recording', async (_, config: RecordingConfig) => {
  debugLog('IPC: start-recording called with config:', config);
  if (recordingState.isRecording) {
    debugLog('ERROR: Recording already in progress');
    throw new Error('Recording is already in progress');
  }

  // Check permissions first
  debugLog('Checking permissions...');
  const permissions = await checkAllPermissions();
  debugLog('Permissions check result:', permissions);
  if (!permissions.screenRecording || !permissions.accessibility) {
    debugLog('ERROR: Required permissions not granted');
    throw new Error('Required permissions not granted');
  }

  // Initialize components
  debugLog('Initializing screen capture and mouse tracker');
  screenCapture = new ScreenCapture();
  mouseTracker = new MouseTracker();

  // Generate temp file paths
  const tempDir = join(app.getPath('temp'), 'screen-recorder');
  debugLog('Temp directory:', tempDir);
  if (!existsSync(tempDir)) {
    debugLog('Creating temp directory');
    mkdirSync(tempDir, { recursive: true });
  }

  const timestamp = Date.now();
  const tempVideoPath = join(tempDir, `recording_${timestamp}.mkv`);
  const tempMouseDataPath = join(tempDir, `mouse_${timestamp}.json`);
  debugLog('Temp video path:', tempVideoPath);
  debugLog('Temp mouse data path:', tempMouseDataPath);

  recordingState = {
    isRecording: true,
    startTime: Date.now(),
    tempVideoPath,
    tempMouseDataPath,
    outputPath: config.outputPath,
  };

  try {
    // Start mouse tracking
    debugLog('Starting mouse tracking...');
    await mouseTracker.startTracking();
    debugLog('Mouse tracking started');

    // Start screen recording
    debugLog('Starting screen recording...');
    await screenCapture.startRecording({
      ...config,
      outputPath: tempVideoPath,
    });
    debugLog('Screen recording started successfully');

    return { success: true };
  } catch (error) {
    debugLog('ERROR starting recording:', error);
    recordingState.isRecording = false;
    mouseTracker?.stopTracking();
    throw error;
  }
});

ipcMain.handle('stop-recording', async (_, cursorConfig: CursorConfig) => {
  debugLog('IPC: stop-recording called with cursor config:', cursorConfig);
  
  if (!recordingState.isRecording) {
    debugLog('ERROR: No recording in progress');
    throw new Error('No recording in progress');
  }

  try {
    // Stop screen recording
    debugLog('Stopping screen recording...');
    const videoPath = await screenCapture?.stopRecording();
    debugLog('Screen recording stopped, video path:', videoPath);
    if (!videoPath) {
      throw new Error('Failed to stop recording');
    }

    // Stop mouse tracking
    debugLog('Stopping mouse tracking...');
    mouseTracker?.stopTracking();
    debugLog('Mouse tracking stopped');

    // Save mouse data
    if (mouseTracker && recordingState.tempMouseDataPath) {
      debugLog('Saving mouse data to:', recordingState.tempMouseDataPath);
      mouseTracker.saveToFile(recordingState.tempMouseDataPath);
    }

    // Get mouse events
    const mouseEvents = mouseTracker?.getEvents() || [];
    debugLog('Mouse events count:', mouseEvents.length);
    const recordingDuration = Date.now() - (recordingState.startTime || 0);
    debugLog('Recording duration:', recordingDuration, 'ms');

    // Process video with cursor overlay
    debugLog('Processing video with cursor overlay...');
    const processor = new VideoProcessor();
    const finalOutputPath =
      recordingState.outputPath ||
      join(app.getPath('downloads'), `recording_${Date.now()}.mp4`);
    debugLog('Final output path:', finalOutputPath);

    await processor.processVideo({
      inputVideo: videoPath,
      outputVideo: finalOutputPath,
      mouseEvents,
      cursorConfig,
      frameRate: 30,
      videoDuration: recordingDuration,
    });

    // Clean up temp files
    // (In production, you'd want to clean these up)

    recordingState = {
      isRecording: false,
    };

    debugLog('Recording processing completed successfully');
    return {
      success: true,
      outputPath: finalOutputPath,
    };
  } catch (error) {
    debugLog('ERROR processing recording:', error);
    recordingState.isRecording = false;
    throw error;
  }
});

ipcMain.handle('get-recording-state', () => {
  return recordingState;
});

ipcMain.handle('select-output-path', async () => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: 'Save Recording',
    defaultPath: `recording_${Date.now()}.mp4`,
    filters: [
      { name: 'Video Files', extensions: ['mp4', 'mov'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled) {
    return null;
  }

  return result.filePath;
});


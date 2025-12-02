export interface MouseEvent {
  timestamp: number;
  x: number;
  y: number;
  button?: 'left' | 'right' | 'middle';
  action?: 'move' | 'down' | 'up';
}

export interface RecordingConfig {
  outputPath: string;
  frameRate?: number;
  quality?: 'low' | 'medium' | 'high';
  region?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface CursorConfig {
  size: number;
  shape: 'arrow' | 'pointer' | 'hand' | 'crosshair';
  smoothing: number; // 0-1, where 1 is maximum smoothing
  color?: string;
}

export interface RecordingState {
  isRecording: boolean;
  startTime?: number;
  outputPath?: string;
  tempVideoPath?: string;
  tempMouseDataPath?: string;
}

export interface PermissionStatus {
  screenRecording: boolean;
  accessibility: boolean;
}

export interface ZoomConfig {
  enabled: boolean;
  level: number; // 1.5-3.0
  transitionSpeed: number; // ms
  padding: number; // pixels around cursor
  followSpeed: number; // 0-1, how quickly zoom follows mouse
}

export interface MouseEffectsConfig {
  clickCircles: {
    enabled: boolean;
    size: number;
    color: string;
    duration: number; // ms
  };
  trail: {
    enabled: boolean;
    length: number; // frames
    fadeSpeed: number; // 0-1
    color: string;
  };
  highlightRing: {
    enabled: boolean;
    size: number;
    color: string;
    pulseSpeed: number; // 0-1
  };
}


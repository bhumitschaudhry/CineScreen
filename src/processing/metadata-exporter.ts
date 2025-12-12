import { writeFileSync } from 'fs';
import { dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import type { MouseEvent, CursorConfig, ZoomConfig, MouseEffectsConfig, CursorShape } from '../types';
import type { RecordingMetadata, CursorKeyframe, ClickEvent, VideoInfo } from '../types/metadata';
import type { ZoomSection } from './zoom-tracker';
import { getVideoDimensions } from './video-utils';
import { createLogger } from '../utils/logger';
const logger = createLogger('MetadataExporter');

const METADATA_VERSION = '1.0.0';

/**
 * Converts a cursor type string to a valid CursorShape, defaulting to 'arrow' if unknown
 */
function toCursorShape(cursorType: string | undefined): CursorShape {
  if (!cursorType) return 'arrow';
  // Validate the cursor type is a known shape, fall back to 'arrow' if not
  const validShapes: CursorShape[] = [
    'arrow', 'pointer', 'hand', 'openhand', 'closedhand', 'crosshair',
    'ibeam', 'ibeamvertical', 'move', 'resizeleft', 'resizeright',
    'resizeleftright', 'resizeup', 'resizedown', 'resizeupdown', 'resize',
    'copy', 'dragcopy', 'draglink', 'help', 'notallowed', 'contextmenu',
    'poof', 'screenshot', 'zoomin', 'zoomout'
  ];
  return validShapes.includes(cursorType as CursorShape) ? (cursorType as CursorShape) : 'arrow';
}

/**
 * Converts raw mouse events to cursor keyframes
 * Extracts significant position changes and click events
 */
function convertMouseEventsToKeyframes(
  mouseEvents: MouseEvent[],
  videoDuration: number,
  frameRate: number,
  convertToVideoCoordinates?: (x: number, y: number) => { x: number; y: number }
): { cursorKeyframes: CursorKeyframe[]; clickEvents: ClickEvent[] } {
  const cursorKeyframes: CursorKeyframe[] = [];
  const clickEvents: ClickEvent[] = [];

  if (mouseEvents.length === 0) {
    return { cursorKeyframes, clickEvents };
  }

  // Helper to convert coordinates if converter is provided
  const convertCoords = (x: number, y: number) => {
    return convertToVideoCoordinates ? convertToVideoCoordinates(x, y) : { x, y };
  };

  // Extract click events and convert coordinates
  for (const event of mouseEvents) {
    if (event.action === 'down' || event.action === 'up') {
      if (event.button) {
        const pos = convertCoords(event.x, event.y);
        clickEvents.push({
          timestamp: event.timestamp,
          x: pos.x,
          y: pos.y,
          button: event.button,
          action: event.action,
        });
      }
    }
  }

  // Track all move events - include ALL positions for smooth cursor movement
  const moveEvents = mouseEvents.filter(e => e.action === 'move');

  if (moveEvents.length > 0) {
    // Add ALL move events as keyframes for smooth cursor tracking
    // This preserves the high-frequency telemetry data
    for (const event of moveEvents) {
      const pos = convertCoords(event.x, event.y);
      cursorKeyframes.push({
        timestamp: event.timestamp,
        x: pos.x,
        y: pos.y,
        shape: toCursorShape(event.cursorType),
        // Use linear easing for smooth interpolation between dense samples
        easing: 'linear',
      });
    }

    // Ensure we have a keyframe at timestamp 0 if the first event doesn't start there
    if (cursorKeyframes.length > 0 && cursorKeyframes[0].timestamp > 0) {
      const firstPos = convertCoords(moveEvents[0].x, moveEvents[0].y);
      cursorKeyframes.unshift({
        timestamp: 0,
        x: firstPos.x,
        y: firstPos.y,
        shape: toCursorShape(moveEvents[0].cursorType),
        easing: 'linear',
      });
    }

    // Ensure we have a keyframe at video duration
    const lastKeyframe = cursorKeyframes[cursorKeyframes.length - 1];
    if (videoDuration > 0 && lastKeyframe && lastKeyframe.timestamp < videoDuration) {
      cursorKeyframes.push({
        timestamp: videoDuration,
        x: lastKeyframe.x,
        y: lastKeyframe.y,
        shape: lastKeyframe.shape,
      });
    }
  } else if (mouseEvents.length > 0) {
    // Fallback: use first event if no move events
    const firstEvent = mouseEvents[0];
    const firstPos = convertCoords(firstEvent.x, firstEvent.y);
    cursorKeyframes.push({
      timestamp: 0,
      x: firstPos.x,
      y: firstPos.y,
      shape: toCursorShape(firstEvent.cursorType),
      easing: 'linear',
    });

    // Add end keyframe at video duration
    if (videoDuration > 0) {
      const lastEvent = mouseEvents[mouseEvents.length - 1];
      const lastPos = convertCoords(lastEvent.x, lastEvent.y);
      cursorKeyframes.push({
        timestamp: videoDuration,
        x: lastPos.x,
        y: lastPos.y,
        shape: toCursorShape(lastEvent.cursorType),
      });
    }
  }

  // Sort by timestamp
  cursorKeyframes.sort((a, b) => a.timestamp - b.timestamp);
  clickEvents.sort((a, b) => a.timestamp - b.timestamp);

  logger.info(
    `Converted ${mouseEvents.length} mouse events to ${cursorKeyframes.length} cursor keyframes and ${clickEvents.length} click events`
  );

  return { cursorKeyframes, clickEvents };
}


/**
 * Metadata exporter - converts recording data to metadata format
 */
export class MetadataExporter {
  /**
   * Export metadata to JSON file alongside video
   */
  async exportMetadata(options: {
    videoPath: string;
    mouseEvents: MouseEvent[];
    cursorConfig: CursorConfig;
    zoomConfig?: ZoomConfig;
    mouseEffectsConfig?: MouseEffectsConfig;
    frameRate: number;
    videoDuration: number;
    screenDimensions?: { width: number; height: number };
    recordingRegion?: { x: number; y: number; width: number; height: number };
  }): Promise<string> {
    const {
      videoPath,
      mouseEvents,
      cursorConfig,
      zoomConfig,
      mouseEffectsConfig,
      frameRate,
      videoDuration,
      screenDimensions,
      recordingRegion,
    } = options;

    logger.info('Exporting metadata for video:', videoPath);

    // Get video dimensions
    let videoDimensions: { width: number; height: number };
    try {
      videoDimensions = await getVideoDimensions(videoPath);
    } catch (error) {
      logger.error('Failed to get video dimensions:', error);
      throw new Error(`Failed to get video dimensions: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Convert mouse coordinates from screen space to video space
    // Always convert to video coordinate space so metadata stores correct coordinates
    // This handles Retina displays where video is 2x screen resolution
    const convertToVideoCoordinates = (screenX: number, screenY: number): { x: number; y: number } => {
      let x = screenX;
      let y = screenY;

      // If recording region was used, subtract the offset first
      if (recordingRegion) {
        x = screenX - recordingRegion.x;
        y = screenY - recordingRegion.y;
        logger.debug(`Applied region offset: (${screenX}, ${screenY}) -> (${x}, ${y})`);
      }

      // Always scale coordinates if screen dimensions differ from video dimensions
      // This handles Retina displays (2x scaling) and other resolution differences
      let scaleX = 1;
      let scaleY = 1;

      if (recordingRegion) {
        // If region is defined, scale based on region dimensions
        // This handles the case where video is physical pixels (Retina) and region is logical
        scaleX = videoDimensions.width / recordingRegion.width;
        scaleY = videoDimensions.height / recordingRegion.height;
      } else if (screenDimensions &&
        (screenDimensions.width !== videoDimensions.width ||
          screenDimensions.height !== videoDimensions.height)) {
        // Full screen recording: scale based on screen dimensions
        scaleX = videoDimensions.width / screenDimensions.width;
        scaleY = videoDimensions.height / screenDimensions.height;
      }

      if (scaleX !== 1 || scaleY !== 1) {
        const originalX = x;
        const originalY = y;
        x = x * scaleX;
        y = y * scaleY;
        logger.debug(`Scaled coordinates: (${originalX}, ${originalY}) -> (${x}, ${y}) using scale (${scaleX}, ${scaleY})`);
        if (recordingRegion) {
          logger.debug(`Region: ${recordingRegion.width}x${recordingRegion.height}, Video: ${videoDimensions.width}x${videoDimensions.height}`);
        } else if (screenDimensions) {
          logger.debug(`Screen: ${screenDimensions.width}x${screenDimensions.height}, Video: ${videoDimensions.width}x${videoDimensions.height}`);
        }
      }

      // Clamp to video bounds
      x = Math.max(0, Math.min(videoDimensions.width, x));
      y = Math.max(0, Math.min(videoDimensions.height, y));

      return { x, y };
    };

    // Create video info
    const videoInfo: VideoInfo = {
      path: videoPath,
      width: videoDimensions.width,
      height: videoDimensions.height,
      frameRate,
      duration: videoDuration,
    };

    // Convert mouse events to cursor keyframes and click events
    const { cursorKeyframes, clickEvents } = convertMouseEventsToKeyframes(
      mouseEvents,
      videoDuration,
      frameRate,
      convertToVideoCoordinates
    );

    // Zoom sections will be generated from clicks in the studio editor
    // Start with no zoom sections - they will be auto-generated from mouse movement or manually added
    const zoomSections: ZoomSection[] = [];

    // Create metadata object
    const metadata: RecordingMetadata = {
      version: METADATA_VERSION,
      video: videoInfo,
      cursor: {
        keyframes: cursorKeyframes,
        config: cursorConfig,
      },
      zoom: {
        sections: zoomSections,
        config: zoomConfig || {
          enabled: true,
          level: 2.0,
          transitionSpeed: 300,
          padding: 0,
          followSpeed: 1.0,
        },
      },
      clicks: clickEvents,
      effects: mouseEffectsConfig,
      createdAt: Date.now(),
    };

    // Determine output path (same directory as video, with .json extension)
    const videoDir = dirname(videoPath);
    const videoBasename = videoPath.replace(/\.[^/.]+$/, ''); // Remove extension
    const metadataPath = `${videoBasename}.json`;

    // Ensure directory exists
    if (!existsSync(videoDir)) {
      mkdirSync(videoDir, { recursive: true });
    }

    // Write metadata to file
    try {
      writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
      logger.info(`Metadata exported successfully to: ${metadataPath}`);
      return metadataPath;
    } catch (error) {
      logger.error('Failed to write metadata file:', error);
      throw new Error(`Failed to write metadata file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Load metadata from JSON file
   * Note: Frame offset is applied at render time via cursor.config.frameOffset, not here
   */
  static loadMetadata(metadataPath: string): RecordingMetadata {
    const { readFileSync } = require('fs');
    try {
      const data = readFileSync(metadataPath, 'utf-8');
      const metadata = JSON.parse(data) as RecordingMetadata;
      logger.info(`Metadata loaded from: ${metadataPath}`);
      return metadata;
    } catch (error) {
      logger.error('Failed to load metadata:', error);
      throw new Error(`Failed to load metadata: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}


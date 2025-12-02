import sharp from 'sharp';
import { existsSync, readFileSync } from 'fs';
import type { MouseEvent, ZoomConfig } from '../types';
import { createLogger } from '../utils/logger';

const logger = createLogger('SharpRenderer');

export interface FrameRenderOptions {
  frameWidth: number;
  frameHeight: number;
  outputWidth: number;
  outputHeight: number;
  cursorImagePath: string;
  cursorSize: number;
  zoomConfig?: ZoomConfig;
}

export interface FrameData {
  frameIndex: number;
  timestamp: number;
  cursorX: number;
  cursorY: number;
  zoomCenterX?: number;
  zoomCenterY?: number;
  zoomLevel?: number;
}

/**
 * Render a single frame with cursor overlay and zoom effects using Sharp
 */
export async function renderFrame(
  inputPath: string,
  outputPath: string,
  frameData: FrameData,
  options: FrameRenderOptions
): Promise<void> {
  const {
    frameWidth,
    frameHeight,
    outputWidth,
    outputHeight,
    cursorImagePath,
    cursorSize,
    zoomConfig,
  } = options;

  // Load the frame
  let pipeline = sharp(inputPath);

  // Apply zoom if enabled
  if (zoomConfig?.enabled && frameData.zoomLevel && frameData.zoomLevel > 1) {
    const zoomLevel = frameData.zoomLevel;
    const centerX = frameData.zoomCenterX ?? frameData.cursorX;
    const centerY = frameData.zoomCenterY ?? frameData.cursorY;

    // Calculate crop region
    const cropWidth = Math.round(frameWidth / zoomLevel);
    const cropHeight = Math.round(frameHeight / zoomLevel);

    // Center the crop on the cursor position, clamped to frame bounds
    let cropX = Math.round(centerX - cropWidth / 2);
    let cropY = Math.round(centerY - cropHeight / 2);

    // Clamp to bounds
    cropX = Math.max(0, Math.min(frameWidth - cropWidth, cropX));
    cropY = Math.max(0, Math.min(frameHeight - cropHeight, cropY));

    // Extract the zoomed region
    pipeline = pipeline.extract({
      left: cropX,
      top: cropY,
      width: cropWidth,
      height: cropHeight,
    });

    // Adjust cursor position relative to the crop
    frameData.cursorX = frameData.cursorX - cropX;
    frameData.cursorY = frameData.cursorY - cropY;

    // Scale cursor position to output dimensions
    frameData.cursorX = Math.round(frameData.cursorX * (outputWidth / cropWidth));
    frameData.cursorY = Math.round(frameData.cursorY * (outputHeight / cropHeight));
  }

  // Resize to output dimensions
  pipeline = pipeline.resize(outputWidth, outputHeight, {
    fit: 'fill',
    kernel: 'lanczos3',
  });

  // Prepare cursor overlay
  let cursorBuffer: Buffer | null = null;
  if (existsSync(cursorImagePath)) {
    try {
      // Resize cursor to the target size
      cursorBuffer = await sharp(cursorImagePath)
        .resize(cursorSize, cursorSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
    } catch (error) {
      logger.warn('Failed to load cursor image:', error);
    }
  }

  // Calculate cursor overlay position
  // Position is the top-left corner of the cursor image
  const cursorLeft = Math.round(frameData.cursorX);
  const cursorTop = Math.round(frameData.cursorY);

  // Composite cursor overlay
  if (cursorBuffer) {
    // Ensure cursor is within bounds
    const clampedLeft = Math.max(0, Math.min(outputWidth - cursorSize, cursorLeft));
    const clampedTop = Math.max(0, Math.min(outputHeight - cursorSize, cursorTop));

    pipeline = pipeline.composite([
      {
        input: cursorBuffer,
        left: clampedLeft,
        top: clampedTop,
        blend: 'over',
      },
    ]);
  }

  // Write output
  await pipeline.png({ quality: 90, compressionLevel: 6 }).toFile(outputPath);
}

/**
 * Create frame data from mouse events
 */
export function createFrameDataFromEvents(
  events: MouseEvent[],
  frameRate: number,
  videoDuration: number,
  videoDimensions: { width: number; height: number },
  screenDimensions: { width: number; height: number },
  zoomConfig?: ZoomConfig
): FrameData[] {
  const frameInterval = 1000 / frameRate;
  const totalFrames = Math.ceil(videoDuration / frameInterval);
  const frameDataList: FrameData[] = [];

  // Scale factors for Retina displays
  const scaleX = videoDimensions.width / screenDimensions.width;
  const scaleY = videoDimensions.height / screenDimensions.height;

  // Smooth zoom tracking
  let currentZoomX = videoDimensions.width / 2;
  let currentZoomY = videoDimensions.height / 2;
  let currentZoomLevel = 1.0;
  const followSpeed = zoomConfig?.followSpeed ?? 0.1;

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
    const timestamp = frameIndex * frameInterval;

    // Find the mouse event for this frame
    let eventIndex = 0;
    for (let i = 0; i < events.length; i++) {
      if (events[i].timestamp <= timestamp) {
        eventIndex = i;
      } else {
        break;
      }
    }

    const event = events[Math.min(eventIndex, events.length - 1)] || { x: 0, y: 0, timestamp: 0 };

    // Scale mouse coordinates to video coordinates
    const cursorX = event.x * scaleX;
    const cursorY = event.y * scaleY;

    // Calculate zoom
    let zoomCenterX = cursorX;
    let zoomCenterY = cursorY;
    let zoomLevel = 1.0;

    if (zoomConfig?.enabled) {
      zoomLevel = zoomConfig.level;

      // Smooth zoom center tracking
      currentZoomX += (cursorX - currentZoomX) * followSpeed;
      currentZoomY += (cursorY - currentZoomY) * followSpeed;

      zoomCenterX = currentZoomX;
      zoomCenterY = currentZoomY;
    }

    frameDataList.push({
      frameIndex,
      timestamp,
      cursorX,
      cursorY,
      zoomCenterX,
      zoomCenterY,
      zoomLevel,
    });
  }

  return frameDataList;
}

/**
 * Load and prepare cursor image, converting SVG to PNG if needed
 */
export async function prepareCursorImage(
  cursorPath: string,
  size: number,
  outputPath: string
): Promise<string> {
  if (!existsSync(cursorPath)) {
    throw new Error(`Cursor image not found: ${cursorPath}`);
  }

  const isSvg = cursorPath.toLowerCase().endsWith('.svg');

  if (isSvg) {
    // Convert SVG to PNG using Sharp
    const svgBuffer = readFileSync(cursorPath);
    await sharp(svgBuffer, { density: 300 })
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(outputPath);
    return outputPath;
  } else {
    // Already a raster image, just resize
    await sharp(cursorPath)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(outputPath);
    return outputPath;
  }
}


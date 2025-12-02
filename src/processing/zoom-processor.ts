import type { ZoomRegion, VideoDimensions } from './zoom-tracker';
import type { ZoomConfig } from '../types';

/**
 * Per-frame zoom data for Sharp/Canvas rendering
 */
export interface FrameZoomData {
  frameIndex: number;
  timestamp: number;
  centerX: number;
  centerY: number;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  zoomLevel: number;
}

/**
 * Calculate per-frame zoom data from zoom regions
 * This is used by the Sharp renderer for frame-by-frame processing
 */
export function calculateFrameZoomData(
  regions: ZoomRegion[],
  videoDimensions: VideoDimensions,
  frameRate: number,
  videoDuration: number
): FrameZoomData[] {
  const frameInterval = 1000 / frameRate;
  const totalFrames = Math.ceil(videoDuration / frameInterval);
  const frameZoomData: FrameZoomData[] = [];

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
    const timestamp = frameIndex * frameInterval;

    // Find the region for this timestamp (interpolate if needed)
    const zoomData = getZoomDataAtTimestamp(regions, timestamp, videoDimensions);

    frameZoomData.push({
      frameIndex,
      timestamp,
      ...zoomData,
    });
  }

  return frameZoomData;
}

/**
 * Get zoom data at a specific timestamp by interpolating between regions
 */
function getZoomDataAtTimestamp(
  regions: ZoomRegion[],
  timestamp: number,
  videoDimensions: VideoDimensions
): Omit<FrameZoomData, 'frameIndex' | 'timestamp'> {
  if (regions.length === 0) {
    // No zoom - return full frame
    return {
      centerX: videoDimensions.width / 2,
      centerY: videoDimensions.height / 2,
      cropX: 0,
      cropY: 0,
      cropWidth: videoDimensions.width,
      cropHeight: videoDimensions.height,
      zoomLevel: 1.0,
    };
  }

  // Find the two regions that bracket this timestamp
  let prevRegion = regions[0];
  let nextRegion = regions[0];

  for (let i = 0; i < regions.length; i++) {
    if (regions[i].timestamp <= timestamp) {
      prevRegion = regions[i];
      nextRegion = regions[Math.min(i + 1, regions.length - 1)];
    } else {
      break;
    }
  }

  // Interpolate between regions
  const timeDiff = nextRegion.timestamp - prevRegion.timestamp;
  const t = timeDiff > 0 ? (timestamp - prevRegion.timestamp) / timeDiff : 0;

  const centerX = prevRegion.centerX + (nextRegion.centerX - prevRegion.centerX) * t;
  const centerY = prevRegion.centerY + (nextRegion.centerY - prevRegion.centerY) * t;
  const cropWidth = prevRegion.cropWidth + (nextRegion.cropWidth - prevRegion.cropWidth) * t;
  const cropHeight = prevRegion.cropHeight + (nextRegion.cropHeight - prevRegion.cropHeight) * t;
  const zoomLevel = prevRegion.scale + (nextRegion.scale - prevRegion.scale) * t;

  // Calculate crop position (top-left corner)
  let cropX = centerX - cropWidth / 2;
  let cropY = centerY - cropHeight / 2;

  // Clamp to video bounds
  cropX = Math.max(0, Math.min(videoDimensions.width - cropWidth, cropX));
  cropY = Math.max(0, Math.min(videoDimensions.height - cropHeight, cropY));

  return {
    centerX: Math.round(centerX),
    centerY: Math.round(centerY),
    cropX: Math.round(cropX),
    cropY: Math.round(cropY),
    cropWidth: Math.round(cropWidth),
    cropHeight: Math.round(cropHeight),
    zoomLevel,
  };
}

/**
 * Calculate zoom parameters for a single frame
 * Used for on-the-fly calculations in the Sharp renderer
 */
export function calculateZoomForFrame(
  cursorX: number,
  cursorY: number,
  videoDimensions: VideoDimensions,
  zoomConfig: ZoomConfig
): { cropX: number; cropY: number; cropWidth: number; cropHeight: number } {
  if (!zoomConfig.enabled || zoomConfig.level <= 1) {
    return {
      cropX: 0,
      cropY: 0,
      cropWidth: videoDimensions.width,
      cropHeight: videoDimensions.height,
    };
  }

  const cropWidth = Math.round(videoDimensions.width / zoomConfig.level);
  const cropHeight = Math.round(videoDimensions.height / zoomConfig.level);

  // Center on cursor with padding
  let cropX = cursorX - cropWidth / 2;
  let cropY = cursorY - cropHeight / 2;

  // Clamp to video bounds
  cropX = Math.max(0, Math.min(videoDimensions.width - cropWidth, cropX));
  cropY = Math.max(0, Math.min(videoDimensions.height - cropHeight, cropY));

  return {
    cropX: Math.round(cropX),
    cropY: Math.round(cropY),
    cropWidth,
    cropHeight,
  };
}


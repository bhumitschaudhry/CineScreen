import type { MouseEvent, ZoomConfig } from '../types';
import { easeInOut } from './effects';

export interface ZoomRegion {
  timestamp: number;
  centerX: number;
  centerY: number;
  cropWidth: number;
  cropHeight: number;
  scale: number;
}

export interface VideoDimensions {
  width: number;
  height: number;
}

/**
 * Calculate zoom region based on mouse position and zoom config
 */
export function calculateZoomRegion(
  mouseX: number,
  mouseY: number,
  videoDimensions: VideoDimensions,
  zoomConfig: ZoomConfig
): ZoomRegion {
  const { level, padding } = zoomConfig;
  
  // Calculate crop dimensions based on zoom level
  const cropWidth = videoDimensions.width / level;
  const cropHeight = videoDimensions.height / level;
  
  // Calculate center position with padding
  const maxX = videoDimensions.width - cropWidth / 2;
  const minX = cropWidth / 2;
  const maxY = videoDimensions.height - cropHeight / 2;
  const minY = cropHeight / 2;
  
  // Clamp center position to stay within video bounds
  const centerX = Math.max(minX, Math.min(maxX, mouseX));
  const centerY = Math.max(minY, Math.min(maxY, mouseY));
  
  return {
    timestamp: 0, // Will be set by caller
    centerX,
    centerY,
    cropWidth,
    cropHeight,
    scale: level,
  };
}

/**
 * Generate zoom regions for all mouse events with smooth transitions
 */
export function generateZoomRegions(
  events: MouseEvent[],
  videoDimensions: VideoDimensions,
  zoomConfig: ZoomConfig,
  frameRate: number,
  videoDuration: number
): ZoomRegion[] {
  if (!zoomConfig.enabled) {
    // Return default (no zoom) region for entire video
    const defaultRegion: ZoomRegion = {
      timestamp: 0,
      centerX: videoDimensions.width / 2,
      centerY: videoDimensions.height / 2,
      cropWidth: videoDimensions.width,
      cropHeight: videoDimensions.height,
      scale: 1.0,
    };
    return [defaultRegion];
  }

  const regions: ZoomRegion[] = [];
  const frameInterval = 1000 / frameRate;
  const totalFrames = Math.ceil(videoDuration / frameInterval);
  
  let currentRegion: ZoomRegion | null = null;
  let targetRegion: ZoomRegion | null = null;
  let transitionStartTime = 0;
  let transitionDuration = zoomConfig.transitionSpeed;

  // Calculate movement speed to adjust zoom
  function calculateMovementSpeed(eventIndex: number): number {
    if (eventIndex === 0 || eventIndex >= events.length - 1) {
      return 0;
    }
    const prev = events[eventIndex - 1];
    const curr = events[eventIndex];
    const timeDiff = curr.timestamp - prev.timestamp;
    if (timeDiff === 0) return 0;
    
    const distance = Math.sqrt(
      Math.pow(curr.x - prev.x, 2) + Math.pow(curr.y - prev.y, 2)
    );
    return distance / timeDiff; // pixels per ms
  }

  // Interpolate mouse position for each frame
  for (let frame = 0; frame < totalFrames; frame++) {
    const targetTime = frame * frameInterval;
    
    // Find the mouse event closest to this frame time
    let eventIndex = 0;
    for (let i = 0; i < events.length; i++) {
      if (events[i].timestamp <= targetTime) {
        eventIndex = i;
      } else {
        break;
      }
    }
    
    const event = events[Math.min(eventIndex, events.length - 1)];
    const movementSpeed = calculateMovementSpeed(eventIndex);
    
    // Adjust zoom level based on movement speed (slower = more zoom)
    // Speed threshold: if moving faster than threshold, reduce zoom
    const speedThreshold = 2; // pixels per ms
    const adjustedZoomLevel = movementSpeed > speedThreshold
      ? Math.max(1.0, zoomConfig.level - (movementSpeed - speedThreshold) * 0.1)
      : zoomConfig.level;
    
    // Calculate target zoom region
    const adjustedConfig = { ...zoomConfig, level: adjustedZoomLevel };
    targetRegion = calculateZoomRegion(
      event.x,
      event.y,
      videoDimensions,
      adjustedConfig
    );
    targetRegion.timestamp = targetTime;
    
    // Smooth transition from current to target region
    if (!currentRegion) {
      currentRegion = targetRegion;
    } else {
      const timeSinceTransitionStart = targetTime - transitionStartTime;
      const transitionProgress = Math.min(1, timeSinceTransitionStart / transitionDuration);
      const easedProgress = easeInOut(transitionProgress);
      
      // Interpolate between current and target
      currentRegion = {
        timestamp: targetTime,
        centerX: currentRegion.centerX + (targetRegion.centerX - currentRegion.centerX) * easedProgress * zoomConfig.followSpeed,
        centerY: currentRegion.centerY + (targetRegion.centerY - currentRegion.centerY) * easedProgress * zoomConfig.followSpeed,
        cropWidth: currentRegion.cropWidth + (targetRegion.cropWidth - currentRegion.cropWidth) * easedProgress,
        cropHeight: currentRegion.cropHeight + (targetRegion.cropHeight - currentRegion.cropHeight) * easedProgress,
        scale: currentRegion.scale + (targetRegion.scale - currentRegion.scale) * easedProgress,
      };
      
      // If transition complete, update current region
      if (transitionProgress >= 1) {
        currentRegion = targetRegion;
        transitionStartTime = targetTime;
      }
    }
    
    regions.push({ ...currentRegion });
  }

  return regions;
}

/**
 * Get zoom region for a specific timestamp
 */
export function getZoomRegionAtTimestamp(
  regions: ZoomRegion[],
  timestamp: number,
  tolerance: number = 16 // ~1 frame at 60fps
): ZoomRegion | null {
  // Find the closest region
  let closest: ZoomRegion | null = null;
  let minDiff = Infinity;
  
  for (const region of regions) {
    const diff = Math.abs(region.timestamp - timestamp);
    if (diff < minDiff && diff <= tolerance) {
      minDiff = diff;
      closest = region;
    }
  }
  
  // If no exact match, interpolate between two regions
  if (!closest && regions.length > 0) {
    for (let i = 0; i < regions.length - 1; i++) {
      const r1 = regions[i];
      const r2 = regions[i + 1];
      
      if (timestamp >= r1.timestamp && timestamp <= r2.timestamp) {
        const t = (timestamp - r1.timestamp) / (r2.timestamp - r1.timestamp);
        return {
          timestamp,
          centerX: r1.centerX + (r2.centerX - r1.centerX) * t,
          centerY: r1.centerY + (r2.centerY - r1.centerY) * t,
          cropWidth: r1.cropWidth + (r2.cropWidth - r1.cropWidth) * t,
          cropHeight: r1.cropHeight + (r2.cropHeight - r1.cropHeight) * t,
          scale: r1.scale + (r2.scale - r1.scale) * t,
        };
      }
    }
    
    // Return first or last region if outside range
    if (timestamp < regions[0].timestamp) {
      return regions[0];
    }
    return regions[regions.length - 1];
  }
  
  return closest;
}


import type { ZoomRegion } from './zoom-tracker';
import type { VideoDimensions } from './zoom-tracker';

/**
 * Generate FFmpeg filter for dynamic zoom using crop and scale
 */
export function generateZoomFilter(
  regions: ZoomRegion[],
  videoDimensions: VideoDimensions,
  frameRate: number
): string {
  if (regions.length === 0) {
    return '[0:v]copy[zoomed]';
  }

  // If only one region and no zoom (scale = 1), return passthrough
  if (regions.length === 1 && regions[0].scale === 1.0) {
    return '[0:v]copy[zoomed]';
  }

  // Build dynamic crop and scale filter
  // We'll use keyframes to optimize the filter complexity
  const keyframeInterval = Math.max(1, Math.floor(regions.length / 100)); // Sample ~100 keyframes
  const keyframes: ZoomRegion[] = [];

  for (let i = 0; i < regions.length; i += keyframeInterval) {
    keyframes.push(regions[i]);
  }

  // Add last region if not already included
  if (keyframes.length === 0 || keyframes[keyframes.length - 1] !== regions[regions.length - 1]) {
    keyframes.push(regions[regions.length - 1]);
  }

  // Build crop expressions for x, y, width, height
  // Crop: crop=width:height:x:y
  // Scale: scale=width:height
  
  let xExpression = keyframes[0].centerX - keyframes[0].cropWidth / 2;
  let yExpression = keyframes[0].centerY - keyframes[0].cropHeight / 2;
  let widthExpression = keyframes[0].cropWidth;
  let heightExpression = keyframes[0].cropHeight;

  // For simplicity, we'll use a piecewise linear interpolation
  // FFmpeg expressions can be complex, so we'll generate a simpler version
  // that uses keyframes with interpolation

  // Build expressions for dynamic crop
  const timeToSeconds = (timestamp: number) => timestamp / 1000;
  
  // Create expression strings for x, y, width, height
  let xExpr = `${Math.max(0, xExpression)}`;
  let yExpr = `${Math.max(0, yExpression)}`;
  let wExpr = `${widthExpression}`;
  let hExpr = `${heightExpression}`;

  // Add interpolation for keyframes
  for (let i = 1; i < keyframes.length; i++) {
    const prev = keyframes[i - 1];
    const curr = keyframes[i];
    const prevTime = timeToSeconds(prev.timestamp);
    const currTime = timeToSeconds(curr.timestamp);
    const timeDiff = currTime - prevTime;

    if (timeDiff > 0) {
      const prevX = Math.max(0, prev.centerX - prev.cropWidth / 2);
      const currX = Math.max(0, curr.centerX - curr.cropWidth / 2);
      const prevY = Math.max(0, prev.centerY - prev.cropHeight / 2);
      const currY = Math.max(0, curr.centerY - curr.cropHeight / 2);
      
      const xSlope = (currX - prevX) / timeDiff;
      const ySlope = (currY - prevY) / timeDiff;
      const wSlope = (curr.cropWidth - prev.cropWidth) / timeDiff;
      const hSlope = (curr.cropHeight - prev.cropHeight) / timeDiff;

      // Linear interpolation: value = prevValue + slope * max(0, min(timeDiff, t - prevTime))
      xExpr += `+(${xSlope})*max(0,min(${timeDiff},t-${prevTime}))`;
      yExpr += `+(${ySlope})*max(0,min(${timeDiff},t-${prevTime}))`;
      wExpr += `+(${wSlope})*max(0,min(${timeDiff},t-${prevTime}))`;
      hExpr += `+(${hSlope})*max(0,min(${timeDiff},t-${prevTime}))`;
    }
  }

  // Clamp values to video dimensions
  const maxX = videoDimensions.width;
  const maxY = videoDimensions.height;
  
  xExpr = `max(0,min(${maxX}-w,${xExpr}))`;
  yExpr = `max(0,min(${maxY}-h,${yExpr}))`;
  wExpr = `min(${maxX},max(1,${wExpr}))`;
  hExpr = `min(${maxY},max(1,${hExpr}))`;

  // Generate crop filter
  const cropFilter = `crop=${wExpr}:${hExpr}:${xExpr}:${yExpr}`;
  
  // Scale to original dimensions if needed (for zoom in)
  // If we're cropping smaller than original, we need to scale up
  const needsScale = keyframes.some(r => r.scale > 1.0);
  
  if (needsScale) {
    // Scale back to original dimensions
    return `[0:v]${cropFilter},scale=${videoDimensions.width}:${videoDimensions.height}[zoomed]`;
  } else {
    return `[0:v]${cropFilter}[zoomed]`;
  }
}

/**
 * Generate a simpler zoom filter using fixed keyframes
 * This is more reliable but less smooth
 */
export function generateSimpleZoomFilter(
  regions: ZoomRegion[],
  videoDimensions: VideoDimensions
): string {
  if (regions.length === 0 || (regions.length === 1 && regions[0].scale === 1.0)) {
    return '[0:v]copy[zoomed]';
  }

  // Use the first region's zoom settings (or average)
  // For a more dynamic version, we'd need to use FFmpeg's complex filter with multiple inputs
  const region = regions[Math.floor(regions.length / 2)];
  
  if (region.scale === 1.0) {
    return '[0:v]copy[zoomed]';
  }

  const cropWidth = region.cropWidth;
  const cropHeight = region.cropHeight;
  const cropX = Math.max(0, region.centerX - cropWidth / 2);
  const cropY = Math.max(0, region.centerY - cropHeight / 2);

  // Clamp to video dimensions
  const finalCropWidth = Math.min(videoDimensions.width, cropWidth);
  const finalCropHeight = Math.min(videoDimensions.height, cropHeight);
  const finalCropX = Math.max(0, Math.min(videoDimensions.width - finalCropWidth, cropX));
  const finalCropY = Math.max(0, Math.min(videoDimensions.height - finalCropHeight, cropY));

  return `[0:v]crop=${finalCropWidth}:${finalCropHeight}:${finalCropX}:${finalCropY},scale=${videoDimensions.width}:${videoDimensions.height}[zoomed]`;
}


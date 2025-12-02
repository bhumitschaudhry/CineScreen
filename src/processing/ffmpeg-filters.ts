import type { MouseEvent } from '../types';
import type { EffectFrame } from './mouse-effects';

/**
 * Create FFmpeg filter complex for cursor overlay
 * Uses a data file approach for frame-by-frame positioning
 */
export function createCursorOverlayFilter(
  events: MouseEvent[],
  cursorSize: number
): string {
  if (events.length === 0) {
    return '[0:v]copy[out]';
  }

  // Create a simpler approach: use linear interpolation expression
  // For better performance, we'll sample keyframes and interpolate
  const keyframeInterval = Math.max(1, Math.floor(events.length / 100)); // Sample ~100 keyframes
  const keyframes: Array<{ time: number; x: number; y: number }> = [];

  for (let i = 0; i < events.length; i += keyframeInterval) {
    const event = events[i];
    keyframes.push({
      time: event.timestamp / 1000,
      x: Math.max(0, event.x - cursorSize / 2),
      y: Math.max(0, event.y - cursorSize / 2),
    });
  }

  // Add last frame
  const lastEvent = events[events.length - 1];
  if (keyframes.length === 0 || keyframes[keyframes.length - 1]?.time !== lastEvent.timestamp / 1000) {
    keyframes.push({
      time: lastEvent.timestamp / 1000,
      x: Math.max(0, lastEvent.x - cursorSize / 2),
      y: Math.max(0, lastEvent.y - cursorSize / 2),
    });
  }

  // Build simpler expression using keyframes
  // Use piecewise linear interpolation
  let xExpression = keyframes[0].x.toString();
  let yExpression = keyframes[0].y.toString();

  for (let i = 1; i < keyframes.length; i++) {
    const prev = keyframes[i - 1];
    const curr = keyframes[i];
    const timeDiff = curr.time - prev.time;

    if (timeDiff > 0) {
      // Linear interpolation: x = x0 + (x1 - x0) * (t - t0) / (t1 - t0)
      const xSlope = (curr.x - prev.x) / timeDiff;
      const ySlope = (curr.y - prev.y) / timeDiff;
      
      xExpression += `+(${xSlope})*max(0,min(${timeDiff},t-${prev.time}))`;
      yExpression += `+(${ySlope})*max(0,min(${timeDiff},t-${prev.time}))`;
    }
  }

  // Create overlay filter with dynamic positioning
  // Scale cursor image to desired size first, then overlay
  return `[1:v]scale=${cursorSize}:${cursorSize}[cursor];[0:v][cursor]overlay=x='${xExpression}':y='${yExpression}'[out]`;
}

/**
 * Create FFmpeg filter for mouse effects overlay
 */
export function createMouseEffectsFilter(
  effects: EffectFrame[],
  frameRate: number
): string {
  if (effects.length === 0) {
    return '';
  }

  // Group effects by type and generate filters for each
  // For now, we'll create a simplified version that overlays effect images
  // In a full implementation, we'd generate effect frames as separate video streams
  
  // This is a placeholder - full implementation would generate
  // separate overlay filters for each effect type
  return '';
}

/**
 * Combine multiple FFmpeg filters into a single filter complex
 */
export function combineFilters(filters: string[]): string {
  const validFilters = filters.filter(f => f && f.trim().length > 0);
  if (validFilters.length === 0) {
    return '[0:v]copy[out]';
  }
  
  // Combine filters with proper chaining
  // This is a simplified version - full implementation would
  // properly chain filter outputs
  return validFilters.join(';');
}


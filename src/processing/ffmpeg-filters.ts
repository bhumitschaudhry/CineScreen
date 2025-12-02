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
 * Create FFmpeg filter for mouse effects overlay using drawbox and drawtext
 */
export function createMouseEffectsFilter(
  effects: EffectFrame[],
  frameRate: number,
  inputLabel: string = '[0:v]'
): string {
  if (effects.length === 0) {
    return '';
  }

  // Group effects by type
  const clickCircles = effects.filter(e => e.type === 'clickCircle');
  const trails = effects.filter(e => e.type === 'trail');
  const highlightRings = effects.filter(e => e.type === 'highlightRing');

  const filters: string[] = [];
  let currentLabel = inputLabel;

  // Process click circles
  if (clickCircles.length > 0) {
    const circleFilters = createClickCirclesFilter(clickCircles, frameRate, currentLabel);
    if (circleFilters) {
      filters.push(circleFilters);
      currentLabel = '[circles]';
    }
  }

  // Process trails
  if (trails.length > 0) {
    const trailFilters = createTrailFilter(trails, frameRate, currentLabel);
    if (trailFilters) {
      filters.push(trailFilters);
      currentLabel = '[trails]';
    }
  }

  // Process highlight rings
  if (highlightRings.length > 0) {
    const ringFilters = createHighlightRingFilter(highlightRings, frameRate, currentLabel);
    if (ringFilters) {
      filters.push(ringFilters);
      currentLabel = '[rings]';
    }
  }

  return filters.join(';');
}

/**
 * Create filter for click circles using drawbox
 */
function createClickCirclesFilter(
  circles: EffectFrame[],
  frameRate: number,
  inputLabel: string
): string {
  if (circles.length === 0) {
    return '';
  }

  // Group circles by click event (same timestamp within small window)
  const clickGroups = new Map<number, EffectFrame[]>();
  for (const circle of circles) {
    const key = Math.floor(circle.timestamp / 100); // Group by 100ms windows
    if (!clickGroups.has(key)) {
      clickGroups.set(key, []);
    }
    clickGroups.get(key)!.push(circle);
  }

  const drawExpressions: string[] = [];
  
  // Process each click group
  for (const [_, group] of clickGroups) {
    if (group.length === 0) continue;
    
    const firstCircle = group[0];
    const lastCircle = group[group.length - 1];
    const startTime = firstCircle.timestamp / 1000;
    const endTime = lastCircle.timestamp / 1000;
    
    // Use average position and create expanding circle effect
    const avgX = group.reduce((sum, c) => sum + c.x, 0) / group.length;
    const avgY = group.reduce((sum, c) => sum + c.y, 0) / group.length;
    const maxSize = Math.max(...group.map(c => c.size));
    
    const color = hexToFFmpegColor(firstCircle.color);
    
    // Draw expanding circle - use ellipse approximation with drawbox
    // For a circle, we'll use a filled box that expands
    const radius = maxSize / 2;
    const x = avgX - radius;
    const y = avgY - radius;
    
    // Create time-based size expression
    // Size grows from 0 to maxSize over the duration
    const duration = endTime - startTime;
    if (duration > 0) {
      const sizeExpr = `(${maxSize})*((t-${startTime})/${duration})`;
      const xExpr = `${avgX}-(${sizeExpr})/2`;
      const yExpr = `${avgY}-(${sizeExpr})/2`;
      
      drawExpressions.push(
        `drawbox=x='if(between(t,${startTime},${endTime}),${xExpr},-1)':y='if(between(t,${startTime},${endTime}),${yExpr},-1)':w='if(between(t,${startTime},${endTime}),${sizeExpr},0)':h='if(between(t,${startTime},${endTime}),${sizeExpr},0)':color=${color}:t=fill:enable='between(t,${startTime},${endTime})'`
      );
    }
  }

  if (drawExpressions.length === 0) {
    return '';
  }

  // Chain drawbox filters
  let result = inputLabel;
  for (let i = 0; i < drawExpressions.length; i++) {
    const label = i === drawExpressions.length - 1 ? '[circles]' : `[circle${i}]`;
    result += `,${drawExpressions[i]}${i < drawExpressions.length - 1 ? label : ''}`;
  }
  
  return result;
}

/**
 * Create filter for mouse trail using drawbox
 */
function createTrailFilter(
  trails: EffectFrame[],
  frameRate: number,
  inputLabel: string
): string {
  if (trails.length === 0) {
    return '';
  }

  // Sample trails for performance (every 5th frame)
  const sampled = trails.filter((_, i) => i % 5 === 0);
  
  if (sampled.length === 0) {
    return '';
  }

  const drawExpressions: string[] = [];
  const color = hexToFFmpegColor(sampled[0].color);
  
  // Group trails by time windows to batch draw operations
  const timeWindows = new Map<number, EffectFrame[]>();
  for (const trail of sampled) {
    const window = Math.floor(trail.timestamp / 50); // 50ms windows
    if (!timeWindows.has(window)) {
      timeWindows.set(window, []);
    }
    timeWindows.get(window)!.push(trail);
  }

  for (const [_, group] of timeWindows) {
    if (group.length === 0) continue;
    
    const first = group[0];
    const last = group[group.length - 1];
    const startTime = first.timestamp / 1000;
    const endTime = last.timestamp / 1000;
    
    // Draw trail points
    for (const trail of group) {
      const time = trail.timestamp / 1000;
      const size = 8;
      const x = trail.x - size / 2;
      const y = trail.y - size / 2;
      
      drawExpressions.push(
        `drawbox=x=${x}:y=${y}:w=${size}:h=${size}:color=${color}:t=fill:enable='between(t,${time},${time + 0.05})'`
      );
    }
  }

  if (drawExpressions.length === 0) {
    return '';
  }

  // Chain drawbox filters (limit to avoid filter complexity)
  const maxExpressions = 50;
  const limitedExpressions = drawExpressions.slice(0, maxExpressions);
  
  let result = inputLabel;
  for (let i = 0; i < limitedExpressions.length; i++) {
    const label = i === limitedExpressions.length - 1 ? '[trails]' : `[trail${i}]`;
    result += `,${limitedExpressions[i]}${i < limitedExpressions.length - 1 ? label : ''}`;
  }
  
  return result;
}

/**
 * Create filter for highlight ring using drawbox
 */
function createHighlightRingFilter(
  rings: EffectFrame[],
  frameRate: number,
  inputLabel: string
): string {
  if (rings.length === 0) {
    return '';
  }

  // Sample rings (every 10th frame for performance)
  const sampled = rings.filter((_, i) => i % 10 === 0);
  
  if (sampled.length === 0) {
    return '';
  }

  const drawExpressions: string[] = [];
  const color = hexToFFmpegColor(sampled[0].color);
  
  for (const ring of sampled) {
    const time = ring.timestamp / 1000;
    const radius = ring.size / 2;
    const x = ring.x - radius;
    const y = ring.y - radius;
    const width = ring.size;
    const height = ring.size;
    
    // Draw ring outline (thick box border)
    const thickness = 3;
    drawExpressions.push(
      `drawbox=x=${x}:y=${y}:w=${width}:h=${height}:color=${color}:t=${thickness}:enable='between(t,${time},${time + 0.1})'`
    );
  }

  if (drawExpressions.length === 0) {
    return '';
  }

  // Chain drawbox filters
  let result = inputLabel;
  for (let i = 0; i < drawExpressions.length; i++) {
    const label = i === drawExpressions.length - 1 ? '[rings]' : `[ring${i}]`;
    result += `,${drawExpressions[i]}${i < drawExpressions.length - 1 ? label : ''}`;
  }
  
  return result;
}

/**
 * Convert hex color to FFmpeg color format (0xRRGGBB)
 */
function hexToFFmpegColor(hex: string): string {
  // Remove # if present
  hex = hex.replace('#', '');
  
  // Handle 3-digit hex
  if (hex.length === 3) {
    hex = hex.split('').map(c => c + c).join('');
  }
  
  // Convert to 0xRRGGBB format
  return `0x${hex}`;
}

/**
 * Combine multiple FFmpeg filters into a single filter complex
 * Properly chains filter outputs
 */
export function combineFilters(filters: string[]): string {
  const validFilters = filters.filter(f => f && f.trim().length > 0);
  if (validFilters.length === 0) {
    return '[0:v]copy[out]';
  }
  
  // If only one filter, return it (should already have [out] label)
  if (validFilters.length === 1) {
    return validFilters[0];
  }
  
  // For multiple filters, chain them properly
  // Each filter should output to the next input
  let result = validFilters[0];
  
  // Replace the output label of each filter to chain them
  for (let i = 1; i < validFilters.length; i++) {
    const prevOutput = result.match(/\[(\w+)\]$/)?.[1] || 'out';
    const currentFilter = validFilters[i];
    
    // Replace the input label in current filter with previous output
    result += ';' + currentFilter.replace(/\[0:v\]|\[zoomed\]|\[circles\]|\[trails\]|\[rings\]/, `[${prevOutput}]`);
  }
  
  // Ensure final output is [out]
  if (!result.includes('[out]')) {
    result = result.replace(/\[(\w+)\]$/, '[out]');
  }
  
  return result;
}


import type { MouseEvent, MouseEffectsConfig } from '../types';

export interface EffectFrame {
  timestamp: number;
  type: 'clickCircle' | 'trail' | 'highlightRing';
  x: number;
  y: number;
  opacity: number;
  size: number;
  color: string;
}

/**
 * Generate click circle effects from mouse events
 */
export function generateClickCircles(
  events: MouseEvent[],
  config: MouseEffectsConfig['clickCircles'],
  frameRate: number
): EffectFrame[] {
  if (!config.enabled) {
    return [];
  }

  const frames: EffectFrame[] = [];
  const frameInterval = 1000 / frameRate;
  const durationFrames = Math.ceil(config.duration / frameInterval);

  for (const event of events) {
    if (event.action === 'down' && event.button) {
      // Generate expanding circle animation
      for (let frame = 0; frame < durationFrames; frame++) {
        const progress = frame / durationFrames;
        const size = config.size * progress; // Expand from 0 to full size
        const opacity = 1 - progress; // Fade out

        frames.push({
          timestamp: event.timestamp + frame * frameInterval,
          type: 'clickCircle',
          x: event.x,
          y: event.y,
          opacity: Math.max(0, opacity),
          size: size,
          color: config.color,
        });
      }
    }
  }

  return frames;
}

/**
 * Generate mouse trail effects
 */
export function generateMouseTrail(
  events: MouseEvent[],
  config: MouseEffectsConfig['trail'],
  frameRate: number
): EffectFrame[] {
  if (!config.enabled) {
    return [];
  }

  const frames: EffectFrame[] = [];
  const frameInterval = 1000 / frameRate;

  // Create trail by duplicating events with decreasing opacity
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event.action !== 'move') {
      continue;
    }

    // Create trail points behind the cursor
    for (let trailIndex = 0; trailIndex < config.length; trailIndex++) {
      const trailEventIndex = i - trailIndex;
      if (trailEventIndex < 0) {
        break;
      }

      const trailEvent = events[trailEventIndex];
      const fadeProgress = trailIndex / config.length;
      const opacity = (1 - fadeProgress) * (1 - config.fadeSpeed);

      frames.push({
        timestamp: event.timestamp,
        type: 'trail',
        x: trailEvent.x,
        y: trailEvent.y,
        opacity: Math.max(0, opacity),
        size: 10, // Small trail point size
        color: config.color,
      });
    }
  }

  return frames;
}

/**
 * Generate highlight ring around cursor
 */
export function generateHighlightRing(
  events: MouseEvent[],
  config: MouseEffectsConfig['highlightRing'],
  frameRate: number
): EffectFrame[] {
  if (!config.enabled) {
    return [];
  }

  const frames: EffectFrame[] = [];
  const frameInterval = 1000 / frameRate;

  for (const event of events) {
    if (event.action !== 'move') {
      continue;
    }

    // Create pulsing ring effect
    const timeInSeconds = event.timestamp / 1000;
    const pulse = Math.sin(timeInSeconds * config.pulseSpeed * 10) * 0.5 + 0.5;
    const size = config.size * (1 + pulse * 0.2); // Pulse between 100% and 120% of size
    const opacity = 0.7 + pulse * 0.3; // Pulse opacity between 0.7 and 1.0

    frames.push({
      timestamp: event.timestamp,
      type: 'highlightRing',
      x: event.x,
      y: event.y,
      opacity: opacity,
      size: size,
      color: config.color,
    });
  }

  return frames;
}

/**
 * Generate all mouse effects
 */
export function generateAllMouseEffects(
  events: MouseEvent[],
  config: MouseEffectsConfig,
  frameRate: number
): EffectFrame[] {
  const allFrames: EffectFrame[] = [];

  // Generate each effect type
  const clickCircles = generateClickCircles(events, config.clickCircles, frameRate);
  const trail = generateMouseTrail(events, config.trail, frameRate);
  const highlightRing = generateHighlightRing(events, config.highlightRing, frameRate);

  // Combine all effects
  allFrames.push(...clickCircles);
  allFrames.push(...trail);
  allFrames.push(...highlightRing);

  // Sort by timestamp for proper rendering order
  allFrames.sort((a, b) => a.timestamp - b.timestamp);

  return allFrames;
}

/**
 * Get effect frames for a specific timestamp
 */
export function getEffectsAtTimestamp(
  effects: EffectFrame[],
  timestamp: number,
  tolerance: number = 16 // ~1 frame at 60fps
): EffectFrame[] {
  return effects.filter(
    (effect) => Math.abs(effect.timestamp - timestamp) <= tolerance
  );
}


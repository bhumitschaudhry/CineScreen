import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';
import type { CursorConfig } from '../types';

/**
 * Local cursor assets directory
 */
function getAssetsDir(): string {
  // In development, use src/assets; in production, use app resources
  const isDev = process.env.NODE_ENV === 'development' || !app?.isPackaged;
  if (isDev) {
    return join(__dirname, '../../src/assets');
  }
  return join(app?.getPath('exe') || process.cwd(), '../resources/assets');
}

/**
 * Map cursor shape names to asset file names
 */
const CURSOR_SHAPE_MAP: Record<string, string> = {
  arrow: 'cursor.svg',
  pointer: 'pointinghand.svg',
  hand: 'openhand.svg',
  crosshair: 'cursor.svg', // Use cursor as fallback
  move: 'move.svg',
  copy: 'copy.svg',
  help: 'help.svg',
  notallowed: 'notallowed.svg',
  resize: 'resizenortheastsouthwest.svg',
  screenshot: 'screenshotselection.svg',
  zoomin: 'zoomin.svg',
  zoomout: 'zoomout.svg',
};

/**
 * Get cursor asset path for a given shape
 */
export function getCursorAssetPath(shape: string): string | null {
  const assetFileName = CURSOR_SHAPE_MAP[shape] || CURSOR_SHAPE_MAP.arrow;
  const assetPath = join(getAssetsDir(), assetFileName);
  
  if (existsSync(assetPath)) {
    return assetPath;
  }
  
  return null;
}

/**
 * Load and scale SVG cursor from assets
 */
function loadAndScaleSVGCursor(assetPath: string, targetSize: number): string {
  try {
    const svgContent = readFileSync(assetPath, 'utf-8');
    
    // Parse SVG to get original dimensions
    const widthMatch = svgContent.match(/width="([^"]+)"/);
    const heightMatch = svgContent.match(/height="([^"]+)"/);
    const viewBoxMatch = svgContent.match(/viewBox="([^"]+)"/);
    
    let originalWidth = 20;
    let originalHeight = 20;
    
    if (viewBoxMatch) {
      const viewBox = viewBoxMatch[1].split(/\s+/);
      if (viewBox.length >= 4) {
        originalWidth = parseFloat(viewBox[2]) || 20;
        originalHeight = parseFloat(viewBox[3]) || 20;
      }
    } else if (widthMatch && heightMatch) {
      originalWidth = parseFloat(widthMatch[1]) || 20;
      originalHeight = parseFloat(heightMatch[1]) || 20;
    }
    
    // Calculate scale factor
    const scale = targetSize / Math.max(originalWidth, originalHeight);
    const scaledWidth = originalWidth * scale;
    const scaledHeight = originalHeight * scale;
    
    // Replace dimensions in SVG
    let scaledSVG = svgContent
      .replace(/width="[^"]+"/, `width="${scaledWidth}"`)
      .replace(/height="[^"]+"/, `height="${scaledHeight}"`);
    
    // Add transform if viewBox exists, or update viewBox
    if (viewBoxMatch) {
      // Keep viewBox, just scale the output
      scaledSVG = scaledSVG.replace(
        /<svg([^>]*)>/,
        `<svg$1 width="${scaledWidth}" height="${scaledHeight}">`
      );
    } else {
      // Add viewBox for proper scaling
      scaledSVG = scaledSVG.replace(
        /<svg([^>]*)>/,
        `<svg$1 viewBox="0 0 ${originalWidth} ${originalHeight}" width="${scaledWidth}" height="${scaledHeight}">`
      );
    }
    
    return scaledSVG;
  } catch (error) {
    console.error('Error loading cursor SVG:', error);
    return '';
  }
}

/**
 * Generate SVG cursor based on shape and size
 * Loads from local assets if available, otherwise generates SVG
 */
export function generateCursorSVG(config: CursorConfig): string {
  const { size, shape, color = '#000000' } = config;

  // Try to load from local assets first
  const assetPath = getCursorAssetPath(shape);
  if (assetPath && existsSync(assetPath)) {
    const scaledSVG = loadAndScaleSVGCursor(assetPath, size);
    if (scaledSVG) {
      // Apply color if needed (for cursors that support color changes)
      // Most SVG cursors have their own colors, so we might skip this
      return scaledSVG;
    }
  }

  // Fall back to generated SVG cursors
  switch (shape) {
    case 'arrow':
      return generateArrowCursor(size, color);
    case 'pointer':
      return generatePointerCursor(size, color);
    case 'hand':
      return generateHandCursor(size, color);
    case 'crosshair':
      return generateCrosshairCursor(size, color);
    default:
      return generateArrowCursor(size, color);
  }
}

/**
 * Generate multi-layer cursor with effects
 */
export function generateMultiLayerCursor(
  config: CursorConfig,
  effects?: { highlight?: boolean; shadow?: boolean }
): string {
  const baseCursor = generateCursorSVG(config);
  const { size, color = '#000000' } = config;
  const scale = size / 20;

  let layers = baseCursor;

  // Add shadow layer if enabled
  if (effects?.shadow) {
    const shadowOffset = 2 * scale;
    const shadow = generateArrowCursor(size, '#000000');
    // Wrap in group with offset for shadow
    layers = `
      <g>
        <g transform="translate(${shadowOffset},${shadowOffset})" opacity="0.3">
          ${shadow}
        </g>
        ${baseCursor}
      </g>
    `;
  }

  // Add highlight ring if enabled
  if (effects?.highlight) {
    const ringSize = size * 1.2;
    const ring = `
      <circle cx="${size / 2}" cy="${size / 2}" r="${ringSize / 2}" 
              fill="none" 
              stroke="${color}" 
              stroke-width="${2 * scale}" 
              opacity="0.5"/>
    `;
    layers = `
      <g>
        ${ring}
        ${baseCursor}
      </g>
    `;
  }

  return layers.trim();
}

/**
 * Generate arrow cursor SVG
 */
function generateArrowCursor(size: number, color: string): string {
  const scale = size / 20;
  return `
    <svg width="${20 * scale}" height="${20 * scale}" xmlns="http://www.w3.org/2000/svg">
      <path d="M 0 0 L ${16 * scale} ${4 * scale} L ${12 * scale} ${8 * scale} L ${18 * scale} ${14 * scale} L ${14 * scale} ${16 * scale} L ${8 * scale} ${10 * scale} L ${4 * scale} ${16 * scale} Z" 
            fill="${color}" 
            stroke="#ffffff" 
            stroke-width="${0.5 * scale}"/>
    </svg>
  `.trim();
}

/**
 * Generate pointer cursor SVG
 */
function generatePointerCursor(size: number, color: string): string {
  const scale = size / 20;
  return `
    <svg width="${20 * scale}" height="${20 * scale}" xmlns="http://www.w3.org/2000/svg">
      <path d="M ${2 * scale} ${2 * scale} L ${14 * scale} ${2 * scale} L ${14 * scale} ${8 * scale} L ${18 * scale} ${8 * scale} L ${10 * scale} ${18 * scale} L ${8 * scale} ${14 * scale} L ${2 * scale} ${14 * scale} Z" 
            fill="${color}" 
            stroke="#ffffff" 
            stroke-width="${0.5 * scale}"/>
    </svg>
  `.trim();
}

/**
 * Generate hand cursor SVG
 */
function generateHandCursor(size: number, color: string): string {
  const scale = size / 20;
  return `
    <svg width="${20 * scale}" height="${20 * scale}" xmlns="http://www.w3.org/2000/svg">
      <path d="M ${4 * scale} ${2 * scale} Q ${2 * scale} ${4 * scale} ${2 * scale} ${6 * scale} L ${2 * scale} ${12 * scale} Q ${2 * scale} ${14 * scale} ${4 * scale} ${14 * scale} L ${6 * scale} ${14 * scale} L ${6 * scale} ${16 * scale} Q ${6 * scale} ${18 * scale} ${8 * scale} ${18 * scale} L ${12 * scale} ${18 * scale} Q ${14 * scale} ${18 * scale} ${14 * scale} ${16 * scale} L ${14 * scale} ${10 * scale} L ${16 * scale} ${8 * scale} Q ${18 * scale} ${8 * scale} ${18 * scale} ${6 * scale} L ${18 * scale} ${4 * scale} Q ${18 * scale} ${2 * scale} ${16 * scale} ${2 * scale} Z" 
            fill="${color}" 
            stroke="#ffffff" 
            stroke-width="${0.5 * scale}"/>
    </svg>
  `.trim();
}

/**
 * Generate crosshair cursor SVG
 */
function generateCrosshairCursor(size: number, color: string): string {
  const scale = size / 20;
  const center = 10 * scale;
  return `
    <svg width="${20 * scale}" height="${20 * scale}" xmlns="http://www.w3.org/2000/svg">
      <line x1="${center}" y1="${2 * scale}" x2="${center}" y2="${8 * scale}" 
            stroke="${color}" 
            stroke-width="${2 * scale}" 
            stroke-linecap="round"/>
      <line x1="${center}" y1="${12 * scale}" x2="${center}" y2="${18 * scale}" 
            stroke="${color}" 
            stroke-width="${2 * scale}" 
            stroke-linecap="round"/>
      <line x1="${2 * scale}" y1="${center}" x2="${8 * scale}" y2="${center}" 
            stroke="${color}" 
            stroke-width="${2 * scale}" 
            stroke-linecap="round"/>
      <line x1="${12 * scale}" y1="${center}" x2="${18 * scale}" y2="${center}" 
            stroke="${color}" 
            stroke-width="${2 * scale}" 
            stroke-linecap="round"/>
      <circle cx="${center}" cy="${center}" r="${1.5 * scale}" 
              fill="${color}" 
              stroke="#ffffff" 
              stroke-width="${0.5 * scale}"/>
    </svg>
  `.trim();
}

/**
 * Save cursor SVG to file
 */
export function saveCursorToFile(filePath: string, svg: string): void {
  const dir = join(filePath, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, svg);
}

/**
 * Get cursor asset file path (for direct file access if needed)
 */
export function getCursorAssetFilePath(shape: string): string | null {
  return getCursorAssetPath(shape);
}

/**
 * Convert SVG to PNG using a simple approach
 * Note: In production, you'd use a library like sharp or canvas
 */
export async function convertSVGToPNG(
  svgPath: string,
  pngPath: string,
  size: number
): Promise<void> {
  // For now, we'll use a shell command with rsvg-convert or similar
  // In a real implementation, you'd use a Node.js library
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);

  try {
    // Try using rsvg-convert if available
    await execAsync(
      `rsvg-convert -w ${size} -h ${size} "${svgPath}" -o "${pngPath}"`
    );
  } catch (error) {
    // Fallback: use ImageMagick or other tool
    try {
      await execAsync(
        `convert -background none -resize ${size}x${size} "${svgPath}" "${pngPath}"`
      );
    } catch (error2) {
      // If neither is available, we'll need to handle this in video processing
      // For now, just copy the SVG (FFmpeg can handle SVG with libvips)
      throw new Error(
        'No SVG to PNG converter available. Please install rsvg-convert or ImageMagick.'
      );
    }
  }
}


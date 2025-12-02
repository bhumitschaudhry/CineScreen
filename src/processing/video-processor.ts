import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import type { MouseEvent, CursorConfig, MouseEffectsConfig, ZoomConfig } from '../types';
import { smoothMouseMovement, interpolateMousePositions } from './effects';
import { generateCursorSVG, saveCursorToFile } from './cursor-renderer';
import { getFfmpegPath } from '../utils/ffmpeg-path';
import { createCursorOverlayFilter, combineFilters } from './ffmpeg-filters';
import { ensureCursorPNG, getVideoDimensions } from './video-utils';
import { generateAllMouseEffects } from './mouse-effects';
import { generateZoomRegions } from './zoom-tracker';
import { generateZoomFilter } from './zoom-processor';

export interface VideoProcessingOptions {
  inputVideo: string;
  outputVideo: string;
  mouseEvents: MouseEvent[];
  cursorConfig: CursorConfig;
  mouseEffectsConfig?: MouseEffectsConfig;
  zoomConfig?: ZoomConfig;
  frameRate: number;
  videoDuration: number; // in milliseconds
}

export class VideoProcessor {
  /**
   * Process video and overlay cursor
   */
  async processVideo(options: VideoProcessingOptions): Promise<string> {
    const {
      inputVideo,
      outputVideo,
      mouseEvents,
      cursorConfig,
      frameRate,
      videoDuration,
    } = options;

    // Ensure output directory exists
    const outputDir = dirname(outputVideo);
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    // Apply smoothing to mouse events
    const smoothedEvents = smoothMouseMovement(
      mouseEvents,
      cursorConfig.smoothing
    );

    // Interpolate mouse positions for all frames
    const interpolatedEvents = interpolateMousePositions(
      smoothedEvents,
      frameRate,
      videoDuration
    );

    // Get video dimensions for zoom calculations
    const videoDimensions = await getVideoDimensions(inputVideo);

    // Generate zoom regions if zoom is enabled
    let zoomFilter = '';
    if (options.zoomConfig?.enabled) {
      const zoomRegions = generateZoomRegions(
        interpolatedEvents,
        videoDimensions,
        options.zoomConfig,
        frameRate,
        videoDuration
      );
      zoomFilter = generateZoomFilter(zoomRegions, videoDimensions, frameRate);
    }

    // Generate mouse effects if configured
    const effectFrames = options.mouseEffectsConfig
      ? generateAllMouseEffects(interpolatedEvents, options.mouseEffectsConfig, frameRate)
      : [];

    // Generate cursor image
    const cursorSVG = generateCursorSVG(cursorConfig);
    const tempCursorPath = join(outputDir, 'temp_cursor.svg');
    saveCursorToFile(tempCursorPath, cursorSVG);

    // Convert SVG to PNG if needed (FFmpeg can handle SVG with filters)
    // For simplicity, we'll use a PNG approach
    const cursorPNGPath = await ensureCursorPNG(
      tempCursorPath,
      cursorConfig.size
    );

    // Create FFmpeg filter complex
    const filters: string[] = [];
    
    // Apply zoom first if enabled
    if (zoomFilter) {
      filters.push(zoomFilter);
    }
    
    // Create cursor overlay filter (adjust input label based on zoom)
    const cursorInputLabel = zoomFilter ? '[zoomed]' : '[0:v]';
    const cursorFilter = createCursorOverlayFilter(
      interpolatedEvents,
      cursorConfig.size
    );
    // Replace input label in cursor filter
    const adjustedCursorFilter = cursorFilter.replace('[0:v]', cursorInputLabel);
    filters.push(adjustedCursorFilter);

    // Note: Mouse effects (click circles, trails, rings) would be added here
    // For now, we'll use the cursor overlay. Full effect rendering would require
    // generating effect frames as separate video streams or using draw filters
    
    // Combine all filters
    const filterComplex = combineFilters(filters);

    // Build FFmpeg command
    const args = [
      '-i',
      inputVideo,
      '-i',
      cursorPNGPath,
      '-filter_complex',
      filterComplex,
      '-map',
      '[out]',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'copy',
      '-movflags',
      'faststart',
      '-y', // Overwrite output file
      outputVideo,
    ];

    return new Promise((resolve, reject) => {
      let ffmpegPath: string;
      try {
        // Get the resolved FFmpeg path using the utility function
        ffmpegPath = getFfmpegPath();
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      const ffmpegProcess = spawn(ffmpegPath, args);

      let errorOutput = '';

      ffmpegProcess.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      ffmpegProcess.on('close', (code) => {
        if (code === 0) {
          resolve(outputVideo);
        } else {
          reject(
            new Error(`FFmpeg processing failed with code ${code}: ${errorOutput}`)
          );
        }
      });

      ffmpegProcess.on('error', (error) => {
        reject(new Error(`Failed to start FFmpeg: ${error.message}`));
      });
    });
  }

}


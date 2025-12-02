import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import type { MouseEvent, CursorConfig, MouseEffectsConfig, ZoomConfig } from '../types';
import { smoothMouseMovement, interpolateMousePositions } from './effects';
import { getCursorAssetFilePath } from './cursor-renderer';
import { getFfmpegPath } from '../utils/ffmpeg-path';
import { getVideoDimensions, getScreenDimensions } from './video-utils';
import { createLogger } from '../utils/logger';
import {
  extractFrames,
  encodeFrames,
  cleanupFrames,
  getFrameFiles,
} from './frame-extractor';
import {
  renderFrame,
  createFrameDataFromEvents,
  prepareCursorImage,
  type FrameRenderOptions,
  type FrameData,
} from './sharp-renderer';

const logger = createLogger('VideoProcessor');

// Output dimensions
const OUTPUT_WIDTH = 1920;
const OUTPUT_HEIGHT = 1080;

export interface VideoProcessingOptions {
  inputVideo: string;
  outputVideo: string;
  mouseEvents: MouseEvent[];
  cursorConfig: CursorConfig;
  mouseEffectsConfig?: MouseEffectsConfig;
  zoomConfig?: ZoomConfig;
  frameRate: number;
  videoDuration: number; // in milliseconds
  onProgress?: (percent: number, message: string) => void;
}

export class VideoProcessor {
  /**
   * Process video using Sharp-based frame rendering
   * Much faster than FFmpeg filter expressions
   */
  async processVideo(options: VideoProcessingOptions): Promise<string> {
    const {
      inputVideo,
      outputVideo,
      mouseEvents,
      cursorConfig: initialCursorConfig,
      frameRate,
      videoDuration,
      zoomConfig,
      onProgress,
    } = options;

    let cursorConfig = initialCursorConfig;

    // Validate inputs
    if (!inputVideo || !existsSync(inputVideo)) {
      throw new Error(`Input video file not found: ${inputVideo}`);
    }

    if (!outputVideo) {
      throw new Error('Output video path is required');
    }

    if (!mouseEvents || mouseEvents.length === 0) {
      logger.warn('No mouse events provided, processing video without cursor overlay');
    }

    // Validate and provide default cursor config
    if (!cursorConfig) {
      logger.warn('No cursor config provided, using defaults');
      cursorConfig = {
        size: 24,
        shape: 'arrow',
        smoothing: 0.5,
        color: '#000000',
      };
    }

    // Ensure output directory exists
    const outputDir = dirname(outputVideo);
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    const tempDir = outputDir;
    let extractedFrameDir: string | null = null;
    let renderedFrameDir: string | null = null;
    let preparedCursorPath: string | null = null;

    try {
      // Step 1: Get video and screen dimensions
      onProgress?.(5, 'Analyzing video...');
      const videoDimensions = await getVideoDimensions(inputVideo);
      logger.info('Video dimensions:', videoDimensions);

      let screenDimensions;
      try {
        screenDimensions = await getScreenDimensions();
        logger.debug('Screen dimensions:', screenDimensions);
      } catch (error) {
        logger.warn('Could not get screen dimensions, using video dimensions:', error);
        screenDimensions = videoDimensions;
      }

      // Step 2: Extract frames from video
      onProgress?.(10, 'Extracting frames...');
      logger.info('Extracting frames from video...');
      
      const extractionResult = await extractFrames({
        inputVideo,
        outputDir: tempDir,
        frameRate,
      });
      extractedFrameDir = extractionResult.frameDir;
      logger.info(`Extracted ${extractionResult.frameCount} frames`);

      // Step 3: Prepare cursor image
      onProgress?.(15, 'Preparing cursor...');
      const cursorAssetPath = getCursorAssetFilePath(cursorConfig.shape);
      if (!cursorAssetPath || !existsSync(cursorAssetPath)) {
        throw new Error(`Cursor asset not found for shape: ${cursorConfig.shape}`);
      }

      preparedCursorPath = join(tempDir, `cursor_${Date.now()}.png`);
      await prepareCursorImage(cursorAssetPath, cursorConfig.size, preparedCursorPath);
      logger.debug('Cursor image prepared:', preparedCursorPath);

      // Step 4: Create rendered frames directory
      renderedFrameDir = join(tempDir, `rendered_${Date.now()}`);
      mkdirSync(renderedFrameDir, { recursive: true });

      // Step 5: Apply smoothing and interpolation to mouse events
      onProgress?.(20, 'Processing mouse data...');
      let smoothedEvents = mouseEvents;
      try {
        smoothedEvents = smoothMouseMovement(mouseEvents, cursorConfig.smoothing);
      } catch (error) {
        logger.warn('Error smoothing mouse events:', error);
      }

      let interpolatedEvents: MouseEvent[] = [];
      try {
        interpolatedEvents = interpolateMousePositions(smoothedEvents, frameRate, videoDuration);
      } catch (error) {
        throw new Error(`Failed to interpolate mouse positions: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Step 6: Create frame data with cursor positions and zoom
      const frameDataList = createFrameDataFromEvents(
        interpolatedEvents,
        frameRate,
        videoDuration,
        videoDimensions,
        screenDimensions,
        zoomConfig
      );
      logger.info(`Created frame data for ${frameDataList.length} frames`);

      // Step 7: Render frames with Sharp
      onProgress?.(25, 'Rendering frames...');
      logger.info('Rendering frames with cursor overlay and zoom...');

      const renderOptions: FrameRenderOptions = {
        frameWidth: videoDimensions.width,
        frameHeight: videoDimensions.height,
        outputWidth: OUTPUT_WIDTH,
        outputHeight: OUTPUT_HEIGHT,
        cursorImagePath: preparedCursorPath,
        cursorSize: cursorConfig.size,
        zoomConfig,
      };

      // Process frames in batches with progress updates
      const totalFrames = frameDataList.length;
      const batchSize = 10;
      
      for (let i = 0; i < totalFrames; i += batchSize) {
        const batch = frameDataList.slice(i, i + batchSize);
        
        await Promise.all(
          batch.map(async (frameData) => {
            const frameNum = String(frameData.frameIndex + 1).padStart(6, '0');
            const inputPath = join(extractedFrameDir!, `frame_${frameNum}.png`);
            const outputPath = join(renderedFrameDir!, `frame_${frameNum}.png`);

            if (!existsSync(inputPath)) {
              logger.warn(`Frame not found: ${inputPath}`);
              return;
            }

            await renderFrame(inputPath, outputPath, { ...frameData }, renderOptions);
          })
        );

        // Update progress (25% to 85% for rendering)
        const progress = 25 + Math.round((i / totalFrames) * 60);
        onProgress?.(progress, `Rendering frames ${i + 1}-${Math.min(i + batchSize, totalFrames)}/${totalFrames}`);
      }

      logger.info('Frame rendering complete');

      // Step 8: Encode rendered frames to video
      onProgress?.(90, 'Encoding video...');
      logger.info('Encoding rendered frames to video...');

      await encodeFrames({
        frameDir: renderedFrameDir,
        framePattern: 'frame_%06d.png',
        outputVideo,
        frameRate,
        width: OUTPUT_WIDTH,
        height: OUTPUT_HEIGHT,
      });

      onProgress?.(100, 'Complete');
      logger.info('Video processing completed successfully');

      return outputVideo;

    } finally {
      // Cleanup temp files
      if (extractedFrameDir) {
        try {
          cleanupFrames(extractedFrameDir);
        } catch (error) {
          logger.warn('Failed to cleanup extracted frames:', error);
        }
      }

      if (renderedFrameDir) {
        try {
          cleanupFrames(renderedFrameDir);
        } catch (error) {
          logger.warn('Failed to cleanup rendered frames:', error);
        }
      }

      if (preparedCursorPath && existsSync(preparedCursorPath)) {
        try {
          unlinkSync(preparedCursorPath);
        } catch (error) {
          logger.warn('Failed to cleanup cursor file:', error);
        }
      }
    }
  }

  /**
   * Simple video copy without effects (for fallback)
   */
  async copyVideoWithScale(inputVideo: string, outputVideo: string): Promise<void> {
    const ffmpegPath = getFfmpegPath();

    const args = [
      '-i', inputVideo,
      '-vf', `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}`,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-movflags', 'faststart',
      '-y',
      outputVideo
    ];

    return new Promise((resolve, reject) => {
      const process = spawn(ffmpegPath, args);
      let errorOutput = '';

      process.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0 && existsSync(outputVideo)) {
          resolve();
        } else {
          reject(new Error(`Video copy failed: ${errorOutput.substring(0, 500)}`));
        }
      });

      process.on('error', (error) => {
        reject(new Error(`Failed to start FFmpeg: ${error.message}`));
      });
    });
  }
}

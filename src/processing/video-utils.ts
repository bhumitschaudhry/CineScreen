import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { getFfmpegPath } from '../utils/ffmpeg-path';

/**
 * Ensure cursor is available as PNG
 * Uses FFmpeg to convert SVG to PNG if needed
 */
export async function ensureCursorPNG(
  svgPath: string,
  size: number
): Promise<string> {
  const pngPath = svgPath.replace('.svg', '.png');

  if (existsSync(pngPath)) {
    return pngPath;
  }

  // Use FFmpeg to convert SVG to PNG
  try {
    const args = [
      '-i',
      svgPath,
      '-vf',
      `scale=${size}:${size}`,
      '-frames:v',
      '1',
      '-y',
      pngPath,
    ];

    await new Promise<void>((resolve, reject) => {
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
          resolve();
        } else {
          reject(new Error(`FFmpeg conversion failed: ${errorOutput}`));
        }
      });

      ffmpegProcess.on('error', (error) => {
        reject(error);
      });
    });

    return pngPath;
  } catch (error) {
    // If FFmpeg conversion fails, try alternative method
    try {
      const { convertSVGToPNG } = await import('./cursor-renderer');
      await convertSVGToPNG(svgPath, pngPath, size);
      return pngPath;
    } catch (error2) {
      // Last resort: return SVG and hope FFmpeg can handle it
      console.warn('Could not convert SVG to PNG, using SVG directly');
      return svgPath;
    }
  }
}

/**
 * Get video dimensions from video file
 */
export async function getVideoDimensions(videoPath: string): Promise<{
  width: number;
  height: number;
}> {
  return new Promise((resolve, reject) => {
    let ffmpegPath: string;
    try {
      ffmpegPath = getFfmpegPath();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    const ffmpegProcess = spawn(ffmpegPath, [
      '-i',
      videoPath,
      '-hide_banner',
    ]);

    let errorOutput = '';

    ffmpegProcess.stderr?.on('data', (data) => {
      errorOutput += data.toString();
    });

    ffmpegProcess.on('close', () => {
      // Parse dimensions from FFmpeg output
      // Format: Stream #0:0: Video: ... 1920x1080 ...
      const match = errorOutput.match(/(\d+)x(\d+)/);
      if (match) {
        resolve({
          width: parseInt(match[1], 10),
          height: parseInt(match[2], 10),
        });
      } else {
        // Default to common resolution
        resolve({ width: 1920, height: 1080 });
      }
    });

    ffmpegProcess.on('error', (error) => {
      reject(new Error(`Failed to get video dimensions: ${error.message}`));
    });
  });
}


import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { getFfmpegPath } from '../utils/ffmpeg-path';
import { createLogger } from '../utils/logger';

const logger = createLogger('VideoUtils');

/**
 * Get the main screen dimensions in logical points
 * On Retina displays, this returns the logical resolution (e.g., 1440x900)
 * rather than the physical resolution (e.g., 2880x1800)
 */
export async function getScreenDimensions(): Promise<{
  width: number;
  height: number;
}> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);
  
  try {
    // Use AppleScript to get screen bounds (same coordinate system as mouse position)
    const script = `
      tell application "Finder"
        set screenSize to bounds of window of desktop
        return (item 3 of screenSize) & "," & (item 4 of screenSize)
      end tell
    `;
    const { stdout } = await execAsync(`osascript -e '${script}'`);
    const [width, height] = stdout.trim().split(',').map(Number);
    
    if (width > 0 && height > 0) {
      logger.debug('Got screen dimensions via AppleScript:', { width, height });
      return { width, height };
    }
  } catch (error) {
    logger.debug('AppleScript screen dimensions failed:', error);
  }
  
  // Fallback: try using system_profiler
  try {
    const { stdout } = await execAsync("system_profiler SPDisplaysDataType | grep Resolution | head -1");
    const match = stdout.match(/(\d+)\s*x\s*(\d+)/);
    if (match) {
      // This returns physical pixels, need to check if it's Retina
      let width = parseInt(match[1], 10);
      let height = parseInt(match[2], 10);
      
      // Check for Retina scaling
      const retinaMatch = stdout.match(/Retina/i);
      if (retinaMatch) {
        // Retina display - divide by 2 for logical coordinates
        width = Math.round(width / 2);
        height = Math.round(height / 2);
      }
      
      logger.debug('Got screen dimensions via system_profiler:', { width, height });
      return { width, height };
    }
  } catch (error) {
    logger.debug('system_profiler screen dimensions failed:', error);
  }
  
  // Last resort fallback: assume common resolution
  logger.warn('Could not detect screen dimensions, using default 1920x1080');
  return { width: 1920, height: 1080 };
}

/**
 * Get video dimensions from video file
 */
export async function getVideoDimensions(videoPath: string): Promise<{
  width: number;
  height: number;
}> {
  if (!videoPath || !existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  return new Promise((resolve, reject) => {
    let ffmpegPath: string;
    try {
      ffmpegPath = getFfmpegPath();
    } catch (error) {
      reject(new Error(`Failed to get FFmpeg path: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }

    const ffmpegProcess = spawn(ffmpegPath, [
      '-i',
      videoPath,
      '-hide_banner',
    ]);

    let errorOutput = '';
    let hasResolved = false;

    ffmpegProcess.stderr?.on('data', (data) => {
      errorOutput += data.toString();
    });

    ffmpegProcess.on('close', (code) => {
      if (hasResolved) return;
      hasResolved = true;

      // Parse dimensions from FFmpeg output
      // Format: Stream #0:0: Video: ... 1920x1080 ...
      const match = errorOutput.match(/(\d+)x(\d+)/);
      if (match) {
        const width = parseInt(match[1], 10);
        const height = parseInt(match[2], 10);
        if (width > 0 && height > 0) {
          resolve({ width, height });
        } else {
          reject(new Error(`Invalid video dimensions parsed: ${width}x${height}`));
        }
      } else {
        // Try alternative parsing
        const altMatch = errorOutput.match(/Video:.*?(\d{3,5})x(\d{3,5})/);
        if (altMatch) {
          const width = parseInt(altMatch[1], 10);
          const height = parseInt(altMatch[2], 10);
          if (width > 0 && height > 0) {
            resolve({ width, height });
          } else {
            reject(new Error(`Could not parse video dimensions from FFmpeg output`));
          }
        } else {
          reject(new Error(`Could not parse video dimensions from FFmpeg output. Code: ${code}`));
        }
      }
    });

    ffmpegProcess.on('error', (error) => {
      if (hasResolved) return;
      hasResolved = true;
      reject(new Error(`Failed to get video dimensions: ${error.message}`));
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      if (!hasResolved) {
        hasResolved = true;
        ffmpegProcess.kill();
        reject(new Error('Timeout getting video dimensions'));
      }
    }, 30000);
  });
}


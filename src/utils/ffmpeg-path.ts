import { existsSync, statSync } from 'fs';
import { resolve as resolvePath } from 'path';
import ffmpegStatic from 'ffmpeg-static';

/**
 * Get the resolved FFmpeg binary path that can be executed.
 * 
 * CRITICAL: Cannot execute binaries from inside .asar archives.
 * Even though existsSync/statSync can read files inside .asar,
 * spawn() cannot execute them. We must use the unpacked version.
 * 
 * Reference: https://stackoverflow.com/questions/47848621/how-can-i-bundle-ffmpeg-in-an-electron-application
 * 
 * @param debugLog Optional debug logging function
 * @returns The resolved FFmpeg binary path
 * @throws Error if FFmpeg binary is not found or path is invalid
 */
export function getFfmpegPath(debugLog?: (message: string) => void): string {
  const log = debugLog || (() => {});
  
  const ffmpegPath = ffmpegStatic;
  if (!ffmpegPath) {
    throw new Error('FFmpeg binary not found. Please ensure ffmpeg-static is installed.');
  }

  log(`Initial ffmpeg-static path: ${ffmpegPath}`);

  // CRITICAL: Cannot execute binaries from inside .asar archives
  // Simple solution: replace 'app.asar' with 'app.asar.unpacked' in the path
  let resolvedPath = ffmpegPath;
  
  if (resolvedPath.includes('app.asar') && !resolvedPath.includes('app.asar.unpacked')) {
    log('Path is inside .asar archive, replacing with unpacked version');
    resolvedPath = resolvedPath.replace('app.asar', 'app.asar.unpacked');
    log(`Unpacked path: ${resolvedPath}`);
  }

  // Validate the resolved path exists and is a file
  if (!existsSync(resolvedPath)) {
    // If unpacked version doesn't exist, try the original path (for development)
    if (resolvedPath !== ffmpegPath && existsSync(ffmpegPath)) {
      log('Unpacked path not found, using original path (development mode)');
      resolvedPath = ffmpegPath;
    } else {
      throw new Error(
        `FFmpeg binary not found at: ${resolvedPath}. ` +
        `Please ensure 'asarUnpack' is configured in package.json for ffmpeg-static. ` +
        `Original path: ${ffmpegPath}`
      );
    }
  }

  // Ensure we have an absolute path
  resolvedPath = resolvePath(resolvedPath);

  const stats = statSync(resolvedPath);
  if (!stats.isFile()) {
    throw new Error(`FFmpeg path points to a directory, not a file: ${resolvedPath}`);
  }

  // Final check: ensure we're not trying to use a path inside .asar
  if (resolvedPath.includes('app.asar') && !resolvedPath.includes('app.asar.unpacked')) {
    throw new Error(
      `Cannot execute FFmpeg from inside .asar archive: ${resolvedPath}. ` +
      `Please ensure 'asarUnpack' is configured in package.json for ffmpeg-static.`
    );
  }

  log(`Final resolved FFmpeg path: ${resolvedPath}`);
  return resolvedPath;
}


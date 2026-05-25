import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolves the path to the ffmpeg binary in priority order:
 * 1. Configured path if set and !== 'ffmpeg' (or absolute/relative exists)
 * 2. Local bin/ folders in the engine directory or project root
 * 3. ffmpeg-static npm dependency
 * 4. Fall back to standard 'ffmpeg' command on the system PATH
 *
 * @param {string|null} configuredPath
 * @returns {Promise<string>} Resolved path to ffmpeg
 */
export async function resolveFfmpegPath(configuredPath) {
  // 1. If configured to a specific custom path, verify and use it
  if (configuredPath && configuredPath !== 'ffmpeg') {
    if (path.isAbsolute(configuredPath) && fs.existsSync(configuredPath)) {
      return configuredPath;
    }
    const absPath = path.resolve(configuredPath);
    if (fs.existsSync(absPath)) {
      return absPath;
    }
  }

  // 2. Check local bin/ folder in the engine directory or project root
  const isWin = process.platform === 'win32';
  const binName = isWin ? 'ffmpeg.exe' : 'ffmpeg';
  
  // marsin_engine/bin/ffmpeg
  const engineBin = path.join(__dirname, '..', 'bin', binName);
  if (fs.existsSync(engineBin)) {
    return engineBin;
  }

  // project_root/bin/ffmpeg (relative to lib/../..)
  const rootBin = path.join(__dirname, '..', '..', 'bin', binName);
  if (fs.existsSync(rootBin)) {
    return rootBin;
  }

  // 3. Try to dynamically import 'ffmpeg-static'
  try {
    const ffmpegStatic = await import('ffmpeg-static');
    if (ffmpegStatic && ffmpegStatic.default) {
      return ffmpegStatic.default;
    }
  } catch (err) {
    // ffmpeg-static could fail to load or not be installed
  }

  // 4. Fall back to default
  return configuredPath || 'ffmpeg';
}

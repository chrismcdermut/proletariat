/**
 * Media Library
 *
 * Manages media files (videos, audio) in HQ workspaces.
 * Preprocesses media into frames + transcripts for agent consumption.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import { styles } from '../styles.js';
import { findHQRoot } from '../workspace.js';
import {
  addMediaItemToDatabase,
  updateMediaItemStatus,
  getWorkspaceMediaItems,
  getMediaItem,
  removeMediaItemFromDatabase,
  type MediaItem,
} from '../database/index.js';

export type { MediaItem } from '../database/index.js';

// =============================================================================
// Dependency Detection
// =============================================================================

/**
 * Check if ffmpeg is installed
 */
export function isFfmpegInstalled(): boolean {
  try {
    execSync('ffmpeg -version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if whisper (or whisper.cpp) is available for transcription
 */
export function isWhisperInstalled(): boolean {
  try {
    execSync('whisper --help', { stdio: 'pipe' });
    return true;
  } catch {
    try {
      execSync('whisper-cpp --help', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Get the whisper command name (whisper or whisper-cpp)
 */
function getWhisperCommand(): string | null {
  try {
    execSync('whisper --help', { stdio: 'pipe' });
    return 'whisper';
  } catch {
    try {
      execSync('whisper-cpp --help', { stdio: 'pipe' });
      return 'whisper-cpp';
    } catch {
      return null;
    }
  }
}

// =============================================================================
// Media Info
// =============================================================================

interface MediaProbeResult {
  duration: number | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  hasVideo: boolean;
}

/**
 * Probe a media file to get its metadata using ffprobe
 */
function probeMedia(filePath: string): MediaProbeResult {
  const result: MediaProbeResult = {
    duration: null,
    width: null,
    height: null,
    hasAudio: false,
    hasVideo: false,
  };

  try {
    const output = execSync(
      `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const data = JSON.parse(output);

    if (data.format?.duration) {
      result.duration = parseFloat(data.format.duration);
    }

    for (const stream of data.streams || []) {
      if (stream.codec_type === 'video') {
        result.hasVideo = true;
        result.width = stream.width;
        result.height = stream.height;
      }
      if (stream.codec_type === 'audio') {
        result.hasAudio = true;
      }
    }
  } catch {
    // ffprobe failed - file might not be a valid media file
  }

  return result;
}

// =============================================================================
// Media CRUD Operations
// =============================================================================

/**
 * Supported media file extensions
 */
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma']);

/**
 * Detect if a file is video or audio based on extension
 */
export function detectMediaType(filePath: string): 'video' | 'audio' | null {
  const ext = path.extname(filePath).toLowerCase();
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  return null;
}

/**
 * Get the media directory path within the HQ
 */
export function getMediaDir(hqPath: string): string {
  return path.join(hqPath, 'media');
}

/**
 * Add a media file to the HQ
 */
export async function addMedia(
  hqPath: string,
  sourcePath: string,
  options: { interval?: number; transcribe?: boolean } = {}
): Promise<{ success: boolean; name: string; error?: string }> {
  const resolvedSource = path.resolve(sourcePath);

  if (!fs.existsSync(resolvedSource)) {
    return { success: false, name: '', error: `File not found: ${resolvedSource}` };
  }

  const mediaType = detectMediaType(resolvedSource);
  if (!mediaType) {
    return { success: false, name: '', error: `Unsupported file type: ${path.extname(resolvedSource)}` };
  }

  if (!isFfmpegInstalled()) {
    return { success: false, name: '', error: 'ffmpeg is not installed. Install it with: brew install ffmpeg' };
  }

  const baseName = path.basename(resolvedSource, path.extname(resolvedSource));
  // Sanitize name: lowercase, replace spaces/special chars with hyphens
  const name = baseName.toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-');

  const mediaDir = getMediaDir(hqPath);
  const itemDir = path.join(mediaDir, name);

  if (fs.existsSync(itemDir)) {
    return { success: false, name, error: `Media "${name}" already exists. Remove it first or use a different name.` };
  }

  // Create directory structure
  fs.mkdirSync(itemDir, { recursive: true });
  fs.mkdirSync(path.join(itemDir, 'frames'), { recursive: true });

  // Copy source file
  const ext = path.extname(resolvedSource);
  const destFile = path.join(itemDir, `source${ext}`);
  console.log(styles.muted(`Copying ${resolvedSource} to media/${name}/...`));
  fs.copyFileSync(resolvedSource, destFile);

  // Add to database
  addMediaItemToDatabase(hqPath, {
    name,
    path: `media/${name}`,
    source_path: resolvedSource,
    media_type: mediaType,
    frame_interval: options.interval || 30,
  });

  // Run preprocessing
  console.log(styles.muted('Starting preprocessing...'));
  const preprocessResult = await preprocessMedia(hqPath, name, {
    interval: options.interval || 30,
    transcribe: options.transcribe ?? true,
  });

  if (!preprocessResult.success) {
    console.log(chalk.yellow(`Warning: Preprocessing had issues: ${preprocessResult.error}`));
    console.log(chalk.yellow('You can retry with: prlt media preprocess ' + name));
  }

  return { success: true, name };
}

/**
 * Remove a media item from the HQ
 */
export function removeMedia(
  hqPath: string,
  name: string
): { success: boolean; error?: string } {
  const itemDir = path.join(getMediaDir(hqPath), name);

  // Remove from file system
  if (fs.existsSync(itemDir)) {
    fs.rmSync(itemDir, { recursive: true, force: true });
  }

  // Remove from database
  removeMediaItemFromDatabase(hqPath, name);

  return { success: true };
}

/**
 * List all media items in the workspace
 */
export function listMedia(hqPath: string): MediaItem[] {
  return getWorkspaceMediaItems(hqPath);
}

/**
 * Get details for a specific media item
 */
export function showMedia(hqPath: string, name: string): MediaItem | null {
  return getMediaItem(hqPath, name);
}

// =============================================================================
// Preprocessing Pipeline
// =============================================================================

/**
 * Format seconds into a timestamp string (e.g., "01m30s")
 */
function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}m${String(s).padStart(2, '0')}s`;
}

/**
 * Preprocess a media file: extract frames and generate transcript
 */
export async function preprocessMedia(
  hqPath: string,
  name: string,
  options: { interval?: number; transcribe?: boolean } = {}
): Promise<{ success: boolean; error?: string }> {
  const interval = options.interval || 30;
  const transcribe = options.transcribe ?? true;

  const item = getMediaItem(hqPath, name);
  if (!item) {
    return { success: false, error: `Media "${name}" not found` };
  }

  const itemDir = path.join(getMediaDir(hqPath), name);
  if (!fs.existsSync(itemDir)) {
    return { success: false, error: `Media directory not found: ${itemDir}` };
  }

  // Find source file
  const sourceFile = findSourceFile(itemDir);
  if (!sourceFile) {
    return { success: false, error: 'Source media file not found in media directory' };
  }

  // Mark as processing
  updateMediaItemStatus(hqPath, name, { status: 'processing' });

  // Probe media info
  const probe = probeMedia(sourceFile);
  const resolution = probe.width && probe.height ? `${probe.width}x${probe.height}` : undefined;

  // Clean previous frames
  const framesDir = path.join(itemDir, 'frames');
  if (fs.existsSync(framesDir)) {
    fs.rmSync(framesDir, { recursive: true });
  }
  fs.mkdirSync(framesDir, { recursive: true });

  let frameCount = 0;
  let hasTranscript = false;
  const errors: string[] = [];

  // Extract frames (only for video)
  if (probe.hasVideo) {
    try {
      console.log(styles.muted(`Extracting frames every ${interval}s...`));

      // Use ffmpeg to extract frames at the specified interval
      // Output as frame_NNNN_XXmYYs.jpg for easy reference
      execSync(
        `ffmpeg -i "${sourceFile}" -vf "fps=1/${interval}" -q:v 2 "${path.join(framesDir, 'frame_%04d.jpg')}" -y`,
        { stdio: 'pipe' }
      );

      // Rename frames with timestamps
      const frameFiles = fs.readdirSync(framesDir).filter(f => f.endsWith('.jpg')).sort();
      for (let i = 0; i < frameFiles.length; i++) {
        const oldPath = path.join(framesDir, frameFiles[i]);
        const timestamp = formatTimestamp(i * interval);
        const newName = `frame_${String(i).padStart(4, '0')}_${timestamp}.jpg`;
        const newPath = path.join(framesDir, newName);
        fs.renameSync(oldPath, newPath);
      }

      frameCount = frameFiles.length;
      console.log(styles.muted(`Extracted ${frameCount} frames`));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`Frame extraction failed: ${msg}`);
      console.log(chalk.yellow(`Warning: Frame extraction failed: ${msg}`));
    }
  }

  // Generate transcript
  if (transcribe && probe.hasAudio) {
    const whisperCmd = getWhisperCommand();
    if (whisperCmd) {
      try {
        console.log(styles.muted('Generating transcript...'));

        // Extract audio to WAV for whisper compatibility
        const wavPath = path.join(itemDir, 'audio.wav');
        execSync(
          `ffmpeg -i "${sourceFile}" -ar 16000 -ac 1 -c:a pcm_s16le "${wavPath}" -y`,
          { stdio: 'pipe' }
        );

        // Run whisper
        execSync(
          `${whisperCmd} "${wavPath}" --output_format txt,json --output_dir "${itemDir}"`,
          { stdio: 'pipe', timeout: 600000 } // 10 min timeout
        );

        // Clean up WAV
        if (fs.existsSync(wavPath)) {
          fs.unlinkSync(wavPath);
        }

        // Look for generated transcript files and rename them
        const txtFiles = fs.readdirSync(itemDir).filter(f => f.endsWith('.txt') && f !== 'transcript.md');
        const jsonFiles = fs.readdirSync(itemDir).filter(f => f.endsWith('.json') && f !== 'manifest.json');

        if (txtFiles.length > 0) {
          const txtContent = fs.readFileSync(path.join(itemDir, txtFiles[0]), 'utf-8');
          fs.writeFileSync(path.join(itemDir, 'transcript.md'), `# Transcript: ${name}\n\n${txtContent}`);
          // Clean up original
          fs.unlinkSync(path.join(itemDir, txtFiles[0]));
          hasTranscript = true;
        }

        if (jsonFiles.length > 0) {
          fs.renameSync(path.join(itemDir, jsonFiles[0]), path.join(itemDir, 'transcript.json'));
        }

        console.log(styles.muted('Transcript generated'));
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`Transcription failed: ${msg}`);
        console.log(chalk.yellow(`Warning: Transcription failed: ${msg}`));
      }
    } else {
      console.log(chalk.yellow('Whisper not installed. Skipping transcription.'));
      console.log(chalk.yellow('Install with: pip install openai-whisper'));
    }
  } else if (transcribe && !probe.hasAudio) {
    console.log(styles.muted('No audio stream found. Skipping transcription.'));
  }

  // Generate manifest
  const manifest = generateManifest(name, itemDir, probe, frameCount, hasTranscript, interval);
  fs.writeFileSync(path.join(itemDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // Update database
  const status = errors.length > 0 ? 'error' as const : 'ready' as const;
  updateMediaItemStatus(hqPath, name, {
    status,
    duration_seconds: probe.duration ?? undefined,
    resolution,
    frame_count: frameCount,
    has_transcript: hasTranscript,
    error_message: errors.length > 0 ? errors.join('; ') : undefined,
  });

  if (errors.length > 0) {
    return { success: false, error: errors.join('; ') };
  }

  return { success: true };
}

// =============================================================================
// Manifest Generation
// =============================================================================

interface MediaManifest {
  name: string;
  media_type: 'video' | 'audio';
  duration_seconds: number | null;
  resolution: string | null;
  frame_interval_seconds: number;
  frame_count: number;
  has_transcript: boolean;
  frames: Array<{
    filename: string;
    timestamp_seconds: number;
    timestamp_display: string;
  }>;
  transcript_file: string | null;
  transcript_json_file: string | null;
  processed_at: string;
}

/**
 * Generate a manifest.json with metadata about the preprocessed media
 */
function generateManifest(
  name: string,
  itemDir: string,
  probe: MediaProbeResult,
  frameCount: number,
  hasTranscript: boolean,
  interval: number
): MediaManifest {
  const framesDir = path.join(itemDir, 'frames');
  const frameFiles = fs.existsSync(framesDir)
    ? fs.readdirSync(framesDir).filter(f => f.endsWith('.jpg')).sort()
    : [];

  return {
    name,
    media_type: probe.hasVideo ? 'video' : 'audio',
    duration_seconds: probe.duration,
    resolution: probe.width && probe.height ? `${probe.width}x${probe.height}` : null,
    frame_interval_seconds: interval,
    frame_count: frameCount,
    has_transcript: hasTranscript,
    frames: frameFiles.map((filename, i) => ({
      filename,
      timestamp_seconds: i * interval,
      timestamp_display: formatTimestamp(i * interval),
    })),
    transcript_file: hasTranscript ? 'transcript.md' : null,
    transcript_json_file: fs.existsSync(path.join(itemDir, 'transcript.json')) ? 'transcript.json' : null,
    processed_at: new Date().toISOString(),
  };
}

// =============================================================================
// Workspace Info
// =============================================================================

export interface MediaInfo {
  name: string;
  mediaType: 'video' | 'audio';
  status: 'pending' | 'processing' | 'ready' | 'error';
  frameCount: number;
  hasTranscript: boolean;
  durationSeconds: number | null;
  resolution: string | null;
  addedAt: string;
}

/**
 * Get workspace media information
 */
export function getWorkspaceMediaInfo(): { hqPath: string; mediaPath: string; media: MediaInfo[] } {
  const hqPath = findHQRoot();
  if (!hqPath) {
    throw new Error('Not in an HQ directory. Run "prlt new" first.');
  }

  const mediaPath = getMediaDir(hqPath);
  const items = getWorkspaceMediaItems(hqPath);

  const media: MediaInfo[] = items.map(item => ({
    name: item.name,
    mediaType: item.media_type,
    status: item.status,
    frameCount: item.frame_count,
    hasTranscript: item.has_transcript,
    durationSeconds: item.duration_seconds,
    resolution: item.resolution,
    addedAt: item.added_at,
  }));

  return { hqPath, mediaPath, media };
}

// =============================================================================
// Agent Workspace Mounting (TKT-077)
// =============================================================================

/**
 * Copy preprocessed media assets into an agent's workspace directory.
 * Only copies lightweight preprocessed assets (frames/, transcript.md, manifest.json).
 * Does NOT copy the raw source video (too large).
 *
 * @param hqPath - The HQ root path
 * @param agentDir - The agent's working directory (e.g., agents/temp/thick-spiegel)
 */
export function copyMediaToAgentWorkspace(hqPath: string, agentDir: string): void {
  const mediaDir = getMediaDir(hqPath);
  if (!fs.existsSync(mediaDir)) {
    return;
  }

  const items = getWorkspaceMediaItems(hqPath);
  const readyItems = items.filter(item => item.status === 'ready');

  if (readyItems.length === 0) {
    return;
  }

  const agentMediaDir = path.join(agentDir, 'media');
  fs.mkdirSync(agentMediaDir, { recursive: true });

  for (const item of readyItems) {
    const sourceItemDir = path.join(hqPath, item.path);
    const destItemDir = path.join(agentMediaDir, item.name);

    if (!fs.existsSync(sourceItemDir)) {
      continue;
    }

    fs.mkdirSync(destItemDir, { recursive: true });

    // Copy manifest.json
    const manifestSrc = path.join(sourceItemDir, 'manifest.json');
    if (fs.existsSync(manifestSrc)) {
      fs.copyFileSync(manifestSrc, path.join(destItemDir, 'manifest.json'));
    }

    // Copy transcript.md
    const transcriptSrc = path.join(sourceItemDir, 'transcript.md');
    if (fs.existsSync(transcriptSrc)) {
      fs.copyFileSync(transcriptSrc, path.join(destItemDir, 'transcript.md'));
    }

    // Copy transcript.json
    const transcriptJsonSrc = path.join(sourceItemDir, 'transcript.json');
    if (fs.existsSync(transcriptJsonSrc)) {
      fs.copyFileSync(transcriptJsonSrc, path.join(destItemDir, 'transcript.json'));
    }

    // Copy frames directory
    const framesSrc = path.join(sourceItemDir, 'frames');
    if (fs.existsSync(framesSrc)) {
      const framesDest = path.join(destItemDir, 'frames');
      fs.mkdirSync(framesDest, { recursive: true });
      const frameFiles = fs.readdirSync(framesSrc);
      for (const file of frameFiles) {
        fs.copyFileSync(path.join(framesSrc, file), path.join(framesDest, file));
      }
    }
  }
}

// =============================================================================
// Utility
// =============================================================================

/**
 * Find the source media file in a media item directory
 */
function findSourceFile(itemDir: string): string | null {
  const allExtensions = [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS];
  for (const ext of allExtensions) {
    const sourceFile = path.join(itemDir, `source${ext}`);
    if (fs.existsSync(sourceFile)) {
      return sourceFile;
    }
  }

  // Also check for files with 'source' prefix or just any media file
  const files = fs.readdirSync(itemDir);
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (allExtensions.includes(ext as typeof allExtensions[number])) {
      return path.join(itemDir, file);
    }
  }

  return null;
}

/**
 * Format duration in seconds to human-readable string
 */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}h ${m}m ${s}s`;
  }
  if (m > 0) {
    return `${m}m ${s}s`;
  }
  return `${s}s`;
}

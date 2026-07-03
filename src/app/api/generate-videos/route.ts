import { NextRequest, NextResponse } from 'next/server';
import { promises as fs, existsSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStaticPath from 'ffmpeg-static';

// child_process-based ffmpeg transcoding requires Node, not the Edge runtime.
export const runtime = 'nodejs';
export const maxDuration = 300;

if (ffmpegStaticPath) {
  ffmpeg.setFfmpegPath(ffmpegStaticPath);
}

const OUTPUT_DIR = path.join('/tmp', 'output');

const SUBTITLE_COLORS = ['white', 'yellow', 'neon'] as const;
type SubtitleColor = (typeof SUBTITLE_COLORS)[number];

const COLOR_MAP: Record<SubtitleColor, string> = {
  white: 'white',
  yellow: 'yellow',
  neon: '0x39FF14',
};

const MIN_SUBTITLE_SIZE = 20;
const MAX_SUBTITLE_SIZE = 60;

// ffmpeg-static ships no fonts, so pick whichever Arial-like font exists on the host.
const FONT_CANDIDATES = [
  'C:\\Windows\\Fonts\\arial.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
];

interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

type AspectRatio = '9:16' | '1:1' | '16:9';
const ASPECT_RATIOS: AspectRatio[] = ['9:16', '1:1', '16:9'];

interface VideoVariant {
  name: 'vertical' | 'square' | 'horizontal';
  ratio: AspectRatio;
  buildFilters: (fontFile: string, color: string, size: number, cues: SubtitleCue[]) => string[];
}

class GenerateVideosError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

function findFont(): string {
  const found = FONT_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new GenerateVideosError('No suitable font (Arial or equivalent) was found on the server', 500);
  }
  return found;
}

function parseSrt(srt: string): SubtitleCue[] {
  const timeRegex = /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/;
  const toSeconds = (h: string, m: string, s: string, ms: string) =>
    Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;

  const blocks = srt.replace(/\r\n/g, '\n').trim().split(/\n\s*\n/);
  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.length > 0);
    if (lines.length < 2) continue;

    const timeLineIndex = /^\d+$/.test(lines[0].trim()) ? 1 : 0;
    const match = lines[timeLineIndex]?.match(timeRegex);
    if (!match) continue;

    const text = lines.slice(timeLineIndex + 1).join(' ').trim();
    if (!text) continue;

    cues.push({
      start: toSeconds(match[1], match[2], match[3], match[4]),
      end: toSeconds(match[5], match[6], match[7], match[8]),
      text,
    });
  }

  return cues;
}

function escapeDrawtextValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "'\\''")
    .replace(/%/g, '\\%')
    .replace(/\n/g, ' ');
}

function buildDrawtextFilters(cues: SubtitleCue[], fontFile: string, color: string, size: number): string[] {
  const fontFilePosix = escapeDrawtextValue(fontFile.replace(/\\/g, '/'));
  const margin = Math.round(size * 0.8);

  return cues.map((cue) => {
    const text = escapeDrawtextValue(cue.text);
    return (
      `drawtext=fontfile='${fontFilePosix}':text='${text}':fontcolor=${color}:fontsize=${size}` +
      `:borderw=2:bordercolor=black:x=(w-text_w)/2:y=h-text_h-${margin}` +
      `:enable='between(t,${cue.start.toFixed(3)},${cue.end.toFixed(3)})'`
    );
  });
}

const VARIANTS: VideoVariant[] = [
  {
    name: 'vertical',
    ratio: '9:16',
    buildFilters: (fontFile, color, size, cues) => [
      'scale=1080:1920:force_original_aspect_ratio=decrease',
      'pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black',
      ...buildDrawtextFilters(cues, fontFile, color, size),
    ],
  },
  {
    name: 'square',
    ratio: '1:1',
    buildFilters: (fontFile, color, size, cues) => [
      'scale=1080:1080:force_original_aspect_ratio=increase',
      'crop=1080:1080',
      ...buildDrawtextFilters(cues, fontFile, color, size),
    ],
  },
  {
    name: 'horizontal',
    ratio: '16:9',
    buildFilters: (fontFile, color, size, cues) => [
      'scale=1920:1080:force_original_aspect_ratio=decrease',
      'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black',
      ...buildDrawtextFilters(cues, fontFile, color, size),
    ],
  },
];

function runFfmpeg(inputPath: string, outputPath: string, filters: string[], variantName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoFilters(filters)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions(['-preset veryfast', '-movflags +faststart'])
      .on('error', (err) => reject(new GenerateVideosError(`FFmpeg failed for ${variantName}: ${err.message}`, 500)))
      .on('end', () => resolve())
      .save(outputPath);
  });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ status: 'error', error: 'Request body must be valid JSON' }, { status: 400 });
  }

  const { videoPath, srt, subtitleColor, subtitleSize, aspectRatios } = (body ?? {}) as {
    videoPath?: unknown;
    srt?: unknown;
    subtitleColor?: unknown;
    subtitleSize?: unknown;
    aspectRatios?: unknown;
  };

  if (typeof videoPath !== 'string' || videoPath.trim().length === 0) {
    return NextResponse.json({ status: 'error', error: 'videoPath is required' }, { status: 400 });
  }
  if (typeof srt !== 'string' || srt.trim().length === 0) {
    return NextResponse.json({ status: 'error', error: 'srt is required' }, { status: 400 });
  }
  if (typeof subtitleColor !== 'string' || !SUBTITLE_COLORS.includes(subtitleColor as SubtitleColor)) {
    return NextResponse.json(
      { status: 'error', error: `subtitleColor must be one of: ${SUBTITLE_COLORS.join(', ')}` },
      { status: 400 }
    );
  }
  if (
    typeof subtitleSize !== 'number' ||
    !Number.isFinite(subtitleSize) ||
    subtitleSize < MIN_SUBTITLE_SIZE ||
    subtitleSize > MAX_SUBTITLE_SIZE
  ) {
    return NextResponse.json(
      { status: 'error', error: `subtitleSize must be a number between ${MIN_SUBTITLE_SIZE} and ${MAX_SUBTITLE_SIZE}` },
      { status: 400 }
    );
  }

  if (
    !Array.isArray(aspectRatios) ||
    aspectRatios.length === 0 ||
    !aspectRatios.every((r) => ASPECT_RATIOS.includes(r as AspectRatio))
  ) {
    return NextResponse.json(
      { status: 'error', error: `aspectRatios must be a non-empty array of: ${ASPECT_RATIOS.join(', ')}` },
      { status: 400 }
    );
  }

  const selectedVariants = VARIANTS.filter((v) => (aspectRatios as AspectRatio[]).includes(v.ratio));

  try {
    await fs.access(videoPath);
  } catch {
    return NextResponse.json({ status: 'error', error: `videoPath does not exist: ${videoPath}` }, { status: 400 });
  }

  const cues = parseSrt(srt);
  if (cues.length === 0) {
    return NextResponse.json({ status: 'error', error: 'srt did not contain any parseable subtitle cues' }, { status: 400 });
  }

  const producedPaths: string[] = [];

  try {
    const fontFile = findFont();
    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    const jobId = crypto.randomUUID();
    const results: Partial<Record<VideoVariant['name'], string>> = {};

    for (const variant of selectedVariants) {
      const filename = `${jobId}-${variant.name}.mp4`;
      const outputPath = path.join(OUTPUT_DIR, filename);
      const filters = variant.buildFilters(fontFile, COLOR_MAP[subtitleColor as SubtitleColor], subtitleSize, cues);

      await runFfmpeg(videoPath, outputPath, filters, variant.name);

      producedPaths.push(outputPath);
      results[variant.name] = `/api/videos/${filename}`;
    }

    return NextResponse.json({
      status: 'success',
      videos: results,
    });
  } catch (err) {
    await Promise.all(producedPaths.map((p) => fs.rm(p, { force: true }).catch(() => {})));

    const statusCode = err instanceof GenerateVideosError ? err.statusCode : 500;
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ status: 'error', error: message }, { status: statusCode });
  }
}

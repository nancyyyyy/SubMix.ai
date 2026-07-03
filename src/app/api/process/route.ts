import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import ytDlp from 'yt-dlp-exec';

// Downloads the source video with yt-dlp and forwards to /api/transcribe and
// /api/generate-videos over HTTP, so this needs Node, not the Edge runtime.
export const runtime = 'nodejs';
export const maxDuration = 300;

const YOUTUBE_URL_REGEX =
  /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/|live\/)[\w-]{11}|youtu\.be\/[\w-]{11})(\S*)?$/i;

const SUBTITLE_COLORS = ['white', 'yellow', 'neon'] as const;
type SubtitleColor = (typeof SUBTITLE_COLORS)[number];

const ASPECT_RATIOS = ['9:16', '1:1', '16:9'] as const;
type AspectRatio = (typeof ASPECT_RATIOS)[number];

// generate-videos still speaks in variant names internally; this maps the
// public aspect-ratio contract onto them.
const RATIO_TO_VARIANT = {
  '9:16': 'vertical',
  '1:1': 'square',
  '16:9': 'horizontal',
} as const;
type Variant = (typeof RATIO_TO_VARIANT)[AspectRatio];

const MIN_SUBTITLE_SIZE = 20;
const MAX_SUBTITLE_SIZE = 60;

const VIDEO_DOWNLOAD_TIMEOUT_MS = 3 * 60 * 1000;

type Step = 'validation' | 'transcribe' | 'download' | 'generate-videos';

interface ProcessRequestBody {
  url: string;
  subtitleColor: SubtitleColor;
  subtitleSize: number;
  aspectRatios: AspectRatio[];
}

type Videos = Partial<Record<AspectRatio, string>>;

class ProcessError extends Error {
  step: Step;
  statusCode: number;
  constructor(message: string, step: Step, statusCode: number) {
    super(message);
    this.step = step;
    this.statusCode = statusCode;
  }
}

function isValidYouTubeUrl(url: string): boolean {
  return YOUTUBE_URL_REGEX.test(url.trim());
}

function parseBody(body: unknown): ProcessRequestBody {
  const { url, subtitleColor, subtitleSize, aspectRatios } = (body ?? {}) as {
    url?: unknown;
    subtitleColor?: unknown;
    subtitleSize?: unknown;
    aspectRatios?: unknown;
  };

  if (typeof url !== 'string' || !isValidYouTubeUrl(url)) {
    throw new ProcessError('A valid YouTube URL (youtube.com or youtu.be) is required', 'validation', 400);
  }
  if (typeof subtitleColor !== 'string' || !SUBTITLE_COLORS.includes(subtitleColor as SubtitleColor)) {
    throw new ProcessError(`subtitleColor must be one of: ${SUBTITLE_COLORS.join(', ')}`, 'validation', 400);
  }
  if (
    typeof subtitleSize !== 'number' ||
    !Number.isFinite(subtitleSize) ||
    subtitleSize < MIN_SUBTITLE_SIZE ||
    subtitleSize > MAX_SUBTITLE_SIZE
  ) {
    throw new ProcessError(
      `subtitleSize must be a number between ${MIN_SUBTITLE_SIZE} and ${MAX_SUBTITLE_SIZE}`,
      'validation',
      400
    );
  }
  if (
    !Array.isArray(aspectRatios) ||
    aspectRatios.length === 0 ||
    !aspectRatios.every((r): r is AspectRatio => typeof r === 'string' && ASPECT_RATIOS.includes(r as AspectRatio))
  ) {
    throw new ProcessError(
      `aspectRatios must be a non-empty array of: ${ASPECT_RATIOS.join(', ')}`,
      'validation',
      400
    );
  }

  return {
    url: url.trim(),
    subtitleColor: subtitleColor as SubtitleColor,
    subtitleSize,
    aspectRatios: Array.from(new Set(aspectRatios)),
  };
}

async function safeJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function transcribe(origin: string, url: string): Promise<{ srt: string; duration: number }> {
  let res: Response;
  try {
    res = await fetch(`${origin}/api/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
  } catch (err) {
    throw new ProcessError(
      `Could not reach the transcription service: ${err instanceof Error ? err.message : String(err)}`,
      'transcribe',
      502
    );
  }

  const data = await safeJson(res);
  if (!res.ok || !data || data.status !== 'success') {
    const message = (data?.error as string | undefined) ?? `Transcription failed (${res.status})`;
    throw new ProcessError(message, 'transcribe', res.status >= 400 ? res.status : 502);
  }

  const { srt, duration } = data as { srt?: unknown; duration?: unknown };
  if (typeof srt !== 'string' || srt.trim().length === 0 || typeof duration !== 'number') {
    throw new ProcessError('Transcription service returned an unexpected response', 'transcribe', 502);
  }

  return { srt, duration };
}

// /api/generate-videos operates on a local file path, but /api/transcribe only
// keeps the extracted audio (and cleans it up), so the source video is
// downloaded again here for the styling/render step.
async function downloadSourceVideo(url: string, tempDir: string): Promise<string> {
  const outputTemplate = path.join(tempDir, 'source.%(ext)s');
  try {
    await ytDlp(
      url,
      {
        format: 'mp4/bestvideo+bestaudio',
        mergeOutputFormat: 'mp4',
        output: outputTemplate,
        noPlaylist: true,
        noWarnings: true,
      },
      { timeout: VIDEO_DOWNLOAD_TIMEOUT_MS }
    );
  } catch (err) {
    throw new ProcessError(
      `Failed to download source video: ${err instanceof Error ? err.message : String(err)}`,
      'download',
      502
    );
  }

  const videoPath = path.join(tempDir, 'source.mp4');
  try {
    await fs.access(videoPath);
  } catch {
    throw new ProcessError('yt-dlp did not produce a video file', 'download', 502);
  }
  return videoPath;
}

async function generateVideos(
  origin: string,
  videoPath: string,
  srt: string,
  subtitleColor: SubtitleColor,
  subtitleSize: number,
  aspectRatios: AspectRatio[]
): Promise<Videos> {
  const variants = aspectRatios.map((r) => RATIO_TO_VARIANT[r]);

  let res: Response;
  try {
    res = await fetch(`${origin}/api/generate-videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoPath, srt, subtitleColor, subtitleSize, aspectRatios }),
    });
  } catch (err) {
    throw new ProcessError(
      `Could not reach the video generation service: ${err instanceof Error ? err.message : String(err)}`,
      'generate-videos',
      502
    );
  }

  const data = await safeJson(res);
  if (!res.ok || !data || data.status !== 'success') {
    const message = (data?.error as string | undefined) ?? `Video generation failed (${res.status})`;
    throw new ProcessError(message, 'generate-videos', res.status >= 400 ? res.status : 502);
  }

  const variantVideos = (data as { videos?: unknown }).videos as
    | Partial<Record<Variant, unknown>>
    | undefined;

  if (!variantVideos || !variants.every((v) => typeof variantVideos[v] === 'string')) {
    throw new ProcessError('Video generation service returned an unexpected response', 'generate-videos', 502);
  }

  const videos: Videos = {};
  for (const ratio of aspectRatios) {
    videos[ratio] = variantVideos[RATIO_TO_VARIANT[ratio]] as string;
  }
  return videos;
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ status: 'error', error: 'Request body must be valid JSON' }, { status: 400 });
  }

  let parsed: ProcessRequestBody;
  try {
    parsed = parseBody(body);
  } catch (err) {
    const statusCode = err instanceof ProcessError ? err.statusCode : 400;
    const message = err instanceof Error ? err.message : 'Invalid request';
    return NextResponse.json({ status: 'error', error: message }, { status: statusCode });
  }

  const { url, subtitleColor, subtitleSize, aspectRatios } = parsed;
  const origin = request.nextUrl.origin;

  let tempDir: string | null = null;
  try {
    const { srt, duration } = await transcribe(origin, url);

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'process-'));
    const videoPath = await downloadSourceVideo(url, tempDir);

    const videos = await generateVideos(origin, videoPath, srt, subtitleColor, subtitleSize, aspectRatios);

    return NextResponse.json({ status: 'success', videos, duration });
  } catch (err) {
    const statusCode = err instanceof ProcessError ? err.statusCode : 500;
    const step = err instanceof ProcessError ? err.step : 'unknown';
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ status: 'error', step, error: message }, { status: statusCode });
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

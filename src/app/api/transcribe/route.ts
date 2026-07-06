import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStaticPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { TranscriptSegment } from '@/lib/transcript';
import { createProject, toCaptionSegments } from '@/lib/project';
import { MAX_VIDEO_DURATION_SECONDS } from '@/lib/constants';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

// ffmpeg transcoding + Replicate polling require Node, not the Edge runtime.
export const runtime = 'nodejs';
export const maxDuration = 300;

if (ffmpegStaticPath) {
  ffmpeg.setFfmpegPath(ffmpegStaticPath);
}
if (ffprobeStatic.path) {
  ffmpeg.setFfprobePath(ffprobeStatic.path);
}

const REPLICATE_API_BASE = 'https://api.replicate.com/v1';
const REPLICATE_WHISPER_VERSION =
  process.env.REPLICATE_WHISPER_VERSION ?? '744c4f2bffae674f82e79ed46f9cc54796d4903b3e20e68353e05a93eb10a55c';

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

interface ReplicatePrediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: unknown;
  error?: string | null;
  urls: { get: string; cancel?: string };
}

class TranscribeError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return res.statusText;
  }
}

async function probeDurationSeconds(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(
          new TranscribeError(
            `Failed to read video metadata with ffprobe: ${err instanceof Error ? err.message : String(err)}`,
            400
          )
        );
        return;
      }
      const duration = metadata.format?.duration;
      if (typeof duration !== 'number' || !Number.isFinite(duration)) {
        reject(new TranscribeError('Could not determine video duration', 400));
        return;
      }
      resolve(duration);
    });
  });
}

async function extractAudio(videoPath: string, tempDir: string): Promise<string> {
  const wavPath = path.join(tempDir, 'audio.wav');
  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg(videoPath)
        .noVideo()
        .audioCodec('pcm_s16le')
        .audioChannels(1)
        .audioFrequency(16000)
        .format('wav')
        .on('error', (err) => reject(err))
        .on('end', () => resolve())
        .save(wavPath);
    });
  } catch (err) {
    throw new TranscribeError(
      `Failed to extract audio with ffmpeg: ${err instanceof Error ? err.message : String(err)}`,
      502
    );
  }
  return wavPath;
}

async function uploadAudioToReplicate(filePath: string, token: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const form = new FormData();
  form.append('content', new Blob([buffer], { type: 'audio/wav' }), 'audio.wav');

  let res: Response;
  try {
    res = await fetch(`${REPLICATE_API_BASE}/files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
  } catch (err) {
    throw new TranscribeError(
      `Could not reach Replicate to upload audio: ${err instanceof Error ? err.message : String(err)}`,
      502
    );
  }

  if (!res.ok) {
    throw new TranscribeError(`Replicate file upload failed (${res.status}): ${await safeText(res)}`, 502);
  }

  const data = (await res.json()) as { urls?: { get?: string } };
  const audioUrl = data.urls?.get;
  if (!audioUrl) {
    throw new TranscribeError('Replicate file upload did not return a usable URL', 502);
  }
  return audioUrl;
}

async function createPrediction(audioUrl: string, token: string): Promise<ReplicatePrediction> {
  let res: Response;
  try {
    res = await fetch(`${REPLICATE_API_BASE}/predictions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'wait',
      },
      body: JSON.stringify({
        version: REPLICATE_WHISPER_VERSION,
        input: {
          file_url: audioUrl,
          language: 'en',
          translate: false,
        },
      }),
    });
  } catch (err) {
    throw new TranscribeError(
      `Could not reach Replicate to start transcription: ${err instanceof Error ? err.message : String(err)}`,
      502
    );
  }

  if (!res.ok) {
    throw new TranscribeError(`Whisper prediction request failed (${res.status}): ${await safeText(res)}`, 502);
  }

  return (await res.json()) as ReplicatePrediction;
}

async function pollPrediction(prediction: ReplicatePrediction, token: string): Promise<ReplicatePrediction> {
  let current = prediction;
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (current.status === 'starting' || current.status === 'processing') {
    if (Date.now() > deadline) {
      throw new TranscribeError('Whisper transcription timed out', 504);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const res = await fetch(current.urls.get, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new TranscribeError(`Failed to poll Whisper prediction (${res.status}): ${await safeText(res)}`, 502);
    }
    current = (await res.json()) as ReplicatePrediction;
  }

  if (current.status === 'failed' || current.status === 'canceled') {
    throw new TranscribeError(
      `Whisper transcription ${current.status}: ${current.error ?? 'unknown error'}`,
      502
    );
  }

  return current;
}

// thomasmol/whisper-diarization attaches a "words" array (word/start/end,
// plus speaker/probability we ignore) to every entry in "segments". If a
// future model swap omits "words", fail loudly instead of silently falling
// back to line-level-only timing.
function extractSegments(output: unknown): TranscriptSegment[] {
  const candidate = output as Record<string, unknown> | null;
  const rawSegments = candidate && typeof candidate === 'object' ? candidate.segments : undefined;

  if (!Array.isArray(rawSegments)) {
    throw new TranscribeError('Whisper response did not include a "segments" array', 502);
  }

  const segments: TranscriptSegment[] = [];

  for (const raw of rawSegments) {
    const seg = raw as Record<string, unknown>;
    const text = typeof seg.text === 'string' ? seg.text.trim() : '';
    if (!text) continue;

    const rawWords = seg.words;
    if (!Array.isArray(rawWords) || rawWords.length === 0) {
      throw new TranscribeError(
        'Whisper segments did not include word-level timestamps. The configured Replicate model/version does ' +
          'not return a "words" array per segment.',
        502
      );
    }

    const words = rawWords.map((w) => {
      const word = w as Record<string, unknown>;
      return {
        word: String(word.word ?? '').trim(),
        start: Number(word.start),
        end: Number(word.end),
      };
    });

    segments.push({
      start: Number(seg.start),
      end: Number(seg.end),
      text,
      words,
    });
  }

  if (segments.length === 0) {
    throw new TranscribeError('Whisper response did not include any transcribed segments', 502);
  }

  return segments;
}

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
};
const ALLOWED_EXTENSIONS = ['.mp4', '.mov', '.webm'];
const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024;
// multipart/form-data adds boundary markers and field headers on top of the
// raw file bytes; this just keeps the Content-Length pre-check from
// rejecting a file that's actually right at the limit.
const MULTIPART_OVERHEAD_BYTES = 5 * 1024 * 1024;

function resolveExtension(file: File): string | null {
  const nameExt = path.extname(file.name).toLowerCase();
  if (ALLOWED_EXTENSIONS.includes(nameExt)) return nameExt;
  return EXTENSION_BY_MIME_TYPE[file.type] ?? null;
}

// Stage 1 only: transcribes the upload and persists it as a project (video +
// word-level caption JSON). It never burns captions into video — that's
// Stage 2, triggered separately and repeatably via /api/render.
export async function POST(request: NextRequest) {
  const rateLimit = checkRateLimit(`transcribe:${getClientIp(request)}`);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { status: 'error', error: 'Too many requests, please try again later' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
    );
  }

  // Reject oversized uploads from the Content-Length header before buffering
  // the request body into memory — request.formData() below reads the whole
  // body up front, so without this an oversized file would already be fully
  // received (and held in memory) by the time the later size check runs.
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_FILE_SIZE_BYTES + MULTIPART_OVERHEAD_BYTES) {
    return NextResponse.json(
      { status: 'error', error: `Video file exceeds the ${Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024))}MB limit` },
      { status: 413 }
    );
  }

  const replicateToken = process.env.REPLICATE_API_TOKEN;
  if (!replicateToken) {
    return NextResponse.json(
      { status: 'error', error: 'Server is missing REPLICATE_API_TOKEN' },
      { status: 500 }
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ status: 'error', error: 'Request body must be multipart/form-data' }, { status: 400 });
  }

  const file = formData.get('video');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ status: 'error', error: 'A video file is required' }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { status: 'error', error: `Video file exceeds the ${Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024))}MB limit` },
      { status: 400 }
    );
  }
  const extension = resolveExtension(file);
  if (!extension) {
    return NextResponse.json(
      { status: 'error', error: `Unsupported file type. Accepted formats: ${ALLOWED_EXTENSIONS.join(', ')}` },
      { status: 400 }
    );
  }

  let tempDir: string | null = null;
  try {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'transcribe-'));
    const videoBuffer = Buffer.from(await file.arrayBuffer());
    const videoPath = path.join(tempDir, `source${extension}`);
    await fs.writeFile(videoPath, videoBuffer);

    const durationSeconds = await probeDurationSeconds(videoPath);
    if (durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
      throw new TranscribeError(
        `Video exceeds the ${Math.round(MAX_VIDEO_DURATION_SECONDS / 60)}-minute limit`,
        400
      );
    }

    const wavPath = await extractAudio(videoPath, tempDir);

    const audioUrl = await uploadAudioToReplicate(wavPath, replicateToken);
    const created = await createPrediction(audioUrl, replicateToken);
    const finished = await pollPrediction(created, replicateToken);
    const segments = extractSegments(finished.output);

    const project = await createProject({
      videoBuffer,
      videoExtension: extension,
      segments: toCaptionSegments(segments),
    });

    return NextResponse.json({ status: 'success', projectId: project.id, project });
  } catch (err) {
    const statusCode = err instanceof TranscribeError ? err.statusCode : 500;
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ status: 'error', error: message }, { status: statusCode });
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

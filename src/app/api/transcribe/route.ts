import { NextRequest, NextResponse } from 'next/server';
import { promises as fs, createWriteStream } from 'fs';
import os from 'os';
import path from 'path';
import ytdl from 'ytdl-core';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStaticPath from 'ffmpeg-static';

// ytdl-core streams + ffmpeg transcoding require Node, not the Edge runtime.
export const runtime = 'nodejs';
export const maxDuration = 300;

if (ffmpegStaticPath) {
  ffmpeg.setFfmpegPath(ffmpegStaticPath);
}

const YOUTUBE_URL_REGEX =
  /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/|live\/)[\w-]{11}|youtu\.be\/[\w-]{11})(\S*)?$/i;

const REPLICATE_API_BASE = 'https://api.replicate.com/v1';
// Referencing the model by name (rather than a pinned version hash) always
// resolves to the latest version, so this doesn't go stale as Replicate
// publishes new versions of the model.
const REPLICATE_MODEL = process.env.REPLICATE_WHISPER_MODEL ?? 'openai/whisper';

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 3 * 60 * 1000;

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

function isValidYouTubeUrl(url: string): boolean {
  return YOUTUBE_URL_REGEX.test(url.trim());
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return res.statusText;
  }
}

async function fetchVideoInfo(url: string): Promise<ytdl.videoInfo> {
  try {
    return await ytdl.getInfo(url);
  } catch (err) {
    throw new TranscribeError(
      `Could not read video metadata (is the URL valid and public?): ${
        err instanceof Error ? err.message : String(err)
      }`,
      422
    );
  }
}

function getVideoDuration(info: ytdl.videoInfo): number {
  const seconds = Number(info.videoDetails.lengthSeconds);
  return Number.isFinite(seconds) ? seconds : 0;
}

async function downloadRawAudio(info: ytdl.videoInfo, tempDir: string): Promise<string> {
  let format: ytdl.videoFormat;
  try {
    format = ytdl.chooseFormat(info.formats, { filter: 'audioonly', quality: 'highestaudio' });
  } catch (err) {
    throw new TranscribeError(
      `No downloadable audio stream was found for this video: ${
        err instanceof Error ? err.message : String(err)
      }`,
      422
    );
  }

  const rawPath = path.join(tempDir, `audio-raw.${format.container || 'webm'}`);

  try {
    await new Promise<void>((resolve, reject) => {
      const stream = ytdl.downloadFromInfo(info, { format });
      const fileStream = createWriteStream(rawPath);
      const timer = setTimeout(() => stream.destroy(new Error('Download timed out')), DOWNLOAD_TIMEOUT_MS);

      const fail = (err: Error) => {
        clearTimeout(timer);
        fileStream.destroy();
        reject(err);
      };

      stream.on('error', fail);
      fileStream.on('error', fail);
      fileStream.on('finish', () => {
        clearTimeout(timer);
        resolve();
      });
      stream.pipe(fileStream);
    });
  } catch (err) {
    throw new TranscribeError(
      `Failed to download audio stream: ${err instanceof Error ? err.message : String(err)}`,
      502
    );
  }

  return rawPath;
}

async function extractWav(rawPath: string, tempDir: string): Promise<string> {
  const wavPath = path.join(tempDir, 'audio.wav');
  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg(rawPath)
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
    res = await fetch(`${REPLICATE_API_BASE}/models/${REPLICATE_MODEL}/predictions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'wait',
      },
      body: JSON.stringify({
        input: {
          audio: audioUrl,
          transcription: 'srt',
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

// The exact output field name varies across whisper model versions/forks
// on Replicate, so check a few of the common ones defensively.
function extractSrt(output: unknown): string {
  if (typeof output === 'string') {
    return output;
  }
  if (output && typeof output === 'object') {
    const candidate = output as Record<string, unknown>;
    for (const key of ['srt', 'transcription', 'subtitles']) {
      if (typeof candidate[key] === 'string') {
        return candidate[key] as string;
      }
    }
  }
  throw new TranscribeError('Whisper response did not include SRT output', 502);
}

export async function POST(request: NextRequest) {
  const replicateToken = process.env.REPLICATE_API_TOKEN;
  if (!replicateToken) {
    return NextResponse.json(
      { status: 'error', error: 'Server is missing REPLICATE_API_TOKEN' },
      { status: 500 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ status: 'error', error: 'Request body must be valid JSON' }, { status: 400 });
  }

  const url = (body as { url?: unknown })?.url;
  if (typeof url !== 'string' || !isValidYouTubeUrl(url)) {
    return NextResponse.json(
      { status: 'error', error: 'A valid YouTube URL (youtube.com or youtu.be) is required' },
      { status: 400 }
    );
  }

  let tempDir: string | null = null;
  try {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'transcribe-'));

    const info = await fetchVideoInfo(url);
    const duration = getVideoDuration(info);
    const rawPath = await downloadRawAudio(info, tempDir);
    const wavPath = await extractWav(rawPath, tempDir);

    const audioUrl = await uploadAudioToReplicate(wavPath, replicateToken);
    const created = await createPrediction(audioUrl, replicateToken);
    const finished = await pollPrediction(created, replicateToken);
    const srt = extractSrt(finished.output);

    return NextResponse.json({ srt, duration, status: 'success' });
  } catch (err) {
    const statusCode = err instanceof TranscribeError ? err.statusCode : 500;
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ srt: '', duration: 0, status: 'error', error: message }, { status: statusCode });
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

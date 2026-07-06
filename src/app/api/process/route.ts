import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import {
  ASPECT_RATIOS,
  DEFAULT_STYLE,
  FONT_CHOICES,
  MAX_OUTLINE_WIDTH,
  MAX_SHADOW_DEPTH,
  MAX_SUBTITLE_SIZE,
  MIN_OUTLINE_WIDTH,
  MIN_SHADOW_DEPTH,
  MIN_SUBTITLE_SIZE,
  SUBTITLE_POSITIONS,
  isHexColor,
  type AspectRatio,
  type FontChoice,
  type StyleSettings,
  type SubtitlePosition,
} from '@/lib/project';
import { getClientIp } from '@/lib/rate-limit';

// Thin backward-compatible orchestrator for the single-shot upload flow:
// forwards the upload to /api/transcribe (Stage 1, persists a project), then
// immediately to /api/render (Stage 2) with the submitted style. Kept only so
// the existing one-shot UI keeps working; a caption-editing flow should call
// /api/transcribe and /api/render directly instead of going through here.
export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024;
// multipart/form-data adds boundary markers and field headers on top of the
// raw file bytes; this just keeps the Content-Length pre-check from
// rejecting a file that's actually right at the limit.
const MULTIPART_OVERHEAD_BYTES = 5 * 1024 * 1024;
const MAX_DURATION_SECONDS = 10 * 60;

const ALLOWED_EXTENSIONS = ['.mp4', '.mov', '.webm'];
const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
};

type Step = 'validation' | 'transcribe' | 'render';

interface ParsedRequest {
  file: File;
  style: StyleSettings;
  aspectRatios: AspectRatio[];
  duration: number;
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

function validateExtension(file: File): void {
  const nameExt = path.extname(file.name).toLowerCase();
  if (ALLOWED_EXTENSIONS.includes(nameExt) || EXTENSION_BY_MIME_TYPE[file.type]) return;

  throw new ProcessError(
    `Unsupported file type. Accepted formats: ${ALLOWED_EXTENSIONS.join(', ')}`,
    'validation',
    400
  );
}

async function parseFormData(request: NextRequest): Promise<ParsedRequest> {
  // Reject oversized uploads from the Content-Length header before buffering
  // the request body into memory — request.formData() below reads the whole
  // body up front, so without this an oversized file would already be fully
  // received (and held in memory) by the time the later size check runs.
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_FILE_SIZE_BYTES + MULTIPART_OVERHEAD_BYTES) {
    throw new ProcessError(
      `Video file exceeds the ${Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024))}MB limit`,
      'validation',
      413
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    throw new ProcessError('Request body must be multipart/form-data', 'validation', 400);
  }

  const file = formData.get('video');
  if (!(file instanceof File) || file.size === 0) {
    throw new ProcessError('A video file is required', 'validation', 400);
  }
  validateExtension(file);

  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new ProcessError(
      `Video file exceeds the ${Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024))}MB limit`,
      'validation',
      400
    );
  }

  const color = formData.get('subtitleColor');
  if (!isHexColor(color)) {
    throw new ProcessError('subtitleColor must be a hex color like #ffffff', 'validation', 400);
  }

  const highlightColor = formData.get('highlightColor');
  if (!isHexColor(highlightColor)) {
    throw new ProcessError('highlightColor must be a hex color like #ffff00', 'validation', 400);
  }

  const outlineColor = formData.get('outlineColor');
  if (!isHexColor(outlineColor)) {
    throw new ProcessError('outlineColor must be a hex color like #000000', 'validation', 400);
  }

  const subtitleSize = Number(formData.get('subtitleSize'));
  if (!Number.isFinite(subtitleSize) || subtitleSize < MIN_SUBTITLE_SIZE || subtitleSize > MAX_SUBTITLE_SIZE) {
    throw new ProcessError(
      `subtitleSize must be a number between ${MIN_SUBTITLE_SIZE} and ${MAX_SUBTITLE_SIZE}`,
      'validation',
      400
    );
  }

  const outlineWidth = Number(formData.get('outlineWidth'));
  if (!Number.isFinite(outlineWidth) || outlineWidth < MIN_OUTLINE_WIDTH || outlineWidth > MAX_OUTLINE_WIDTH) {
    throw new ProcessError(
      `outlineWidth must be a number between ${MIN_OUTLINE_WIDTH} and ${MAX_OUTLINE_WIDTH}`,
      'validation',
      400
    );
  }

  const shadowDepth = Number(formData.get('shadowDepth'));
  if (!Number.isFinite(shadowDepth) || shadowDepth < MIN_SHADOW_DEPTH || shadowDepth > MAX_SHADOW_DEPTH) {
    throw new ProcessError(
      `shadowDepth must be a number between ${MIN_SHADOW_DEPTH} and ${MAX_SHADOW_DEPTH}`,
      'validation',
      400
    );
  }

  const position = formData.get('position');
  if (typeof position !== 'string' || !SUBTITLE_POSITIONS.includes(position as SubtitlePosition)) {
    throw new ProcessError(`position must be one of: ${SUBTITLE_POSITIONS.join(', ')}`, 'validation', 400);
  }

  const font = formData.get('font');
  if (typeof font !== 'string' || !FONT_CHOICES.includes(font as FontChoice)) {
    throw new ProcessError(`font must be one of: ${FONT_CHOICES.join(', ')}`, 'validation', 400);
  }

  const duration = Number(formData.get('duration'));
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new ProcessError('duration is required and must be a positive number of seconds', 'validation', 400);
  }
  if (duration > MAX_DURATION_SECONDS) {
    throw new ProcessError(
      `Video exceeds the ${Math.round(MAX_DURATION_SECONDS / 60)}-minute limit`,
      'validation',
      400
    );
  }

  const aspectRatios = formData.getAll('aspectRatios');
  if (
    aspectRatios.length === 0 ||
    !aspectRatios.every((r): r is string => typeof r === 'string' && ASPECT_RATIOS.includes(r as AspectRatio))
  ) {
    throw new ProcessError(
      `aspectRatios must include at least one of: ${ASPECT_RATIOS.join(', ')}`,
      'validation',
      400
    );
  }

  return {
    file,
    style: {
      color,
      highlightColor,
      size: subtitleSize,
      position: position as SubtitlePosition,
      animation: DEFAULT_STYLE.animation,
      outlineWidth,
      shadowDepth,
      outlineColor,
      font: font as FontChoice,
    },
    aspectRatios: Array.from(new Set(aspectRatios as AspectRatio[])),
    duration,
  };
}

async function safeJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function transcribe(origin: string, file: File, clientIp: string): Promise<{ projectId: string }> {
  const formData = new FormData();
  formData.append('video', file);

  let res: Response;
  try {
    res = await fetch(`${origin}/api/transcribe`, {
      method: 'POST',
      headers: { 'x-forwarded-for': clientIp },
      body: formData,
    });
  } catch (err) {
    throw new ProcessError(
      `Could not reach the transcription service: ${err instanceof Error ? err.message : String(err)}`,
      'transcribe',
      502
    );
  }

  const data = await safeJson(res);
  if (!res.ok || !data || data.status !== 'success' || typeof data.projectId !== 'string') {
    const message = (data?.error as string | undefined) ?? `Transcription failed (${res.status})`;
    throw new ProcessError(message, 'transcribe', res.status >= 400 ? res.status : 502);
  }

  return { projectId: data.projectId };
}

async function render(
  origin: string,
  projectId: string,
  style: StyleSettings,
  aspectRatios: AspectRatio[],
  clientIp: string
): Promise<Videos> {
  let res: Response;
  try {
    res = await fetch(`${origin}/api/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': clientIp },
      body: JSON.stringify({ projectId, style, aspectRatios }),
    });
  } catch (err) {
    throw new ProcessError(
      `Could not reach the rendering service: ${err instanceof Error ? err.message : String(err)}`,
      'render',
      502
    );
  }

  const data = await safeJson(res);
  if (!res.ok || !data || data.status !== 'success') {
    const message = (data?.error as string | undefined) ?? `Rendering failed (${res.status})`;
    throw new ProcessError(message, 'render', res.status >= 400 ? res.status : 502);
  }

  const videos = (data as { videos?: unknown }).videos as Videos | undefined;
  if (!videos || !aspectRatios.every((r) => typeof videos[r] === 'string')) {
    throw new ProcessError('Rendering service returned an unexpected response', 'render', 502);
  }

  return videos;
}

export async function POST(request: NextRequest) {
  let parsed: ParsedRequest;
  try {
    parsed = await parseFormData(request);
  } catch (err) {
    const statusCode = err instanceof ProcessError ? err.statusCode : 400;
    const message = err instanceof Error ? err.message : 'Invalid request';
    return NextResponse.json({ status: 'error', error: message }, { status: statusCode });
  }

  const { file, style, aspectRatios, duration } = parsed;
  const origin = request.nextUrl.origin;
  const clientIp = getClientIp(request);

  try {
    const { projectId } = await transcribe(origin, file, clientIp);
    const videos = await render(origin, projectId, style, aspectRatios, clientIp);

    return NextResponse.json({ status: 'success', videos, duration });
  } catch (err) {
    const statusCode = err instanceof ProcessError ? err.statusCode : 500;
    const step = err instanceof ProcessError ? err.step : 'unknown';
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ status: 'error', step, error: message }, { status: statusCode });
  }
}

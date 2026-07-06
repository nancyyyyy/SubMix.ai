import { NextRequest, NextResponse } from 'next/server';
import {
  ASPECT_RATIOS,
  FONT_CHOICES,
  MAX_OUTLINE_WIDTH,
  MAX_SHADOW_DEPTH,
  MAX_SUBTITLE_SIZE,
  MIN_OUTLINE_WIDTH,
  MIN_SHADOW_DEPTH,
  MIN_SUBTITLE_SIZE,
  SUBTITLE_ANIMATIONS,
  SUBTITLE_POSITIONS,
  getProject,
  isHexColor,
  isValidCaptionSegments,
  updateProject,
  type AspectRatio,
  type CaptionSegment,
  type StyleSettings,
} from '@/lib/project';
import { renderProject, RenderError } from '@/lib/render';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

// child_process-based ffmpeg transcoding requires Node, not the Edge runtime.
export const runtime = 'nodejs';
export const maxDuration = 300;

function inRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function parseStyle(value: unknown): StyleSettings | null {
  const s = value as Record<string, unknown> | null;
  if (!s || typeof s !== 'object') return null;

  const { color, highlightColor, size, position, animation, outlineWidth, shadowDepth, outlineColor, font } = s;

  if (!isHexColor(color)) return null;
  if (!isHexColor(highlightColor)) return null;
  if (!isHexColor(outlineColor)) return null;
  if (!inRange(size, MIN_SUBTITLE_SIZE, MAX_SUBTITLE_SIZE)) return null;
  if (!inRange(outlineWidth, MIN_OUTLINE_WIDTH, MAX_OUTLINE_WIDTH)) return null;
  if (!inRange(shadowDepth, MIN_SHADOW_DEPTH, MAX_SHADOW_DEPTH)) return null;
  if (typeof position !== 'string' || !SUBTITLE_POSITIONS.includes(position as StyleSettings['position'])) {
    return null;
  }
  if (typeof animation !== 'string' || !SUBTITLE_ANIMATIONS.includes(animation as StyleSettings['animation'])) {
    return null;
  }
  if (typeof font !== 'string' || !FONT_CHOICES.includes(font as StyleSettings['font'])) {
    return null;
  }

  return {
    color,
    highlightColor,
    size,
    position,
    animation,
    outlineWidth,
    shadowDepth,
    outlineColor,
    font,
  } as StyleSettings;
}

export async function POST(request: NextRequest) {
  const rateLimit = checkRateLimit(`render:${getClientIp(request)}`);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { status: 'error', error: 'Too many requests, please try again later' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ status: 'error', error: 'Request body must be valid JSON' }, { status: 400 });
  }

  const { projectId, captions, style, aspectRatios } = (body ?? {}) as {
    projectId?: unknown;
    captions?: unknown;
    style?: unknown;
    aspectRatios?: unknown;
  };

  if (typeof projectId !== 'string' || projectId.trim().length === 0) {
    return NextResponse.json({ status: 'error', error: 'projectId is required' }, { status: 400 });
  }

  const parsedStyle = parseStyle(style);
  if (!parsedStyle) {
    return NextResponse.json(
      {
        status: 'error',
        error:
          'style must include valid color/highlightColor/outlineColor hex values, size, position, animation, ' +
          'outlineWidth, shadowDepth, and font',
      },
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

  // captions is optional: omit it to re-render unedited text, or pass the
  // full (possibly text-edited) segment list to use it instead. Either way
  // every word's start/end is taken as-is and never recalculated.
  let segments: CaptionSegment[];
  if (captions !== undefined) {
    if (!isValidCaptionSegments(captions)) {
      return NextResponse.json(
        { status: 'error', error: 'captions must be a non-empty array of segments with word-level timestamps' },
        { status: 400 }
      );
    }
    segments = captions;
  } else {
    const existing = await getProject(projectId);
    if (!existing) {
      return NextResponse.json({ status: 'error', error: `Project not found: ${projectId}` }, { status: 404 });
    }
    segments = existing.segments;
  }

  const project = await updateProject(projectId, {
    segments,
    style: parsedStyle,
    aspectRatios: aspectRatios as AspectRatio[],
  }).catch(() => null);

  if (!project) {
    return NextResponse.json({ status: 'error', error: `Project not found: ${projectId}` }, { status: 404 });
  }

  try {
    const videos = await renderProject({
      videoPath: project.videoPath,
      segments: project.segments,
      style: project.style,
      aspectRatios: project.aspectRatios,
    });

    return NextResponse.json({ status: 'success', videos });
  } catch (err) {
    const statusCode = err instanceof RenderError ? err.statusCode : 500;
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ status: 'error', error: message }, { status: statusCode });
  }
}

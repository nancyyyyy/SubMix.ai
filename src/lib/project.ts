import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { TranscriptSegment } from './transcript';

// A "project" is the persisted unit of work: the source video plus its
// caption data and render settings. Captions are edited freely and re-used
// across as many renders as the user wants; the source video and every
// word's start/end timestamp are set once at transcription time and never
// touched again, so editing text can never drift or cascade timing.

export interface CaptionWord {
  word: string;
  start: number;
  end: number;
}

export interface CaptionSegment {
  start: number;
  end: number;
  words: CaptionWord[];
}

// Base/highlight/outline colors are freeform hex (from the UI's color
// pickers) rather than a fixed enum, so validation is a format check instead
// of a membership check.
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value);
}

export const SUBTITLE_POSITIONS = ['top', 'center', 'bottom'] as const;
export type SubtitlePosition = (typeof SUBTITLE_POSITIONS)[number];

export const SUBTITLE_ANIMATIONS = ['none', 'word-highlight'] as const;
export type SubtitleAnimation = (typeof SUBTITLE_ANIMATIONS)[number];

// Each entry must have a matching bundled font file registered in
// FONT_FILES (src/lib/render.ts).
export const FONT_CHOICES = ['sans', 'rounded', 'condensed', 'mono'] as const;
export type FontChoice = (typeof FONT_CHOICES)[number];

export const ASPECT_RATIOS = ['9:16', '1:1', '16:9'] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export const MIN_SUBTITLE_SIZE = 20;
export const MAX_SUBTITLE_SIZE = 60;

export const MIN_OUTLINE_WIDTH = 0;
export const MAX_OUTLINE_WIDTH = 4;

export const MIN_SHADOW_DEPTH = 0;
export const MAX_SHADOW_DEPTH = 4;

export interface StyleSettings {
  color: string;
  highlightColor: string;
  size: number;
  position: SubtitlePosition;
  animation: SubtitleAnimation;
  outlineWidth: number;
  shadowDepth: number;
  outlineColor: string;
  font: FontChoice;
}

// Outline defaults to a readable 2px black regardless of base/highlight
// color, so captions stay legible over any background before the user
// touches outline controls at all.
export const DEFAULT_STYLE: StyleSettings = {
  color: '#ffffff',
  highlightColor: '#ffff00',
  size: 40,
  position: 'bottom',
  animation: 'word-highlight',
  outlineWidth: 2,
  shadowDepth: 0,
  outlineColor: '#000000',
  font: 'sans',
};

export const DEFAULT_ASPECT_RATIOS: AspectRatio[] = ['9:16', '1:1', '16:9'];

export interface Project {
  id: string;
  videoPath: string;
  createdAt: string;
  updatedAt: string;
  segments: CaptionSegment[];
  style: StyleSettings;
  aspectRatios: AspectRatio[];
}

// MVP persistence: one JSON file per project next to its source video.
// Swap for a real database later without changing this module's API.
const PROJECTS_DIR = path.join('/tmp', 'projects');

function projectDir(id: string): string {
  return path.join(PROJECTS_DIR, id);
}

function projectMetaPath(id: string): string {
  return path.join(projectDir(id), 'project.json');
}

export function toCaptionSegments(segments: TranscriptSegment[]): CaptionSegment[] {
  return segments.map((segment) => ({
    start: segment.start,
    end: segment.end,
    words: segment.words.map((word) => ({ word: word.word, start: word.start, end: word.end })),
  }));
}

export async function createProject(params: {
  videoBuffer: Buffer;
  videoExtension: string;
  segments: CaptionSegment[];
}): Promise<Project> {
  const id = crypto.randomUUID();
  const dir = projectDir(id);
  await fs.mkdir(dir, { recursive: true });

  const videoPath = path.join(dir, `source${params.videoExtension}`);
  await fs.writeFile(videoPath, params.videoBuffer);

  const now = new Date().toISOString();
  const project: Project = {
    id,
    videoPath,
    createdAt: now,
    updatedAt: now,
    segments: params.segments,
    style: DEFAULT_STYLE,
    aspectRatios: DEFAULT_ASPECT_RATIOS,
  };

  await fs.writeFile(projectMetaPath(id), JSON.stringify(project, null, 2), 'utf8');
  return project;
}

export async function getProject(id: string): Promise<Project | null> {
  try {
    const raw = await fs.readFile(projectMetaPath(id), 'utf8');
    return JSON.parse(raw) as Project;
  } catch {
    return null;
  }
}

export async function updateProject(
  id: string,
  patch: Partial<Pick<Project, 'segments' | 'style' | 'aspectRatios'>>
): Promise<Project> {
  const existing = await getProject(id);
  if (!existing) {
    throw new Error(`Project not found: ${id}`);
  }

  const updated: Project = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  await fs.writeFile(projectMetaPath(id), JSON.stringify(updated, null, 2), 'utf8');
  return updated;
}

export function isValidCaptionSegments(value: unknown): value is CaptionSegment[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((seg) => {
      const s = seg as Record<string, unknown>;
      return (
        typeof s.start === 'number' &&
        typeof s.end === 'number' &&
        Array.isArray(s.words) &&
        s.words.length > 0 &&
        s.words.every((w: unknown) => {
          const word = w as Record<string, unknown>;
          return typeof word.word === 'string' && typeof word.start === 'number' && typeof word.end === 'number';
        })
      );
    })
  );
}

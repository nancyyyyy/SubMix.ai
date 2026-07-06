import { promises as fs, existsSync } from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStaticPath from 'ffmpeg-static';
import { DEFAULT_STYLE } from './project';
import type { AspectRatio, CaptionSegment, CaptionWord, FontChoice, StyleSettings } from './project';

if (ffmpegStaticPath) {
  ffmpeg.setFfmpegPath(ffmpegStaticPath);
}

export const OUTPUT_DIR = path.join(os.tmpdir(), 'output');

// ffmpeg-static ships no fonts and the host OS can't be relied on to have
// any particular family installed, so the 4 curated caption fonts are
// bundled directly in the repo and always resolved from here. The ASS "ass"
// filter matches fonts by family name via fontconfig/fontsdir rather than by
// file path, so each entry also records the family name embedded in that
// font file's `name` table (verified with a one-off script, not guessed from
// the filename) that must appear in the ASS Style line.
const FONTS_DIR = path.join(process.cwd(), 'assets', 'fonts');

const FONT_FILES: Record<FontChoice, { file: string; family: string }> = {
  sans: { file: 'Barlow-Bold.ttf', family: 'Barlow' },
  rounded: { file: 'VarelaRound-Regular.ttf', family: 'Varela Round' },
  condensed: { file: 'Anton-Regular.ttf', family: 'Anton' },
  mono: { file: 'SpaceMono-Bold.ttf', family: 'Space Mono' },
};

interface VideoVariant {
  name: 'vertical' | 'square' | 'horizontal';
  ratio: AspectRatio;
  width: number;
  height: number;
  baseFilters: string[];
}

const VARIANTS: VideoVariant[] = [
  {
    name: 'vertical',
    ratio: '9:16',
    width: 1080,
    height: 1920,
    baseFilters: ['scale=1080:1920:force_original_aspect_ratio=decrease', 'pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black'],
  },
  {
    name: 'square',
    ratio: '1:1',
    width: 1080,
    height: 1080,
    baseFilters: ['scale=1080:1080:force_original_aspect_ratio=increase', 'crop=1080:1080'],
  },
  {
    name: 'horizontal',
    ratio: '16:9',
    width: 1920,
    height: 1080,
    baseFilters: ['scale=1920:1080:force_original_aspect_ratio=decrease', 'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black'],
  },
];

// Font size and vertical margin as fractions of each variant's own height,
// so captions are positioned/sized relative to the actual output canvas
// instead of one absolute pixel value blindly reused across resolutions.
// All three sit in the lower third, but the fractions differ per orientation:
// vertical is read on a small screen at arm's length and needs proportionally
// larger text; square gets the same lower-third band at a medium size; and
// horizontal has far more width per line and is typically viewed at a
// greater distance, so text can be relatively smaller with a tighter margin
// off the bottom edge.
interface CaptionLayout {
  fontSizeRatio: number;
  marginVRatio: number;
}

const CAPTION_LAYOUTS: Record<VideoVariant['name'], CaptionLayout> = {
  vertical: { fontSizeRatio: 0.052, marginVRatio: 0.12 },
  square: { fontSizeRatio: 0.045, marginVRatio: 0.12 },
  horizontal: { fontSizeRatio: 0.035, marginVRatio: 0.06 },
};

export class RenderError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

function resolveFont(choice: FontChoice): { path: string; family: string } {
  const entry = FONT_FILES[choice];
  const fontPath = path.join(FONTS_DIR, entry.file);
  if (!existsSync(fontPath)) {
    throw new RenderError(`Bundled font file is missing from the server: ${entry.file}`, 500);
  }
  return { path: fontPath, family: entry.family };
}

// Colors arrive as '#RRGGBB' hex from the UI's color pickers.
function toAssColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const toHex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
  // ASS colors are &HAABBGGRR& (alpha, then BGR byte order).
  return `&H00${toHex(b)}${toHex(g)}${toHex(r)}&`;
}

function formatAssTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const cs = Math.round((clamped - Math.floor(clamped)) * 100);
  const pad2 = (n: number) => n.toString().padStart(2, '0');
  return `${h}:${pad2(m)}:${pad2(s)}.${pad2(cs)}`;
}

function escapeAssText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}');
}

// No canvas/font-metrics library is available server-side, so line wrapping
// uses a rough average-character-width heuristic instead of measuring the
// real font. It's conservative enough in practice to keep lines within the
// target width for a bold sans-serif face at typical caption sizes. The
// estimate only decides *where* between words to break -- wrapWordsToLines
// never inspects a word's characters -- so estimation error can only shift a
// break to a different word boundary, never split one.
const AVG_CHAR_WIDTH_RATIO = 0.55;
const SPACE_WIDTH_RATIO = 0.28;

function estimateWordWidthPx(word: string, fontSize: number): number {
  return word.length * fontSize * AVG_CHAR_WIDTH_RATIO;
}

// Greedily packs whole words onto each line; a word is the smallest unit
// ever moved, so a break can only land in the gap between two words, never
// inside one. A word placed first on a line is always kept there even if it
// alone exceeds maxWidthPx (a very long word at a large font size) -- that
// line is left to overflow slightly rather than breaking the word.
function wrapWordsToLines(words: CaptionWord[], maxWidthPx: number, fontSize: number): CaptionWord[][] {
  const spaceWidth = fontSize * SPACE_WIDTH_RATIO;
  const lines: CaptionWord[][] = [];
  let currentLine: CaptionWord[] = [];
  let currentWidth = 0;

  for (const word of words) {
    const wordWidth = estimateWordWidthPx(word.word, fontSize);
    const isFirstOnLine = currentLine.length === 0;
    const additional = isFirstOnLine ? wordWidth : spaceWidth + wordWidth;
    const fitsOnCurrentLine = isFirstOnLine || currentWidth + additional <= maxWidthPx;

    if (fitsOnCurrentLine) {
      currentLine.push(word);
      currentWidth += additional;
    } else {
      lines.push(currentLine);
      currentLine = [word];
      currentWidth = wordWidth;
    }
  }
  if (currentLine.length > 0) lines.push(currentLine);

  return lines;
}

function buildLineText(
  lines: CaptionWord[][],
  activeWord: CaptionWord | null,
  highlightHex: string,
  baseHex: string
): string {
  return lines
    .map((line) =>
      line
        .map((word) => {
          const escaped = escapeAssText(word.word);
          return word === activeWord ? `{\\1c${highlightHex}}${escaped}{\\1c${baseHex}}` : escaped;
        })
        .join(' ')
    )
    .join('\\N');
}

// word-highlight: one Dialogue event per word, current word highlighted via
// a plain color override (not native \k karaoke, whose fill is cumulative
// for the whole line and would keep every prior word lit instead of
// reverting). Each word's active window runs until the next word starts (or
// segment end for the last word), so the full line stays on screen with no
// gaps.
function buildHighlightDialogues(
  segment: CaptionSegment,
  lines: CaptionWord[][],
  words: CaptionWord[],
  baseHex: string,
  highlightHex: string,
  marginX: number,
  marginV: number,
  alignment: number
): string[] {
  const dialogues: string[] = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const start = i === 0 ? segment.start : Math.max(word.start, segment.start);
    const rawEnd = i < words.length - 1 ? words[i + 1].start : segment.end;
    const end = Math.max(rawEnd, start + 0.05);

    const text = buildLineText(lines, word, highlightHex, baseHex);
    dialogues.push(
      `Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},Default,,${marginX},${marginX},${marginV},,${text}`
    );
  }

  return dialogues;
}

// none: a single static Dialogue event for the whole segment, no per-word
// highlighting.
function buildStaticDialogue(
  segment: CaptionSegment,
  lines: CaptionWord[][],
  baseHex: string,
  marginX: number,
  marginV: number
): string[] {
  const text = buildLineText(lines, null, baseHex, baseHex);
  return [
    `Dialogue: 0,${formatAssTime(segment.start)},${formatAssTime(segment.end)},Default,,${marginX},${marginX},${marginV},,${text}`,
  ];
}

function buildSegmentDialogues(
  segment: CaptionSegment,
  maxWidthPx: number,
  fontSize: number,
  baseHex: string,
  highlightHex: string,
  marginX: number,
  marginV: number,
  alignment: number,
  animation: StyleSettings['animation']
): string[] {
  const words = segment.words.filter((w) => w.word.length > 0);
  if (words.length === 0) return [];

  const lines = wrapWordsToLines(words, maxWidthPx, fontSize);

  if (animation === 'none') {
    return buildStaticDialogue(segment, lines, baseHex, marginX, marginV);
  }
  return buildHighlightDialogues(segment, lines, words, baseHex, highlightHex, marginX, marginV, alignment);
}

// ASS numpad alignment: 2 = bottom-center, 5 = middle-center, 8 = top-center.
const ALIGNMENT_BY_POSITION: Record<StyleSettings['position'], number> = {
  bottom: 2,
  center: 5,
  top: 8,
};

function buildAssContent(
  segments: CaptionSegment[],
  opts: {
    width: number;
    height: number;
    fontFamily: string;
    layout: CaptionLayout;
    sizeScale: number;
    baseColor: string;
    highlightColor: string;
    outlineColor: string;
    outlineWidth: number;
    shadowDepth: number;
    position: StyleSettings['position'];
    animation: StyleSettings['animation'];
  }
): string {
  const {
    width,
    height,
    fontFamily,
    layout,
    sizeScale,
    baseColor,
    highlightColor,
    outlineColor,
    outlineWidth,
    shadowDepth,
    position,
    animation,
  } = opts;

  // Font size and vertical margin scale off this variant's own height (see
  // CAPTION_LAYOUTS); sizeScale applies the user's size preference as a
  // multiplier on that proportional baseline rather than an absolute value.
  // 5% horizontal padding keeps text off the side edges; wrapping targets
  // the remaining 90% of width. Centered captions ignore vertical margin
  // (libass centers regardless).
  const fontSize = Math.max(12, Math.round(height * layout.fontSizeRatio * sizeScale));
  const marginX = Math.round(width * 0.05);
  const marginV = position === 'center' ? 0 : Math.round(height * layout.marginVRatio);
  const maxWidthPx = width * 0.9;
  const alignment = ALIGNMENT_BY_POSITION[position];

  const baseHex = toAssColor(baseColor);
  const highlightHex = toAssColor(highlightColor);
  const outlineHex = toAssColor(outlineColor);

  const dialogues = segments.flatMap((segment) =>
    buildSegmentDialogues(segment, maxWidthPx, fontSize, baseHex, highlightHex, marginX, marginV, alignment, animation)
  );

  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    // WrapStyle 2 disables libass's own auto-wrap/reflow so it respects the
    // \N breaks we already computed via wrapWordsToLines() instead of
    // re-wrapping (and possibly re-flowing) the line itself.
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${fontFamily},${fontSize},${baseHex},${baseHex},${outlineHex},${outlineHex},0,0,0,0,100,100,0,0,1,${outlineWidth},${shadowDepth},${alignment},${marginX},${marginX},${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...dialogues,
  ].join('\n');
}

// The ffmpeg filtergraph parser treats ":" as an option separator and "\" as
// an escape character, so a raw Windows path like C:\foo\bar.ass breaks
// parsing. Converting backslashes to slashes and escaping the drive-letter
// colon, then wrapping the whole value in single quotes, is the standard
// workaround documented for the subtitles/ass filters.
function escapeFfmpegFilterPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/:/g, '\\:');
}

function buildAssFilter(assPath: string, fontsDir: string): string {
  const filename = escapeFfmpegFilterPath(assPath);
  const dir = escapeFfmpegFilterPath(fontsDir);
  return `ass=filename='${filename}':fontsdir='${dir}'`;
}

function runFfmpeg(inputPath: string, outputPath: string, filters: string[], variantName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoFilters(filters)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions(['-preset veryfast', '-movflags +faststart'])
      .on('error', (err, _stdout, stderr) => {
        // fluent-ffmpeg's own err.message is just the exit code plus the last
        // stderr line (often the generic "Conversion failed!"), which hides
        // the actual ffmpeg/libx264 error. stderr here is the full captured
        // output, so surface its tail instead.
        const detail = stderr
          ?.split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(-5)
          .join(' | ');
        reject(new RenderError(`FFmpeg failed for ${variantName}: ${detail || err.message}`, 500));
      })
      .on('end', () => resolve())
      .save(outputPath);
  });
}

// Stage 2: burns the given caption text at its original timestamps into the
// source video, once per requested aspect ratio. Never touches word/segment
// timing — only reads it — so it can be re-run any number of times after
// text edits or style changes without re-transcribing.
export async function renderProject(params: {
  videoPath: string;
  segments: CaptionSegment[];
  style: StyleSettings;
  aspectRatios: AspectRatio[];
}): Promise<Partial<Record<AspectRatio, string>>> {
  const { videoPath, segments, style, aspectRatios } = params;
  const selectedVariants = VARIANTS.filter((v) => aspectRatios.includes(v.ratio));

  await fs.access(videoPath).catch(() => {
    throw new RenderError(`videoPath does not exist: ${videoPath}`, 400);
  });

  const fontFile = resolveFont(style.font);
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const jobId = crypto.randomUUID();
  const results: Partial<Record<AspectRatio, string>> = {};
  const producedPaths: string[] = [];

  // The user's size slider is a multiplier on each variant's proportional
  // baseline (see CAPTION_LAYOUTS), not an absolute pixel value, so it stays
  // meaningful across resolutions instead of being applied identically.
  const sizeScale = style.size / DEFAULT_STYLE.size;

  try {
    for (const variant of selectedVariants) {
      const filename = `${jobId}-${variant.name}.mp4`;
      const outputPath = path.join(OUTPUT_DIR, filename);
      const assPath = path.join(OUTPUT_DIR, `${jobId}-${variant.name}.ass`);

      const assContent = buildAssContent(segments, {
        width: variant.width,
        height: variant.height,
        fontFamily: fontFile.family,
        layout: CAPTION_LAYOUTS[variant.name],
        sizeScale,
        baseColor: style.color,
        highlightColor: style.highlightColor,
        outlineColor: style.outlineColor,
        outlineWidth: style.outlineWidth,
        shadowDepth: style.shadowDepth,
        position: style.position,
        animation: style.animation,
      });
      await fs.writeFile(assPath, assContent, 'utf8');

      const filters = [...variant.baseFilters, buildAssFilter(assPath, FONTS_DIR)];

      try {
        await runFfmpeg(videoPath, outputPath, filters, variant.name);
      } finally {
        await fs.rm(assPath, { force: true }).catch(() => {});
      }

      producedPaths.push(outputPath);
      results[variant.ratio] = `/api/videos/${filename}`;
    }

    return results;
  } catch (err) {
    await Promise.all(producedPaths.map((p) => fs.rm(p, { force: true }).catch(() => {})));
    throw err;
  }
}

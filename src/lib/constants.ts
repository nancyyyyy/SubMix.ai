import type { FontChoice, StyleSettings, SubtitlePosition } from './project';

// project.ts pulls in Node's fs/path/crypto for on-disk persistence, so only
// its types are safe to import into client components; a value import would
// bundle those Node built-ins into the browser bundle. This mirrors
// project.ts's own DEFAULT_STYLE for the client's initial form state.
export const DEFAULT_CAPTION_STYLE: StyleSettings = {
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

// Base/highlight/outline colors are freeform hex, picked via <ColorPicker>;
// these are just quick-access presets, not an exhaustive enum.
export type HexColor = string;

export const BASE_COLOR_PRESETS: HexColor[] = ['#ffffff', '#ffff00', '#39ff14', '#ff5c5c', '#5cc8ff', '#000000'];
export const HIGHLIGHT_COLOR_PRESETS: HexColor[] = ['#ffff00', '#39ff14', '#ff5c5c', '#5cc8ff', '#ffffff'];
export const OUTLINE_COLOR_PRESETS: HexColor[] = ['#000000', '#ffffff', '#39ff14'];

export const MIN_SUBTITLE_SIZE = 20;
export const MAX_SUBTITLE_SIZE = 60;

export const MIN_OUTLINE_WIDTH = 0;
export const MAX_OUTLINE_WIDTH = 4;

export const MIN_SHADOW_DEPTH = 0;
export const MAX_SHADOW_DEPTH = 4;

// cssFamily previews the bundled font (via the CSS variables next/font
// registers in captionFonts.ts) so the live preview matches what actually
// gets burned into the video.
export const FONT_OPTIONS: { value: FontChoice; label: string; cssFamily: string }[] = [
  { value: 'sans', label: 'Bold Sans (Default)', cssFamily: 'var(--font-caption-sans)' },
  { value: 'rounded', label: 'Rounded', cssFamily: 'var(--font-caption-rounded)' },
  { value: 'condensed', label: 'Condensed / Impact', cssFamily: 'var(--font-caption-condensed)' },
  { value: 'mono', label: 'Monospace', cssFamily: 'var(--font-caption-mono)' },
];

export const POSITION_OPTIONS: { value: SubtitlePosition; label: string }[] = [
  { value: 'top', label: 'Top' },
  { value: 'center', label: 'Center' },
  { value: 'bottom', label: 'Bottom' },
];

export const RATIOS = [
  {
    key: '9:16',
    label: 'Vertical',
    sublabel: 'TikTok / Reels / Shorts',
    aspectCss: '9 / 16',
  },
  {
    key: '1:1',
    label: 'Square',
    sublabel: 'Instagram Feed',
    aspectCss: '1 / 1',
  },
  {
    key: '16:9',
    label: 'Horizontal',
    sublabel: 'YouTube / LinkedIn',
    aspectCss: '16 / 9',
  },
] as const;
export type RatioKey = (typeof RATIOS)[number]['key'];

export type Stage = 'idle' | 'uploading' | 'transcribing' | 'editing' | 'rendering' | 'done' | 'error';

export type Videos = Partial<Record<RatioKey, string>>;

// Stage 1 (upload + transcribe) and Stage 2 (render) run as separate calls
// now, so each gets its own short step list for the loading UI instead of
// one list spanning both.
export const TRANSCRIBE_STEPS: { stage: Stage; label: string }[] = [
  { stage: 'uploading', label: 'Uploading video...' },
  { stage: 'transcribing', label: 'Transcribing audio...' },
];

export const RENDER_STEPS: { stage: Stage; label: string }[] = [
  { stage: 'rendering', label: 'Rendering clips...' },
];

export const ACCEPTED_VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm'];
export const ACCEPTED_VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
export const MAX_VIDEO_FILE_SIZE_BYTES = 500 * 1024 * 1024;
export const MAX_VIDEO_DURATION_SECONDS = 10 * 60;

export const WAVEFORM_HEIGHTS = [
  6, 14, 9, 20, 12, 24, 10, 18, 7, 16, 22, 11, 15, 8, 19, 13, 6, 17, 10, 21, 9, 14, 7, 12,
];

// Shared style tokens
export const PANEL = 'border border-white/10 bg-panel p-4 shadow-[0_8px_24px_rgba(0,0,0,0.35)] sm:p-6';
export const SECTION_LABEL = 'mb-5 font-display text-xl font-semibold uppercase tracking-tight text-primary';
export const FIELD_LABEL = 'mb-2 block text-sm text-muted';
export const BUTTON_PRIMARY =
  'w-full border border-green bg-green px-4 py-3 font-display text-lg font-semibold uppercase tracking-tight text-[#0C0E10] transition-colors hover:bg-green/90 disabled:cursor-not-allowed disabled:opacity-40';

import localFont from 'next/font/local';

// Same 4 TTF files bundled at assets/fonts/ for the server-side ffmpeg ass
// filter (see FONT_FILES in render.ts) are self-hosted here via next/font
// so the live preview can render the actual chosen face instead of an
// approximate system-font stand-in.
export const captionFontSans = localFont({
  src: '../../assets/fonts/Barlow-Bold.ttf',
  variable: '--font-caption-sans',
  display: 'swap',
});

export const captionFontRounded = localFont({
  src: '../../assets/fonts/VarelaRound-Regular.ttf',
  variable: '--font-caption-rounded',
  display: 'swap',
});

export const captionFontCondensed = localFont({
  src: '../../assets/fonts/Anton-Regular.ttf',
  variable: '--font-caption-condensed',
  display: 'swap',
});

export const captionFontMono = localFont({
  src: '../../assets/fonts/SpaceMono-Bold.ttf',
  variable: '--font-caption-mono',
  display: 'swap',
});

export const CAPTION_FONT_VARIABLES = [
  captionFontSans.variable,
  captionFontRounded.variable,
  captionFontCondensed.variable,
  captionFontMono.variable,
].join(' ');

import type { RatioKey } from '@/lib/constants';

const RATIO_ICON_RECT: Record<RatioKey, { w: number; h: number }> = {
  '9:16': { w: 13, h: 23 },
  '1:1': { w: 19, h: 19 },
  '16:9': { w: 26, h: 14.6 },
};

export function FormatIcon({ ratio, active }: { ratio: RatioKey; active: boolean }) {
  const { w, h } = RATIO_ICON_RECT[ratio];
  const stroke = active ? 'var(--color-green)' : 'var(--color-muted)';

  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden className="shrink-0">
      <rect x={(32 - w) / 2} y={(32 - h) / 2} width={w} height={h} rx="2" stroke={stroke} strokeWidth="2" />
      <path d="M13.5 12.5L19 16L13.5 19.5Z" fill={stroke} />
    </svg>
  );
}

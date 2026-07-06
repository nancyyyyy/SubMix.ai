'use client';

import { FormatIcon } from './FormatIcon';
import { PANEL, RATIOS, SECTION_LABEL, type RatioKey } from '@/lib/constants';

interface FormatsSectionProps {
  selectedRatios: Set<RatioKey>;
  onToggle: (key: RatioKey) => void;
}

export function FormatsSection({ selectedRatios, onToggle }: FormatsSectionProps) {
  return (
    <div className={PANEL}>
      <span className={SECTION_LABEL}>Choose formats</span>
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {RATIOS.map(({ key, label, sublabel }) => {
          const selected = selectedRatios.has(key);
          return (
            <label key={key} className="cursor-pointer">
              <input type="checkbox" checked={selected} onChange={() => onToggle(key)} className="peer sr-only" />
              <div
                className={`flex flex-col items-center gap-2 border p-3 text-center transition-colors peer-focus-visible:ring-1 peer-focus-visible:ring-green sm:gap-3 sm:p-4 ${
                  selected ? 'border-green bg-green/5' : 'border-white/10 hover:border-white/20'
                }`}
              >
                <FormatIcon ratio={key} active={selected} />
                <span className={`font-mono text-xs ${selected ? 'text-primary' : 'text-muted'}`}>{key}</span>
                <span className="text-[11px] leading-tight text-muted">
                  {label}
                  <br />
                  {sublabel}
                </span>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

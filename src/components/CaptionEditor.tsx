'use client';

import { PANEL, SECTION_LABEL } from '@/lib/constants';
import type { CaptionSegment } from '@/lib/project';

interface CaptionEditorProps {
  segments: CaptionSegment[];
  onWordEdit: (segmentIndex: number, wordIndex: number, newText: string) => void;
  disabled?: boolean;
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(2).padStart(5, '0');
  return `${m}:${s}`;
}

// Each row edits exactly one word's text. Every timestamp shown is read-only
// and copied straight from the original transcription — editing a word never
// recalculates anyone's timing, so there's no cascade to worry about.
export function CaptionEditor({ segments, onWordEdit, disabled }: CaptionEditorProps) {
  return (
    <div className={PANEL}>
      <span className={SECTION_LABEL}>Edit captions</span>

      <div className="flex max-h-[480px] flex-col gap-4 overflow-y-auto pr-2">
        {segments.map((segment, si) => (
          <div key={si} className="flex flex-col gap-1.5">
            {segment.words.map((word, wi) => (
              <div key={wi} className="flex items-center gap-3">
                <span className="w-24 shrink-0 font-mono text-xs text-muted">
                  {formatTimestamp(word.start)}–{formatTimestamp(word.end)}
                </span>
                <input
                  type="text"
                  value={word.word}
                  onChange={(e) => onWordEdit(si, wi, e.target.value)}
                  disabled={disabled}
                  className="w-full min-w-0 border border-white/10 bg-base px-2 py-1.5 text-sm text-primary focus:border-green focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

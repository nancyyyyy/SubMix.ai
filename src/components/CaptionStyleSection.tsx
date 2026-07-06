'use client';

import { ColorPicker } from './ColorPicker';
import { CustomSelect } from './CustomSelect';
import {
  BASE_COLOR_PRESETS,
  FIELD_LABEL,
  FONT_OPTIONS,
  HIGHLIGHT_COLOR_PRESETS,
  MAX_OUTLINE_WIDTH,
  MAX_SHADOW_DEPTH,
  MAX_SUBTITLE_SIZE,
  MIN_OUTLINE_WIDTH,
  MIN_SHADOW_DEPTH,
  MIN_SUBTITLE_SIZE,
  OUTLINE_COLOR_PRESETS,
  PANEL,
  POSITION_OPTIONS,
  SECTION_LABEL,
} from '@/lib/constants';
import type { StyleSettings } from '@/lib/project';

interface CaptionStyleSectionProps {
  style: StyleSettings;
  onStyleChange: (patch: Partial<StyleSettings>) => void;
}

const FONT_SELECT_OPTIONS = FONT_OPTIONS.map(({ value, label }) => ({ value, label }));

export function CaptionStyleSection({ style, onStyleChange }: CaptionStyleSectionProps) {
  return (
    <div className={PANEL}>
      <span className={SECTION_LABEL}>Caption style</span>

      <div className="grid grid-cols-2 gap-4">
        <ColorPicker
          label="Text color"
          value={style.color}
          presets={BASE_COLOR_PRESETS}
          onChange={(color) => onStyleChange({ color })}
        />
        <ColorPicker
          label="Highlight color"
          value={style.highlightColor}
          presets={HIGHLIGHT_COLOR_PRESETS}
          onChange={(highlightColor) => onStyleChange({ highlightColor })}
        />
      </div>

      <div className="mt-4">
        <label htmlFor="subtitleSize" className={FIELD_LABEL}>
          Subtitle size <span className="font-mono text-green">{style.size}</span>
        </label>
        <input
          id="subtitleSize"
          type="range"
          min={MIN_SUBTITLE_SIZE}
          max={MAX_SUBTITLE_SIZE}
          value={style.size}
          onChange={(e) => onStyleChange({ size: Number(e.target.value) })}
          className="w-full accent-[var(--color-green)]"
        />
      </div>

      <div className="mt-4">
        <label htmlFor="fontChoice" className={FIELD_LABEL}>
          Font
        </label>
        <CustomSelect
          id="fontChoice"
          value={style.font}
          options={FONT_SELECT_OPTIONS}
          onChange={(font) => onStyleChange({ font })}
        />
      </div>

      <div className="mt-4">
        <span className={FIELD_LABEL}>Position</span>
        <div className="grid grid-cols-3 gap-2">
          {POSITION_OPTIONS.map(({ value, label }) => {
            const selected = style.position === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => onStyleChange({ position: value })}
                className={`border px-3 py-2 text-center text-sm transition-colors ${
                  selected ? 'border-green bg-green/5 text-green' : 'border-white/10 text-muted hover:border-white/20'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="outlineWidth" className={FIELD_LABEL}>
            Outline width <span className="font-mono text-green">{style.outlineWidth}px</span>
          </label>
          <input
            id="outlineWidth"
            type="range"
            min={MIN_OUTLINE_WIDTH}
            max={MAX_OUTLINE_WIDTH}
            step={1}
            value={style.outlineWidth}
            onChange={(e) => onStyleChange({ outlineWidth: Number(e.target.value) })}
            className="w-full accent-[var(--color-green)]"
          />
        </div>
        <div>
          <label htmlFor="shadowDepth" className={FIELD_LABEL}>
            Shadow depth <span className="font-mono text-green">{style.shadowDepth}px</span>
          </label>
          <input
            id="shadowDepth"
            type="range"
            min={MIN_SHADOW_DEPTH}
            max={MAX_SHADOW_DEPTH}
            step={1}
            value={style.shadowDepth}
            onChange={(e) => onStyleChange({ shadowDepth: Number(e.target.value) })}
            className="w-full accent-[var(--color-green)]"
          />
        </div>
      </div>

      <div className="mt-4">
        <ColorPicker
          label="Outline color"
          value={style.outlineColor}
          presets={OUTLINE_COLOR_PRESETS}
          onChange={(outlineColor) => onStyleChange({ outlineColor })}
        />
      </div>
    </div>
  );
}

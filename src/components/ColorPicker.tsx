'use client';

import { useEffect, useId, useState } from 'react';
import { FIELD_LABEL } from '@/lib/constants';

interface ColorPickerProps {
  id?: string;
  label: string;
  value: string;
  presets: string[];
  onChange: (hex: string) => void;
}

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

// Hex text input (validated on blur so partial typing isn't rejected
// mid-keystroke) + a native color-wheel swatch for freeform picking + preset
// swatches for one-click common choices.
export function ColorPicker({ id, label, value, presets, onChange }: ColorPickerProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  function commitDraft() {
    if (HEX_PATTERN.test(draft)) {
      onChange(draft.toLowerCase());
    } else {
      setDraft(value);
    }
  }

  return (
    <div>
      <label htmlFor={inputId} className={FIELD_LABEL}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} swatch picker`}
          value={HEX_PATTERN.test(draft) ? draft : value}
          onChange={(e) => {
            setDraft(e.target.value);
            onChange(e.target.value);
          }}
          className="h-9 w-9 shrink-0 cursor-pointer border border-white/10 bg-transparent p-0"
        />
        <input
          id={inputId}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          placeholder="#ffffff"
          spellCheck={false}
          className="w-full border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-primary transition-colors hover:border-white/20 focus:border-green focus:outline-none focus:ring-1 focus:ring-green"
        />
      </div>
      <div className="mt-2 flex gap-2.5">
        {presets.map((preset) => {
          const selected = preset.toLowerCase() === value.toLowerCase();
          return (
            <button
              key={preset}
              type="button"
              aria-label={`Use ${preset}`}
              aria-pressed={selected}
              onClick={() => onChange(preset)}
              className={`h-7 w-7 shrink-0 rounded-full border transition-transform hover:scale-110 ${
                selected ? 'border-green ring-1 ring-green' : 'border-white/20'
              }`}
              style={{ backgroundColor: preset }}
            />
          );
        })}
      </div>
    </div>
  );
}

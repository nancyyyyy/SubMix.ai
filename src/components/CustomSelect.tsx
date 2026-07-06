'use client';

import { useEffect, useRef, useState } from 'react';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  swatch?: string;
}

interface CustomSelectProps<T extends string> {
  id?: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
}

export function CustomSelect<T extends string>({ id, value, options, onChange }: CustomSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        id={id}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 border border-white/10 bg-black/30 px-3 py-2 text-left text-sm text-primary transition-colors hover:border-white/20 focus:border-green focus:outline-none focus:ring-1 focus:ring-green"
      >
        <span className="flex items-center gap-2">
          {current.swatch && (
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/20"
              style={{ backgroundColor: current.swatch }}
              aria-hidden
            />
          )}
          {current.label}
        </span>
        <svg
          width="10"
          height="6"
          viewBox="0 0 10 6"
          fill="none"
          aria-hidden
          className={`shrink-0 text-muted transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        >
          <path
            d="M1 1L5 5L9 1"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 w-full border border-white/10 bg-panel py-1 shadow-[0_12px_28px_rgba(0,0,0,0.5)]"
        >
          {options.map((opt) => {
            const selected = opt.value === value;
            return (
              <li key={opt.value} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                    selected ? 'bg-green/10 text-green' : 'text-primary hover:bg-white/5'
                  }`}
                >
                  {opt.swatch && (
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/20"
                      style={{ backgroundColor: opt.swatch }}
                      aria-hidden
                    />
                  )}
                  {opt.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

'use client';

import { useCallback, useRef, useState } from 'react';
import {
  ACCEPTED_VIDEO_EXTENSIONS,
  ACCEPTED_VIDEO_MIME_TYPES,
  MAX_VIDEO_DURATION_SECONDS,
  MAX_VIDEO_FILE_SIZE_BYTES,
} from '@/lib/constants';

interface UploadZoneProps {
  file: File | null;
  duration: number | null;
  error: string | null;
  onSelect: (file: File, duration: number) => void;
  onError: (message: string) => void;
  onClear: () => void;
  disabled?: boolean;
}

function formatFileSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1000 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    const url = URL.createObjectURL(file);
    video.src = url;
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(video.duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read video metadata. The file may be corrupt or unsupported.'));
    };
  });
}

export function UploadZone({ file, duration, error, onSelect, onError, onClear, disabled }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (candidate: File) => {
      const extension = `.${candidate.name.split('.').pop()?.toLowerCase() ?? ''}`;
      const validType =
        ACCEPTED_VIDEO_MIME_TYPES.includes(candidate.type) || ACCEPTED_VIDEO_EXTENSIONS.includes(extension);
      if (!validType) {
        onError(`Unsupported file type. Accepted formats: ${ACCEPTED_VIDEO_EXTENSIONS.join(', ')}`);
        return;
      }
      if (candidate.size > MAX_VIDEO_FILE_SIZE_BYTES) {
        onError(`File exceeds the ${Math.round(MAX_VIDEO_FILE_SIZE_BYTES / (1024 * 1024))}MB limit`);
        return;
      }

      try {
        const videoDuration = await readVideoDuration(candidate);
        if (videoDuration > MAX_VIDEO_DURATION_SECONDS) {
          onError(`Video exceeds the ${Math.round(MAX_VIDEO_DURATION_SECONDS / 60)}-minute limit`);
          return;
        }
        onSelect(candidate, videoDuration);
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Could not read video metadata');
      }
    },
    [onError, onSelect]
  );

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const candidate = e.target.files?.[0];
    if (candidate) handleFile(candidate);
    e.target.value = '';
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    const candidate = e.dataTransfer.files?.[0];
    if (candidate) handleFile(candidate);
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={[...ACCEPTED_VIDEO_MIME_TYPES, ...ACCEPTED_VIDEO_EXTENSIONS].join(',')}
        onChange={handleInputChange}
        className="sr-only"
      />

      <div
        onClick={() => !disabled && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onKeyDown={(e) => {
          if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={`flex flex-col items-center justify-center gap-3 border border-dashed p-8 text-center transition-colors ${
          disabled
            ? 'cursor-not-allowed border-white/10 opacity-50'
            : `cursor-pointer ${isDragging ? 'border-green bg-green/5' : 'border-white/15 hover:border-white/30'}`
        }`}
      >
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
          <path
            d="M16 21V7M16 7L10 13M16 7L22 13"
            stroke={isDragging ? 'var(--color-green)' : 'var(--color-muted)'}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M6 24V26C6 26.5523 6.44772 27 7 27H25C25.5523 27 26 26.5523 26 26V24"
            stroke={isDragging ? 'var(--color-green)' : 'var(--color-muted)'}
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        <p className="text-sm text-primary">
          Drop a video file here, or <span className="text-green underline">browse</span>
        </p>
        <p className="font-mono text-xs text-muted">MP4, MOV, or WEBM — up to 500MB, 10 minutes</p>
      </div>

      <p className="mt-3 text-xs text-muted">
        Currently optimized for English audio. Other languages may have reduced accuracy.
      </p>

      {file && duration !== null && (
        <div className="mt-3 flex items-center justify-between border border-white/10 bg-black/30 px-3 py-2 text-sm">
          <div className="flex flex-col overflow-hidden">
            <span className="truncate text-primary">{file.name}</span>
            <span className="font-mono text-xs text-muted">
              {formatFileSize(file.size)} · {formatDuration(duration)}
            </span>
          </div>
          <button
            type="button"
            onClick={onClear}
            disabled={disabled}
            className="ml-3 shrink-0 font-mono text-xs uppercase text-muted transition-colors hover:text-red disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-muted"
          >
            Remove
          </button>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red">{error}</p>}
    </div>
  );
}

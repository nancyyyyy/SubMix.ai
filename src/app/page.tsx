'use client';

import { useState } from 'react';

const SUBTITLE_COLORS = ['white', 'yellow', 'neon'] as const;
type SubtitleColor = (typeof SUBTITLE_COLORS)[number];

const MIN_SUBTITLE_SIZE = 20;
const MAX_SUBTITLE_SIZE = 60;

const RATIOS = [
  { key: '9:16', label: 'Vertical (9:16)', sublabel: 'TikTok/Reels/Shorts' },
  { key: '1:1', label: 'Square (1:1)', sublabel: 'Instagram Feed' },
  { key: '16:9', label: 'Horizontal (16:9)', sublabel: 'YouTube/LinkedIn' },
] as const;
type RatioKey = (typeof RATIOS)[number]['key'];

type Stage = 'idle' | 'downloading' | 'transcribing' | 'generating' | 'done' | 'error';

type Videos = Partial<Record<RatioKey, string>>;

const STAGE_LABELS: Record<Stage, string> = {
  idle: '',
  downloading: 'Downloading…',
  transcribing: 'Transcribing…',
  generating: 'Generating…',
  done: '',
  error: '',
};

export default function Home() {
  const [url, setUrl] = useState('');
  const [subtitleColor, setSubtitleColor] = useState<SubtitleColor>('white');
  const [subtitleSize, setSubtitleSize] = useState(40);
  const [selectedRatios, setSelectedRatios] = useState<Set<RatioKey>>(
    () => new Set(RATIOS.map((r) => r.key))
  );
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [videos, setVideos] = useState<Videos | null>(null);

  const isLoading = stage === 'downloading' || stage === 'transcribing' || stage === 'generating';

  function toggleRatio(key: RatioKey) {
    setSelectedRatios((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selectedRatios.size === 0) {
      setError('Select at least one output ratio');
      return;
    }
    setError(null);
    setVideos(null);
    setStage('downloading');

    // The API resolves in one shot, so these timers just approximate progress
    // through its known steps (download -> transcribe -> generate) for the UI.
    const toTranscribing = setTimeout(() => setStage('transcribing'), 2000);
    const toGenerating = setTimeout(() => setStage('generating'), 6000);

    try {
      const res = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, subtitleColor, subtitleSize, aspectRatios: Array.from(selectedRatios) }),
      });
      const data = await res.json();

      if (!res.ok || data.status !== 'success') {
        setError(data.error ?? 'Something went wrong');
        setStage('error');
        return;
      }

      setVideos(data.videos);
      setStage('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setStage('error');
    } finally {
      clearTimeout(toTranscribing);
      clearTimeout(toGenerating);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <div className="w-full max-w-md">
        <h1 className="mb-8 text-2xl font-semibold text-black dark:text-zinc-50">
          SubMix
        </h1>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="url" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              YouTube URL
            </label>
            <input
              id="url"
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-black focus:outline-none focus:ring-2 focus:ring-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-zinc-50"
            />
          </div>

          <div>
            <label htmlFor="subtitleColor" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Subtitle color
            </label>
            <select
              id="subtitleColor"
              value={subtitleColor}
              onChange={(e) => setSubtitleColor(e.target.value as SubtitleColor)}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-black focus:outline-none focus:ring-2 focus:ring-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-zinc-50"
            >
              {SUBTITLE_COLORS.map((color) => (
                <option key={color} value={color}>
                  {color[0].toUpperCase() + color.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="subtitleSize" className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Subtitle size: {subtitleSize}
            </label>
            <input
              id="subtitleSize"
              type="range"
              min={MIN_SUBTITLE_SIZE}
              max={MAX_SUBTITLE_SIZE}
              value={subtitleSize}
              onChange={(e) => setSubtitleSize(Number(e.target.value))}
              className="w-full"
            />
          </div>

          <div>
            <span className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Output ratios
            </span>
            <div className="flex flex-col gap-2">
              {RATIOS.map(({ key, label, sublabel }) => (
                <label key={key} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={selectedRatios.has(key)}
                    onChange={() => toggleRatio(key)}
                    className="h-4 w-4 rounded border-zinc-300 text-black focus:ring-black dark:border-zinc-700 dark:text-zinc-50 dark:focus:ring-zinc-50"
                  />
                  <span>
                    {label} <span className="text-zinc-500 dark:text-zinc-500">- {sublabel}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading || selectedRatios.size === 0}
            className="mt-2 rounded-md bg-black px-4 py-2 font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-black dark:hover:bg-zinc-200"
          >
            {isLoading ? STAGE_LABELS[stage] : 'Generate'}
          </button>
        </form>

        {error && (
          <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        {stage === 'done' && videos && (
          <div className="mt-8">
            <h2 className="mb-2 text-lg font-medium text-black dark:text-zinc-50">
              Your videos
            </h2>
            <ul className="flex flex-col gap-2">
              {RATIOS.filter(({ key }) => videos[key]).map(({ key, label }) => (
                <li key={key}>
                  <a
                    href={videos[key]}
                    download
                    className="text-sm font-medium text-black underline dark:text-zinc-50"
                  >
                    Download {label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

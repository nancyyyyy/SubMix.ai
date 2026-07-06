'use client';

import { useEffect, useRef, useState } from 'react';
import { FONT_OPTIONS, WAVEFORM_HEIGHTS } from '@/lib/constants';
import type { CaptionSegment, StyleSettings } from '@/lib/project';

interface PreviewPanelProps {
  style: StyleSettings;
  videoFile: File | null;
  segments: CaptionSegment[] | null;
}

const POSITION_CLASS: Record<StyleSettings['position'], string> = {
  top: 'top-6 items-start',
  center: 'inset-y-0 items-center',
  bottom: 'bottom-6 items-end',
};

function findActiveSegment(segments: CaptionSegment[], time: number): CaptionSegment | null {
  return segments.find((segment) => time >= segment.start && time <= segment.end) ?? null;
}

function findActiveWordIndex(segment: CaptionSegment, time: number): number {
  return segment.words.findIndex((word) => time >= word.start && time <= word.end);
}

// Sample caption shown in the viewfinder before a video is uploaded, so the
// frame never looks dead on first load. Loops on a fixed period independent
// of any real video/segment timing.
const DEMO_LOOP_SECONDS = 3.2;
const DEMO_SEGMENT: CaptionSegment = {
  start: 0,
  end: 2.4,
  words: [
    { word: 'just', start: 0, end: 0.6 },
    { word: 'say', start: 0.6, end: 1.2 },
    { word: 'the', start: 1.2, end: 1.8 },
    { word: 'word', start: 1.8, end: 2.4 },
  ],
};

export function PreviewPanel({ style, videoFile, segments }: PreviewPanelProps) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [demoTime, setDemoTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Drives the demo caption loop only while there's no uploaded video;
  // the interval is torn down as soon as a video arrives.
  useEffect(() => {
    if (videoFile) return;
    const start = performance.now();
    const id = setInterval(() => {
      setDemoTime(((performance.now() - start) / 1000) % DEMO_LOOP_SECONDS);
    }, 100);
    return () => clearInterval(id);
  }, [videoFile]);

  // Object URLs are only valid for the lifetime of the File reference that
  // created them, so a fresh one is minted per videoFile and revoked on
  // swap/unmount to avoid leaking blob memory.
  useEffect(() => {
    if (!videoFile) {
      setVideoUrl(null);
      return;
    }
    const url = URL.createObjectURL(videoFile);
    setVideoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [videoFile]);

  const fontFamily = FONT_OPTIONS.find((f) => f.value === style.font)?.cssFamily;
  // -webkit-text-stroke/text-shadow only approximate libass's \bord/\shad
  // rendering (no true outline-behind-fill compositing in CSS), but they
  // track the same outlineColor/outlineWidth/shadowDepth values that get
  // burned into the actual video.
  const textOutline =
    style.outlineWidth > 0 ? { WebkitTextStroke: `${style.outlineWidth}px ${style.outlineColor}` } : {};
  const textShadow = style.shadowDepth > 0 ? `${style.shadowDepth}px ${style.shadowDepth}px 0 ${style.outlineColor}` : 'none';

  const activeSegment = videoUrl
    ? segments
      ? findActiveSegment(segments, currentTime)
      : null
    : DEMO_SEGMENT;
  const activeWordIndex = activeSegment
    ? findActiveWordIndex(activeSegment, videoUrl ? currentTime : demoTime)
    : -1;

  return (
    <div className="flex flex-col gap-3">
      <div
        className="relative aspect-video w-full overflow-hidden border border-white/10 shadow-[0_16px_40px_rgba(0,0,0,0.45)]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 22% 25%, rgba(255,255,255,0.14), transparent 42%), radial-gradient(circle at 78% 68%, rgba(0,0,0,0.4), transparent 52%), linear-gradient(135deg, #5a5e65 0%, #34373c 48%, #75797f 100%)',
        }}
      >
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            className="absolute inset-0 h-full w-full bg-black object-contain"
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            onSeeked={(e) => setCurrentTime(e.currentTarget.currentTime)}
          />
        ) : (
          // Busier placeholder (vs. flat black) so outline/shadow style changes stay visible against it
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.08]"
            style={{
              backgroundImage:
                'repeating-linear-gradient(0deg, #fff 0px, #fff 1px, transparent 1px, transparent 3px)',
            }}
            aria-hidden
          />
        )}

        <div className="corner-bracket pointer-events-none absolute left-3 top-3 h-7 w-7 origin-top-left border-l-2 border-t-2 border-green" />
        <div className="corner-bracket pointer-events-none absolute right-3 top-3 h-7 w-7 origin-top-right border-r-2 border-t-2 border-green" />
        <div className="corner-bracket pointer-events-none absolute bottom-3 left-3 h-7 w-7 origin-bottom-left border-b-2 border-l-2 border-green" />
        <div className="corner-bracket pointer-events-none absolute bottom-3 right-3 h-7 w-7 origin-bottom-right border-b-2 border-r-2 border-green" />

        {activeSegment && (
          <div
            className={`pointer-events-none absolute inset-x-0 flex justify-center px-6 ${POSITION_CLASS[style.position]}`}
          >
            <p
              className="max-w-full text-center leading-tight"
              style={{ fontSize: `${style.size}px`, fontFamily, textShadow }}
            >
              {activeSegment.words.map((word, i) => (
                <span
                  key={i}
                  style={{ color: i === activeWordIndex ? style.highlightColor : style.color, ...textOutline }}
                >
                  {word.word}
                  {i < activeSegment.words.length - 1 ? ' ' : ''}
                </span>
              ))}
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 border border-white/10 bg-panel px-4 py-3">
        <div className="flex h-6 items-end gap-[3px]">
          {WAVEFORM_HEIGHTS.map((h, i) => (
            <span key={i} className="w-[2px] bg-muted/60" style={{ height: `${h}px` }} />
          ))}
        </div>
        <span className="font-mono text-xs text-muted">
          {videoUrl ? (
            'LIVE PREVIEW'
          ) : (
            <>
              <span className="mr-1.5 inline-block h-1.5 w-1.5 bg-red align-middle" aria-hidden />
              REC 00:00:12:04
            </>
          )}
        </span>
      </div>
    </div>
  );
}

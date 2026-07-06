'use client';

import { useState } from 'react';
import { SiteHeader } from '@/components/SiteHeader';
import { FeatureHighlights } from '@/components/FeatureHighlights';
import { UploadZone } from '@/components/UploadZone';
import { CaptionEditor } from '@/components/CaptionEditor';
import { CaptionStyleSection } from '@/components/CaptionStyleSection';
import { FormatsSection } from '@/components/FormatsSection';
import { PreviewPanel } from '@/components/PreviewPanel';
import { GenerateAction } from '@/components/GenerateAction';
import { ResultsGrid } from '@/components/ResultsGrid';
import {
  DEFAULT_CAPTION_STYLE,
  PANEL,
  RATIOS,
  RENDER_STEPS,
  SECTION_LABEL,
  TRANSCRIBE_STEPS,
  type RatioKey,
  type Stage,
  type Videos,
} from '@/lib/constants';
import type { CaptionSegment, Project, StyleSettings } from '@/lib/project';

type View = 'edit' | 'results';

// Isolated results screen shown in place of the whole editing UI once a
// render completes — "Go back and edit" only flips the parent's view state,
// it never touches project/videos/style, so nothing is lost switching back.
function ResultsView({ videos, onBack }: { videos: Videos; onBack: () => void }) {
  return (
    <div className="mx-auto max-w-3xl">
      <button
        type="button"
        onClick={onBack}
        className="mb-10 font-mono text-xs uppercase tracking-wide text-green underline decoration-dotted underline-offset-2 transition-colors hover:text-green/80"
      >
        ← Go back and edit
      </button>

      <div className="mb-10 text-center">
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight text-primary">
          Your videos are ready
        </h1>
        <p className="mt-3 text-muted">Download your captioned clips below</p>
      </div>

      <ResultsGrid videos={videos} />
    </div>
  );
}

interface TranscribeResponse {
  status: 'success' | 'error';
  projectId?: string;
  project?: Project;
  error?: string;
}

interface RenderResponse {
  status: 'success' | 'error';
  videos?: Videos;
  error?: string;
}

// Tracks the actual network upload via XHR progress events, then hands off to
// onUploadComplete once the request body has fully left the browser — the
// server's own transcription time has no progress signal, so the caller
// falls back to a plain "transcribing" state for that part.
function uploadAndTranscribe(
  formData: FormData,
  onProgress: (percent: number) => void,
  onUploadComplete: () => void
): Promise<TranscribeResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/transcribe');

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.upload.onload = () => {
      onProgress(100);
      onUploadComplete();
    };

    xhr.onload = () => {
      try {
        resolve(JSON.parse(xhr.responseText) as TranscribeResponse);
      } catch {
        reject(new Error('Server returned an invalid response'));
      }
    };
    xhr.onerror = () => reject(new Error('Network error while uploading video'));

    xhr.send(formData);
  });
}

export default function Home() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const [style, setStyle] = useState<StyleSettings>(DEFAULT_CAPTION_STYLE);
  const [selectedRatios, setSelectedRatios] = useState<Set<RatioKey>>(
    () => new Set(RATIOS.map((r) => r.key))
  );
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [videos, setVideos] = useState<Videos | null>(null);
  const [view, setView] = useState<View>('edit');

  const [projectId, setProjectId] = useState<string | null>(null);
  const [segments, setSegments] = useState<CaptionSegment[] | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const isLoading = stage === 'uploading' || stage === 'transcribing' || stage === 'rendering';

  function updateStyle(patch: Partial<StyleSettings>) {
    setStyle((prev) => ({ ...prev, ...patch }));
  }

  function resetUpload() {
    setVideoFile(null);
    setVideoDuration(null);
    setFileError(null);
    setProjectId(null);
    setSegments(null);
    setVideos(null);
    setStage('idle');
    setView('edit');
  }

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

  // Optimistically updates the local transcript, then persists just this
  // word to disk — the PATCH only ever touches `word`, never start/end, so
  // this can't drift the timing baked in at transcription time.
  function handleWordEdit(segmentIndex: number, wordIndex: number, newText: string) {
    setSegments((prev) => {
      if (!prev) return prev;
      return prev.map((segment, si) => {
        if (si !== segmentIndex) return segment;
        return {
          ...segment,
          words: segment.words.map((word, wi) => (wi === wordIndex ? { ...word, word: newText } : word)),
        };
      });
    });

    if (!projectId) return;
    setSaveError(null);
    fetch(`/api/project/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ segmentIndex, wordIndex, newText }),
    })
      .then((res) => {
        if (!res.ok) setSaveError('Failed to save that edit. Your other edits are still fine.');
      })
      .catch(() => setSaveError('Failed to save that edit. Your other edits are still fine.'));
  }

  async function runTranscribe() {
    if (!videoFile || videoDuration === null) {
      setError('Select a video file first');
      setStage('error');
      return;
    }
    setError(null);
    setUploadProgress(0);
    setStage('uploading');

    const formData = new FormData();
    formData.append('video', videoFile);

    try {
      const data = await uploadAndTranscribe(
        formData,
        setUploadProgress,
        () => setStage((s) => (s === 'uploading' ? 'transcribing' : s))
      );

      if (data.status !== 'success' || !data.projectId || !data.project) {
        setError(data.error ?? 'Something went wrong');
        setStage('error');
        return;
      }

      setProjectId(data.projectId);
      setSegments(data.project.segments);
      setStage('editing');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setStage('error');
    }
  }

  async function runRender() {
    if (!projectId) {
      setError('Transcribe a video first');
      setStage('error');
      return;
    }
    if (selectedRatios.size === 0) {
      setError('Select at least one output format');
      setStage('error');
      return;
    }
    setError(null);
    setVideos(null);
    setStage('rendering');

    try {
      const res = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, style, aspectRatios: Array.from(selectedRatios) }),
      });

      let data: RenderResponse;
      try {
        data = (await res.json()) as RenderResponse;
      } catch {
        throw new Error('Server returned an invalid response');
      }

      if (!res.ok || data.status !== 'success' || !data.videos) {
        setError(data.error ?? 'Something went wrong');
        setStage('error');
        return;
      }

      setVideos(data.videos);
      setStage('done');
      setView('results');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setStage('error');
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId) {
      runTranscribe();
    } else {
      runRender();
    }
  }

  const canSubmit = projectId
    ? selectedRatios.size > 0
    : selectedRatios.size > 0 && videoFile !== null && videoDuration !== null && !fileError;

  return (
    <div className="min-h-screen bg-base text-primary">
      <SiteHeader />

      <main className="mx-auto max-w-[1400px] px-4 pb-12 pt-6 md:px-8 md:pb-24 md:pt-8">
        {view === 'results' && videos ? (
          <ResultsView videos={videos} onBack={() => setView('edit')} />
        ) : (
          <>
            <FeatureHighlights />

            <form onSubmit={handleSubmit} className="grid grid-cols-1 items-start gap-8 md:grid-cols-[45fr_55fr]">
              {/* Left column: scrollable controls (shown after the preview on mobile) */}
              <div className="order-2 flex flex-col gap-6 md:order-1">
                {projectId && videoFile ? (
                  <div className="flex items-center justify-between border border-white/10 bg-panel px-4 py-2.5 text-sm">
                    <span className="truncate text-primary">{videoFile.name}</span>
                    <button
                      type="button"
                      onClick={resetUpload}
                      disabled={isLoading}
                      className="ml-3 shrink-0 font-mono text-xs uppercase text-green underline transition-colors hover:text-green/80 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Change video
                    </button>
                  </div>
                ) : (
                  <div className={PANEL}>
                    <span className={SECTION_LABEL}>Upload a video</span>
                    <UploadZone
                      file={videoFile}
                      duration={videoDuration}
                      error={fileError}
                      disabled={isLoading}
                      onSelect={(file, duration) => {
                        setVideoFile(file);
                        setVideoDuration(duration);
                        setFileError(null);
                      }}
                      onError={(message) => {
                        setFileError(message);
                        setVideoFile(null);
                        setVideoDuration(null);
                      }}
                      onClear={resetUpload}
                    />
                  </div>
                )}

                <CaptionStyleSection style={style} onStyleChange={updateStyle} />

                <FormatsSection selectedRatios={selectedRatios} onToggle={toggleRatio} />

                {/* Action area: Transcribe button is replaced in place by the caption
                    editor + Render button once transcription completes; on success the
                    whole view swaps to the dedicated results screen. */}
                {segments && (
                  <div>
                    <CaptionEditor segments={segments} onWordEdit={handleWordEdit} disabled={stage === 'rendering'} />
                    {saveError && <p className="mt-2 text-sm text-red">{saveError}</p>}
                  </div>
                )}

                <GenerateAction
                  stage={stage}
                  steps={projectId ? RENDER_STEPS : TRANSCRIBE_STEPS}
                  submitLabel={projectId ? 'Render' : 'Transcribe'}
                  error={error}
                  isLoading={isLoading}
                  canSubmit={canSubmit}
                  uploadProgress={uploadProgress}
                  onRetry={() => (projectId ? runRender() : runTranscribe())}
                />
              </div>

              {/* Right column: sticky live preview (shown right after the feature cards on mobile) */}
              <div className="order-1 md:sticky md:order-2 md:top-32">
                <PreviewPanel style={style} videoFile={videoFile} segments={segments} />
              </div>
            </form>
          </>
        )}
      </main>
    </div>
  );
}

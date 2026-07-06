import { PANEL, RATIOS, type Videos } from '@/lib/constants';

export function ResultsGrid({ videos }: { videos: Videos }) {
  return (
    <div className="grid gap-4 sm:grid-cols-1">
      {RATIOS.filter(({ key }) => videos[key]).map(({ key, label, aspectCss }) => (
        <div key={key} className={PANEL}>
          <p className="mb-3 font-mono text-xs uppercase tracking-wide text-muted">
            {label} <span className="text-primary">{key}</span>
          </p>
          <video
            src={videos[key]}
            controls
            className="mx-auto h-40 border border-white/10 bg-black object-contain"
            style={{ aspectRatio: aspectCss }}
          />
          <a
            href={videos[key]}
            download
            className="mt-4 block w-full border border-green bg-green px-4 py-2 text-center text-sm font-medium text-[#0C0E10] transition-colors hover:bg-green/90"
          >
            Download
          </a>
        </div>
      ))}
    </div>
  );
}

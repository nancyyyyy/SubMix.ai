export function SiteHeader() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 h-24 border-b border-white/10 bg-base/95 backdrop-blur">
      <div className="mx-auto flex h-full max-w-[1400px] items-center justify-between px-8">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-3xl font-bold uppercase leading-none tracking-tight text-primary">
            SubMix
          </span>
          <span className="hidden font-mono text-xs uppercase tracking-wide text-muted lg:inline">
            Upload a video / captioned clips out
          </span>
        </div>
        <div className="flex items-center gap-4 font-mono text-xs uppercase tracking-wide text-muted">
          <a
            href="mailto:submix.caption@gmail.com?subject=SubMix Feedback"
            className="underline decoration-dotted underline-offset-2 transition-colors hover:text-primary"
          >
            Send feedback
          </a>
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-green" aria-hidden />
            Beta
          </div>
        </div>
      </div>
    </header>
  );
}

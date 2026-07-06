import { MobileWarningBanner } from './MobileWarningBanner';

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-base/95 backdrop-blur">
      <MobileWarningBanner />
      <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between px-4 md:h-24 md:px-8">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-xl font-bold uppercase leading-none tracking-tight text-primary md:text-3xl">
            SubMix
          </span>
          <span className="hidden font-mono text-xs uppercase tracking-wide text-muted lg:inline">
            Upload a video / captioned clips out
          </span>
        </div>
        <div className="flex items-center gap-3 font-mono text-xs uppercase tracking-wide text-muted md:gap-4">
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

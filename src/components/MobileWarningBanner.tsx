'use client';

import { useState } from 'react';

// Sits in normal document flow above the (now sticky) SiteHeader, so it
// scrolls away naturally rather than needing manual height coordination with
// a fixed-position header. Dismissal is in-memory only — reappears next
// session by design, per product ask.
export function MobileWarningBanner() {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-panel px-4 py-2 md:hidden">
      <p className="text-xs leading-snug text-amber-300/90">
        SubMix works best on a desktop or laptop screen. Some features may not display correctly on mobile.
      </p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="-m-1.5 shrink-0 rounded p-1.5 text-muted transition-colors hover:text-primary"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

const FEATURES = [
  { title: 'Edit without breaking timing', description: 'Fix a typo without redoing your captions.' },
  { title: 'Word-by-word highlight captions', description: 'Animated karaoke-style captions, done automatically.' },
  { title: 'Export to every format', description: '9:16, 1:1, 16:9 in one click.' },
  { title: 'No downloads, no waiting', description: 'Runs in the cloud, nothing to install.' },
];

export function FeatureHighlights() {
  return (
    <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {FEATURES.map(({ title, description }) => (
        <div key={title} className="border border-white/10 bg-panel px-4 py-3">
          <p className="font-display text-sm font-semibold uppercase leading-tight tracking-tight text-primary">
            {title}
          </p>
          <p className="mt-1 text-xs leading-snug text-muted">{description}</p>
        </div>
      ))}
    </div>
  );
}

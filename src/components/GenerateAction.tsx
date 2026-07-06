import { BUTTON_PRIMARY, PANEL, type Stage } from '@/lib/constants';

interface GenerateActionProps {
  stage: Stage;
  steps: { stage: Stage; label: string }[];
  submitLabel: string;
  error: string | null;
  isLoading: boolean;
  canSubmit: boolean;
  uploadProgress: number;
  onRetry: () => void;
}

export function GenerateAction({
  stage,
  steps,
  submitLabel,
  error,
  isLoading,
  canSubmit,
  uploadProgress,
  onRetry,
}: GenerateActionProps) {
  const currentStepIndex = steps.findIndex((s) => s.stage === stage);

  if (stage === 'error') {
    return (
      <div className={PANEL}>
        <p className="mb-4 text-sm text-red">{error}</p>
        <button type="button" onClick={onRetry} className={BUTTON_PRIMARY}>
          Try again
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={PANEL}>
        <ul className="flex flex-col gap-4">
          {steps.map((step, i) => {
            const isDone = i < currentStepIndex;
            const isCurrent = i === currentStepIndex;
            return (
              <li key={step.stage} className="flex items-center gap-3 text-sm">
                <span
                  className={`h-2.5 w-2.5 shrink-0 ${
                    isCurrent ? 'bg-red' : isDone ? 'bg-green' : 'border border-muted/40'
                  }`}
                />
                <span className={isCurrent ? 'font-medium text-primary' : isDone ? 'text-muted' : 'text-muted/40'}>
                  {step.label}
                  {isCurrent && step.stage === 'uploading' ? ` ${uploadProgress}%` : ''}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <button type="submit" disabled={!canSubmit} className={BUTTON_PRIMARY}>
      {submitLabel}
    </button>
  );
}

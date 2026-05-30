import type { ReactNode } from 'react';

interface ProgressProps {
  value?: number | null;
  max?: number;
  label?: ReactNode;
  tone?: 'default' | 'good' | 'warning';
}

export function Progress({ value, max = 100, label, tone = 'default' }: ProgressProps) {
  const bounded = typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(value, max))
    : null;
  const percent = bounded === null ? null : Math.round((bounded / max) * 100);

  return (
    <div className="ui-progress" data-tone={tone} data-indeterminate={bounded === null ? 'true' : undefined}>
      <div className="ui-progress-head">
        {label ? <span>{label}</span> : null}
        {percent !== null ? <span>{percent}%</span> : null}
      </div>
      <div
        className="ui-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={bounded ?? undefined}
        aria-label={typeof label === 'string' ? label : 'Progress'}
      >
        <span className="ui-progress-fill" style={percent === null ? undefined : { width: `${percent}%` }} />
      </div>
    </div>
  );
}

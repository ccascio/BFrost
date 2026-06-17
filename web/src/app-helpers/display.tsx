import { useState, type ReactNode } from 'react';
import type { HealthStatus, RunStatus } from '../app-types';

export function Metric({
  label,
  value,
  active,
  onClick,
}: {
  label: string;
  value: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span>{label}</span>
      <strong>{value}</strong>
    </>
  );

  if (onClick) {
    return (
      <button
        className={`metric metric-button${active ? ' active' : ''}`}
        type="button"
        aria-pressed={Boolean(active)}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return (
    <div className="metric">
      {content}
    </div>
  );
}

export function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function DetailBlock({
  label,
  value,
  tone,
}: {
  label: string;
  value?: string;
  tone?: 'error';
}) {
  if (!value) return null;
  return (
    <div className={`detail-block${tone === 'error' ? ' error' : ''}`}>
      <span>{label}</span>
      <p>{value}</p>
    </div>
  );
}

export function HelpTip({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="helptip">
      <button
        type="button"
        className="helptip-trigger"
        aria-label="Help"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >?</button>
      {open ? <span className="helptip-body">{children}</span> : null}
    </span>
  );
}

export function HealthRow({ label, status }: { label: string; status: HealthStatus }) {
  return (
    <div className="health-row">
      <div>
        <strong>{label}</strong>
        <span className="health-copy">{status.detail}</span>
      </div>
      <StatusPill tone={status.ok ? 'good' : 'warning'}>{status.ok ? 'ready' : 'missing'}</StatusPill>
    </div>
  );
}

export function StatusPill({
  children,
  tone,
}: {
  children: string;
  tone: 'good' | 'warning' | 'info' | 'muted';
}) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}

export const RUN_ERROR_PREVIEW_CHARS = 180;

export function RunError({ message }: { message: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = message.length > RUN_ERROR_PREVIEW_CHARS;
  const display = expanded || !isLong ? message : `${message.slice(0, RUN_ERROR_PREVIEW_CHARS)}...`;
  return (
    <div className="run-error">
      <p className="error-text">{display}</p>
      {isLong ? (
        <button
          type="button"
          className="run-error-toggle"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </div>
  );
}

export function statusTone(status: RunStatus): 'good' | 'warning' | 'info' | 'muted' {
  if (status === 'success') return 'good';
  if (status === 'error') return 'warning';
  if (status === 'skipped') return 'info';
  return 'muted';
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

export function formatDate(value: string | null): string {
  if (!value) return 'n/a';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

export function formatRelativeTime(value: string): string {
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return '';
  const diffMs = Date.now() - ts;
  if (diffMs < 60_000) return 'just now';
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(ts);
}

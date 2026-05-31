import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CronMode = 'minutes' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom';

interface CronParams {
  minuteInterval: number;   // for 'minutes'
  hourlyMinute: number;     // for 'hourly'
  hour: number;             // for daily/weekly/monthly
  minute: number;           // for daily/weekly/monthly
  daysOfWeek: number[];     // for 'weekly', 0=Sun … 6=Sat
  dayOfMonth: number;       // for 'monthly'
}

const DEFAULT_PARAMS: CronParams = {
  minuteInterval: 15,
  hourlyMinute: 0,
  hour: 7,
  minute: 0,
  daysOfWeek: [1],
  dayOfMonth: 1,
};

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function detectMode(cron: string): CronMode {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return 'custom';
  const [min, hour, dom, month, dow] = parts;
  if (/^\*\/\d+$/.test(min) && hour === '*' && dom === '*' && month === '*' && dow === '*') return 'minutes';
  if (/^\d+$/.test(min) && hour === '*' && dom === '*' && month === '*' && dow === '*') return 'hourly';
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && month === '*' && /^[\d,]+$/.test(dow) && dow !== '*') return 'weekly';
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && month === '*' && dow === '*') return 'daily';
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && /^\d+$/.test(dom) && month === '*' && dow === '*') return 'monthly';
  return 'custom';
}

function parseParams(cron: string, mode: CronMode): CronParams {
  const p = { ...DEFAULT_PARAMS };
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return p;
  const [min, hour, dom, , dow] = parts;
  if (mode === 'minutes') {
    const n = parseInt(min.replace('*/', ''), 10);
    p.minuteInterval = [5, 10, 15, 20, 30].includes(n) ? n : 15;
  }
  if (mode === 'hourly') p.hourlyMinute = clamp(parseInt(min, 10), 0, 59);
  if (mode === 'daily' || mode === 'weekly' || mode === 'monthly') {
    p.minute = clamp(parseInt(min, 10), 0, 59);
    p.hour = clamp(parseInt(hour, 10), 0, 23);
  }
  if (mode === 'weekly') {
    p.daysOfWeek = dow.split(',').map(Number).filter((d) => d >= 0 && d <= 6);
    if (p.daysOfWeek.length === 0) p.daysOfWeek = [1];
  }
  if (mode === 'monthly') p.dayOfMonth = clamp(parseInt(dom, 10), 1, 31);
  return p;
}

function buildCron(mode: CronMode, params: CronParams, customCron: string): string {
  switch (mode) {
    case 'minutes':  return `*/${params.minuteInterval} * * * *`;
    case 'hourly':   return `${params.hourlyMinute} * * * *`;
    case 'daily':    return `${params.minute} ${params.hour} * * *`;
    case 'weekly': {
      const days = [...params.daysOfWeek].sort((a, b) => a - b).join(',');
      return `${params.minute} ${params.hour} * * ${days || '0'}`;
    }
    case 'monthly':  return `${params.minute} ${params.hour} ${params.dayOfMonth} * *`;
    case 'custom':   return customCron;
  }
}

function humanizeCron(mode: CronMode, params: CronParams, customCron: string): string {
  const fmt12 = (h: number, m: number) => {
    const hh = h % 12 || 12;
    const mm = String(m).padStart(2, '0');
    return `${hh}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
  };
  switch (mode) {
    case 'minutes':  return `Every ${params.minuteInterval} minutes`;
    case 'hourly':   return `Every hour at :${String(params.hourlyMinute).padStart(2, '0')}`;
    case 'daily':    return `Every day at ${fmt12(params.hour, params.minute)}`;
    case 'weekly': {
      const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const sorted = [...params.daysOfWeek].sort((a, b) => a - b);
      const dayStr = sorted.map((d) => DAYS[d]).join(', ');
      return `Every ${dayStr} at ${fmt12(params.hour, params.minute)}`;
    }
    case 'monthly':  return `Day ${params.dayOfMonth} of every month at ${fmt12(params.hour, params.minute)}`;
    case 'custom':   return customCron;
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, isNaN(n) ? min : n));
}

// ---------------------------------------------------------------------------
// Mode definitions
// ---------------------------------------------------------------------------

const MODES: { id: CronMode; label: string }[] = [
  { id: 'minutes',  label: 'Every N min' },
  { id: 'hourly',   label: 'Hourly' },
  { id: 'daily',    label: 'Daily' },
  { id: 'weekly',   label: 'Weekly' },
  { id: 'monthly',  label: 'Monthly' },
  { id: 'custom',   label: 'Custom' },
];

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_FULL   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MIN_INTERVALS = [5, 10, 15, 20, 30];

// ---------------------------------------------------------------------------
// Sub-controls
// ---------------------------------------------------------------------------

function TimePicker({
  hour, minute, onHourChange, onMinuteChange,
}: {
  hour: number; minute: number;
  onHourChange: (h: number) => void;
  onMinuteChange: (m: number) => void;
}) {
  return (
    <div className="cron-time-picker">
      <span className="cron-field-label">At</span>
      <select
        className="cron-select"
        value={hour}
        onChange={(e) => onHourChange(parseInt(e.target.value, 10))}
        aria-label="Hour"
      >
        {Array.from({ length: 24 }, (_, i) => (
          <option key={i} value={i}>
            {String(i).padStart(2, '0')}
          </option>
        ))}
      </select>
      <span className="cron-time-sep">:</span>
      <select
        className="cron-select"
        value={minute}
        onChange={(e) => onMinuteChange(parseInt(e.target.value, 10))}
        aria-label="Minute"
      >
        {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => (
          <option key={m} value={m}>
            {String(m).padStart(2, '0')}
          </option>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface CronBuilderProps {
  value: string;
  onChange: (cron: string) => void;
}

export function CronBuilder({ value, onChange }: CronBuilderProps) {
  const [mode, setMode]       = useState<CronMode>(() => detectMode(value));
  const [params, setParams]   = useState<CronParams>(() => parseParams(value, detectMode(value)));
  const [customCron, setCustomCron] = useState(value);

  // Pill animation: track position of the active tab button
  const stripRef = useRef<HTMLDivElement>(null);
  const btnRefs  = useRef<Partial<Record<CronMode, HTMLButtonElement>>>({});
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  const computedCron = buildCron(mode, params, customCron);

  // Sync pill position when mode or layout changes
  useLayoutEffect(() => {
    const el = btnRefs.current[mode];
    const strip = stripRef.current;
    if (!el || !strip) return;
    const er = el.getBoundingClientRect();
    const sr = strip.getBoundingClientRect();
    setPill({ left: er.left - sr.left, width: er.width });
  }, [mode]);

  // External change (e.g. preset applied from parent)
  useEffect(() => {
    if (value !== computedCron) {
      const newMode = detectMode(value);
      setMode(newMode);
      setParams(parseParams(value, newMode));
      if (newMode === 'custom') setCustomCron(value);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Propagate internal changes up
  useEffect(() => {
    if (computedCron !== value) onChange(computedCron);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computedCron]);

  function updateParams(patch: Partial<CronParams>) {
    setParams((p) => ({ ...p, ...patch }));
  }

  function handleModeChange(m: CronMode) {
    setMode(m);
    // When switching to 'custom', seed the raw input with the current expression
    if (m === 'custom') setCustomCron(computedCron);
  }

  const human = humanizeCron(mode, params, customCron);

  return (
    <div className="cron-builder">
      {/* ── Frequency strip ── */}
      <div className="cron-strip" ref={stripRef} role="tablist" aria-label="Schedule frequency">
        {pill && (
          <span
            className="cron-pill"
            style={{ left: pill.left, width: pill.width }}
            aria-hidden="true"
          />
        )}
        {MODES.map((m) => (
          <button
            key={m.id}
            ref={(el) => { if (el) btnRefs.current[m.id] = el; }}
            role="tab"
            aria-selected={mode === m.id}
            type="button"
            className={`cron-tab${mode === m.id ? ' cron-tab-active' : ''}`}
            onClick={() => handleModeChange(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* ── Controls panel ── */}
      <div className="cron-panel" role="tabpanel">
        {mode === 'minutes' && (
          <div className="cron-row">
            <span className="cron-field-label">Every</span>
            <div className="cron-chip-group" role="group" aria-label="Interval">
              {MIN_INTERVALS.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`cron-chip${params.minuteInterval === n ? ' cron-chip-active' : ''}`}
                  onClick={() => updateParams({ minuteInterval: n })}
                  aria-pressed={params.minuteInterval === n}
                >
                  {n} min
                </button>
              ))}
            </div>
          </div>
        )}

        {mode === 'hourly' && (
          <div className="cron-row">
            <span className="cron-field-label">At minute</span>
            <select
              className="cron-select"
              value={params.hourlyMinute}
              onChange={(e) => updateParams({ hourlyMinute: parseInt(e.target.value, 10) })}
              aria-label="Minute past the hour"
            >
              {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => (
                <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
              ))}
            </select>
            <span className="cron-field-hint">past every hour</span>
          </div>
        )}

        {mode === 'daily' && (
          <TimePicker
            hour={params.hour}
            minute={params.minute}
            onHourChange={(h) => updateParams({ hour: h })}
            onMinuteChange={(m) => updateParams({ minute: m })}
          />
        )}

        {mode === 'weekly' && (
          <div className="cron-weekly">
            <div className="cron-row">
              <span className="cron-field-label">On</span>
              <div className="cron-day-group" role="group" aria-label="Days of week">
                {DAY_LABELS.map((lbl, i) => {
                  const active = params.daysOfWeek.includes(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      aria-pressed={active}
                      aria-label={DAY_FULL[i]}
                      title={DAY_FULL[i]}
                      className={`cron-day${active ? ' cron-day-active' : ''}`}
                      onClick={() => {
                        const next = active
                          ? params.daysOfWeek.filter((d) => d !== i)
                          : [...params.daysOfWeek, i];
                        updateParams({ daysOfWeek: next.length ? next : [i] });
                      }}
                    >
                      {lbl}
                    </button>
                  );
                })}
              </div>
            </div>
            <TimePicker
              hour={params.hour}
              minute={params.minute}
              onHourChange={(h) => updateParams({ hour: h })}
              onMinuteChange={(m) => updateParams({ minute: m })}
            />
          </div>
        )}

        {mode === 'monthly' && (
          <div className="cron-monthly">
            <div className="cron-row">
              <span className="cron-field-label">Day</span>
              <select
                className="cron-select"
                value={params.dayOfMonth}
                onChange={(e) => updateParams({ dayOfMonth: parseInt(e.target.value, 10) })}
                aria-label="Day of month"
              >
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              <span className="cron-field-hint">of every month</span>
            </div>
            <TimePicker
              hour={params.hour}
              minute={params.minute}
              onHourChange={(h) => updateParams({ hour: h })}
              onMinuteChange={(m) => updateParams({ minute: m })}
            />
          </div>
        )}

        {mode === 'custom' && (
          <div className="cron-row">
            <span className="cron-field-label">Expression</span>
            <input
              className="cron-raw-input"
              type="text"
              value={customCron}
              placeholder="*/30 * * * *"
              onChange={(e) => {
                setCustomCron(e.target.value);
                onChange(e.target.value);
              }}
              spellCheck={false}
              aria-label="Cron expression"
            />
          </div>
        )}
      </div>

      {/* ── Summary footer ── */}
      <div className="cron-footer">
        <span className="cron-human">{human}</span>
        <code className="cron-badge">{computedCron}</code>
      </div>
    </div>
  );
}

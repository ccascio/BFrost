/**
 * First-run Setup Wizard (LOWCODE_ROADMAP Workstream A).
 *
 * The shell owns persistence, focus trapping, and step navigation. Step bodies
 * live under web/src/wizard/ so this file stays a small coordinator.
 */

import { useEffect, useRef, useState } from 'react';
import { StepEmbedding, StepModel } from './wizard/model-steps';
import { StepWelcome } from './wizard/onboarding';
import { StepSecurity } from './wizard/security-step';
import type { WizardProps } from './wizard/types';
import { StepChannels, StepCredentials, StepFirstRun, StepWebSearch, StepWorkers } from './wizard/worker-steps';

export type { WizardProps } from './wizard/types';

const TOTAL_STEPS = 9;
const STEP_LABELS = [
  'Welcome',
  'Model',
  'Embedding',
  'Web search',
  'Channels',
  'Workers',
  'Credentials',
  'First run',
  'Security',
];

async function persistStep(step: number) {
  await fetch('/api/wizard/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ step }),
  }).catch(() => undefined);
}

async function markCompleted() {
  await fetch('/api/wizard/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ completed: true }),
  }).catch(() => undefined);
}

export function Wizard({ dashboard, onDismiss, onComplete, onRefreshDashboard, onNavigate, onRunDemoAction }: WizardProps) {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const shellRef = useRef<HTMLDivElement>(null);
  const onDismissRef = useRef(onDismiss);

  useEffect(() => { onDismissRef.current = onDismiss; }, [onDismiss]);

  useEffect(() => {
    fetch('/api/wizard/state')
      .then((r) => r.json() as Promise<{ step: number; completed: boolean }>)
      .then((s) => {
        if (!s.completed) setStep(s.step ?? 0);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    focusFirstElement(shellRef.current);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onDismissRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      trapTabKey(event, shellRef.current);
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      prevFocus?.focus();
    };
  }, []);

  async function goTo(nextStep: number) {
    setStep(nextStep);
    await persistStep(nextStep);
  }

  async function finish() {
    await markCompleted();
    onComplete();
  }

  function handleNavigate(tab: string) {
    void markCompleted();
    onNavigate(tab);
  }

  if (loading) {
    return (
      <div className="wizard-overlay" role="dialog" aria-modal="true" aria-label="Setup wizard">
        <div className="wizard-shell" ref={shellRef}>
          <p className="wizard-loading">Loading...</p>
        </div>
      </div>
    );
  }

  const isFirst = step === 0;
  const isLast = step === TOTAL_STEPS - 1;

  return (
    <div className="wizard-overlay" role="dialog" aria-modal="true" aria-labelledby="wizard-step-heading">
      <div className="wizard-shell" ref={shellRef}>
        <WizardHeader step={step} onDismiss={onDismiss} />

        <div className="wizard-progress-bar" role="progressbar" aria-valuenow={step} aria-valuemin={0} aria-valuemax={TOTAL_STEPS - 1}>
          <div
            className="wizard-progress-fill"
            style={{ width: `${(step / (TOTAL_STEPS - 1)) * 100}%` }}
          />
        </div>

        <span id="wizard-step-heading" className="sr-only">
          Setup wizard - Step {step + 1} of {TOTAL_STEPS}: {STEP_LABELS[step]}
        </span>

        <div className="wizard-content" aria-live="polite" aria-atomic="false">
          {step === 0 && <StepWelcome dashboard={dashboard} onRefresh={onRefreshDashboard} onRunDemoAction={onRunDemoAction} />}
          {step === 1 && <StepModel dashboard={dashboard} onRefresh={onRefreshDashboard} />}
          {step === 2 && <StepEmbedding dashboard={dashboard} onRefresh={onRefreshDashboard} />}
          {step === 3 && <StepWebSearch dashboard={dashboard} onRefresh={onRefreshDashboard} onNavigate={handleNavigate} />}
          {step === 4 && <StepChannels dashboard={dashboard} onRefresh={onRefreshDashboard} />}
          {step === 5 && <StepWorkers dashboard={dashboard} onRefresh={onRefreshDashboard} />}
          {step === 6 && <StepCredentials dashboard={dashboard} onNavigate={handleNavigate} />}
          {step === 7 && <StepFirstRun dashboard={dashboard} onRefresh={onRefreshDashboard} />}
          {step === 8 && <StepSecurity dashboard={dashboard} onRefresh={onRefreshDashboard} />}
        </div>

        <div className="wizard-footer">
          <div className="wizard-footer-left">
            {!isFirst ? (
              <button type="button" onClick={() => void goTo(step - 1)}>
                ← Back
              </button>
            ) : (
              <button type="button" onClick={onDismiss}>
                Skip setup
              </button>
            )}
          </div>
          <div className="wizard-footer-right">
            {!isLast ? (
              <>
                <button type="button" onClick={() => void goTo(step + 1)}>
                  Skip →
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => void goTo(step + 1)}
                >
                  Next →
                </button>
              </>
            ) : (
              <button
                type="button"
                className="primary"
                onClick={() => void finish()}
              >
                Finish setup ✓
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function WizardHeader({ step, onDismiss }: { step: number; onDismiss: () => void }) {
  return (
    <div className="wizard-header">
      <div className="wizard-progress-labels">
        {STEP_LABELS.map((label, index) => (
          <span
            key={label}
            className={`wizard-progress-label${index === step ? ' active' : index < step ? ' done' : ''}`}
          >
            {index < step ? '✓' : index + 1}. {label}
          </span>
        ))}
      </div>
      <button
        type="button"
        className="wizard-close"
        onClick={onDismiss}
        aria-label="Close wizard"
      >
        ✕
      </button>
    </div>
  );
}

function focusableElements(shell: HTMLDivElement | null): HTMLElement[] {
  if (!shell) return [];
  return Array.from(
    shell.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.closest('[hidden]'));
}

function focusFirstElement(shell: HTMLDivElement | null) {
  focusableElements(shell)[0]?.focus();
}

function trapTabKey(event: KeyboardEvent, shell: HTMLDivElement | null) {
  const focusable = focusableElements(shell);
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey) {
    if (document.activeElement === first) {
      event.preventDefault();
      last.focus();
    }
    return;
  }
  if (document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

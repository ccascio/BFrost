import { useEffect, useState } from 'react';
import { Button, type ButtonProps } from './Button';

interface CopyButtonProps extends Omit<ButtonProps, 'children' | 'onClick'> {
  value: string;
  label?: string;
  copiedLabel?: string;
  errorLabel?: string;
  resetAfterMs?: number;
  onCopied?: () => void;
  onCopyError?: (error: unknown) => void;
}

export function CopyButton({
  value,
  label = 'Copy',
  copiedLabel = 'Copied',
  errorLabel = 'Copy failed',
  resetAfterMs = 1400,
  onCopied,
  onCopyError,
  disabled,
  ...props
}: CopyButtonProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = window.setTimeout(() => setState('idle'), resetAfterMs);
    return () => window.clearTimeout(timer);
  }, [resetAfterMs, state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
      onCopied?.();
    } catch (error) {
      setState('error');
      onCopyError?.(error);
    }
  }

  const currentLabel = state === 'copied' ? copiedLabel : state === 'error' ? errorLabel : label;

  return (
    <Button
      {...props}
      disabled={disabled || !value}
      onClick={() => void copy()}
      aria-live="polite"
      data-state={state}
    >
      {currentLabel}
    </Button>
  );
}

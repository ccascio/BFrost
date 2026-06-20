import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  side?: 'right' | 'left' | 'bottom';
  footer?: ReactNode;
  headerActions?: ReactNode;
}

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  side = 'right',
  footer,
  headerActions,
}: SheetProps) {
  const titleId = useId();
  const descId = useId();
  const shellRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => focusFirst(shellRef.current), 0);
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onOpenChange(false);
        return;
      }
      if (event.key === 'Tab' && shellRef.current) {
        trapFocus(event, shellRef.current);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onOpenChange, open]);

  if (!open) return null;

  return createPortal(
    <div className="ui-sheet-overlay" onMouseDown={() => onOpenChange(false)}>
      <aside
        ref={shellRef}
        className="ui-sheet-shell"
        data-side={side}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="ui-sheet-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descId}>{description}</p> : null}
          </div>
          <div className="ui-sheet-header-actions">
            {headerActions}
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </div>
        <div className="ui-sheet-body">{children}</div>
        {footer ? <div className="ui-sheet-footer">{footer}</div> : null}
      </aside>
    </div>,
    document.body,
  );
}

function focusFirst(root: HTMLElement | null): void {
  const first = root?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
  first?.focus();
}

function trapFocus(event: KeyboardEvent, root: HTMLElement): void {
  const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((item) => item.offsetParent !== null || item === document.activeElement);
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

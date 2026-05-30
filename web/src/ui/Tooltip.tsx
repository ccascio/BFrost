import { useId, type ReactNode } from 'react';

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
}

export function Tooltip({ content, children, side = 'top' }: TooltipProps) {
  const id = useId();

  return (
    <span className="ui-tooltip" data-side={side}>
      <span className="ui-tooltip-trigger" aria-describedby={id}>
        {children}
      </span>
      <span id={id} role="tooltip" className="ui-tooltip-content">
        {content}
      </span>
    </span>
  );
}

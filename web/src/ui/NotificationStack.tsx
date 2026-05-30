import type { ReactNode } from 'react';
import { Button } from './Button';

export type NotificationTone = 'info' | 'success' | 'warning' | 'error';

export interface NotificationItem {
  id: string;
  tone?: NotificationTone;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

interface NotificationStackProps {
  items: NotificationItem[];
  onDismiss: (id: string) => void;
  label?: string;
}

export function NotificationStack({ items, onDismiss, label = 'Notifications' }: NotificationStackProps) {
  if (items.length === 0) return null;

  return (
    <section className="ui-notification-stack" aria-label={label} aria-live="polite" aria-relevant="additions removals">
      {items.map((item) => (
        <article key={item.id} className="ui-notification" data-tone={item.tone ?? 'info'}>
          <div className="ui-notification-content">
            <strong>{item.title}</strong>
            {item.description ? <p>{item.description}</p> : null}
            {item.action ? <div className="ui-notification-action">{item.action}</div> : null}
          </div>
          <Button variant="ghost" size="sm" onClick={() => onDismiss(item.id)} aria-label="Dismiss notification">
            Dismiss
          </Button>
        </article>
      ))}
    </section>
  );
}

import { useEffect, useRef, useState } from 'react';
import type { EventLogRecord } from '../app-types';

export type EventStreamStatus = 'idle' | 'connecting' | 'open' | 'closed';

export interface UseEventStreamOptions {
  enabled: boolean;
  onEvent: (event: EventLogRecord) => void;
  onOpen?: () => void;
}

export function useEventStream({ enabled, onEvent, onOpen }: UseEventStreamOptions): EventStreamStatus {
  const [status, setStatus] = useState<EventStreamStatus>('idle');
  const onEventRef = useRef(onEvent);
  const onOpenRef = useRef(onOpen);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !('EventSource' in window)) {
      setStatus(enabled ? 'closed' : 'idle');
      return;
    }

    let disposed = false;
    const stream = new EventSource('/api/events/stream');
    setStatus('connecting');

    stream.onopen = () => {
      if (disposed) return;
      setStatus('open');
      onOpenRef.current?.();
    };

    stream.onerror = () => {
      if (disposed) return;
      setStatus(stream.readyState === EventSource.CLOSED ? 'closed' : 'connecting');
    };

    stream.addEventListener('event-log', (message) => {
      if (disposed) return;
      try {
        onEventRef.current(JSON.parse(message.data) as EventLogRecord);
      } catch (err) {
        console.warn('[EventStream] Ignoring malformed event:', err);
      }
    });

    return () => {
      disposed = true;
      stream.close();
      setStatus('idle');
    };
  }, [enabled]);

  return status;
}

import { useMemo, useState } from 'react';
import { CopyButton } from './CopyButton';

export interface CodeTab {
  id: string;
  label: string;
  code: string;
  language?: string;
}

interface CodeTabsProps {
  tabs: CodeTab[];
  defaultId?: string;
  copyLabel?: string;
}

export function CodeTabs({ tabs, defaultId, copyLabel = 'Copy' }: CodeTabsProps) {
  const firstId = tabs[0]?.id ?? '';
  const [activeId, setActiveId] = useState(defaultId ?? firstId);
  const active = useMemo(
    () => tabs.find((tab) => tab.id === activeId) ?? tabs[0],
    [activeId, tabs],
  );

  if (!active) return null;

  return (
    <section className="ui-code-tabs">
      <div className="ui-code-tabs-head">
        <div role="tablist" aria-label="Code examples" className="ui-code-tab-list">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={tab.id === active.id}
              className="ui-code-tab"
              onClick={() => setActiveId(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <CopyButton value={active.code} label={copyLabel} size="sm" />
      </div>
      <pre className="ui-code-panel">
        <code data-language={active.language}>{active.code}</code>
      </pre>
    </section>
  );
}

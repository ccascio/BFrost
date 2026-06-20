import { useState, useMemo, useRef } from 'react';
import { Sheet } from './Sheet';
import { CopyButton } from './CopyButton';
import type { ChatArtifact } from '../app-types';

interface ArtifactPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pinned: boolean;
  onPinChange: (pinned: boolean) => void;
  artifacts: ChatArtifact[];
  activeId: string | null;
  onSelectId: (id: string) => void;
  onDelete?: (id: string) => void;
}

type PreviewTab = 'preview' | 'code';

const REACT_IFRAME_TEMPLATE = (content: string) => `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <script src="https://cdn.tailwindcss.com"></script>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <style>body{margin:0;font-family:system-ui,sans-serif;}</style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" data-presets="react,typescript">
    ${content}
    const rootEl = document.getElementById('root');
    if(typeof App !== 'undefined'){
      ReactDOM.createRoot(rootEl).render(React.createElement(App));
    } else {
      rootEl.textContent = 'Component must export a default function named App.';
    }
  </script>
</body>
</html>`;

const MERMAID_IFRAME_TEMPLATE = (content: string) => `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
    mermaid.initialize({ startOnLoad: true, theme: 'neutral' });
  </script>
  <style>body{margin:1rem;display:flex;justify-content:center;}</style>
</head>
<body>
  <pre class="mermaid">${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
</body>
</html>`;

function buildSrcdoc(type: string, content: string): string | null {
  switch (type) {
    case 'text/html':
    case 'application/vnd.code-html':
      return content;
    case 'application/vnd.react':
    case 'application/vnd.ant.react':
      return REACT_IFRAME_TEMPLATE(content);
    case 'application/vnd.mermaid':
      return MERMAID_IFRAME_TEMPLATE(content);
    default:
      return null;
  }
}

function isPreviewable(type: string): boolean {
  return ['text/html', 'application/vnd.code-html', 'application/vnd.react',
    'application/vnd.ant.react', 'application/vnd.mermaid'].includes(type);
}

function ArtifactView({ artifact }: { artifact: ChatArtifact }) {
  const versions = artifact.versions?.length ? artifact.versions : [{ content: artifact.content, messageId: artifact.messageId, createdAt: artifact.createdAt }];
  const total = versions.length;

  const [versionIndex, setVersionIndex] = useState(total - 1);
  const [tab, setTab] = useState<PreviewTab>(isPreviewable(artifact.type) ? 'preview' : 'code');
  const iframeKey = useRef(0);

  // Reset to latest version + tab when artifact id changes
  const prevId = useRef(artifact.id);
  if (prevId.current !== artifact.id) {
    prevId.current = artifact.id;
    iframeKey.current += 1;
  }
  // Jump to latest when a new version arrives
  const prevTotal = useRef(total);
  if (prevTotal.current !== total) {
    prevTotal.current = total;
    setVersionIndex(total - 1);
    iframeKey.current += 1;
  }

  const activeVersion = versions[versionIndex] ?? versions[total - 1];
  const content = activeVersion.content;
  const canPreview = isPreviewable(artifact.type);
  const srcdoc = useMemo(() => buildSrcdoc(artifact.type, content), [artifact.type, content]);

  function goTo(idx: number) {
    setVersionIndex(idx);
    iframeKey.current += 1;
  }

  return (
    <div className="artifact-view">
      <div className="artifact-tabs" role="tablist">
        {canPreview && (
          <>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'preview'}
              className={`artifact-tab${tab === 'preview' ? ' active' : ''}`}
              onClick={() => setTab('preview')}
            >
              Preview
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'code'}
              className={`artifact-tab${tab === 'code' ? ' active' : ''}`}
              onClick={() => setTab('code')}
            >
              Code
            </button>
          </>
        )}
        <span className="artifact-tab-spacer" />
        {total > 1 && (
          <div className="artifact-version-nav" aria-label="Version navigation">
            <button
              type="button"
              className="artifact-version-btn"
              disabled={versionIndex === 0}
              onClick={() => goTo(versionIndex - 1)}
              aria-label="Previous version"
            >
              ‹
            </button>
            <span className="artifact-version-label">{versionIndex + 1} / {total}</span>
            <button
              type="button"
              className="artifact-version-btn"
              disabled={versionIndex === total - 1}
              onClick={() => goTo(versionIndex + 1)}
              aria-label="Next version"
            >
              ›
            </button>
          </div>
        )}
        <CopyButton value={content} label="Copy" size="sm" />
      </div>

      {(tab === 'preview' || !canPreview) && srcdoc ? (
        <iframe
          key={iframeKey.current}
          className="artifact-iframe"
          srcDoc={srcdoc}
          sandbox="allow-scripts"
          title={artifact.title}
        />
      ) : (
        <div className="artifact-code-wrap">
          <pre className="artifact-code">
            <code>{content}</code>
          </pre>
        </div>
      )}
    </div>
  );
}

function ArtifactPanelContent({
  active,
  artifacts,
  pinned,
  onPinChange,
  onOpenChange,
  onSelectId,
  onDelete,
}: {
  active: ChatArtifact | null;
  artifacts: ChatArtifact[];
  pinned: boolean;
  onPinChange: (v: boolean) => void;
  onOpenChange: (v: boolean) => void;
  onSelectId: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  return (
    <>
      <div className="artifact-panel-header">
        <div className="artifact-panel-header-title">
          <span className="artifact-panel-title">{active?.title ?? 'Artifact'}</span>
          {artifacts.length > 1 && (
            <div className="artifact-nav">
              {artifacts.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`artifact-nav-item${a.id === active?.id ? ' active' : ''}`}
                  onClick={() => onSelectId(a.id)}
                  title={a.title}
                >
                  {a.title}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="artifact-panel-header-actions">
          <button
            type="button"
            className={`artifact-pin-btn${pinned ? ' active' : ''}`}
            title={pinned ? 'Unpin panel' : 'Pin alongside chat'}
            onClick={() => onPinChange(!pinned)}
            aria-pressed={pinned}
          >
            📌
          </button>
          <button
            type="button"
            className="artifact-close-btn"
            title="Close"
            onClick={() => { onPinChange(false); onOpenChange(false); }}
          >
            ✕
          </button>
        </div>
      </div>

      <div className="artifact-panel-body">
        {active ? (
          <ArtifactView artifact={active} />
        ) : (
          <p className="artifact-empty">No artifacts in this conversation.</p>
        )}
      </div>

      {active && onDelete && (
        <div className="artifact-panel-footer">
          <button
            type="button"
            className="artifact-delete-btn"
            onClick={() => onDelete(active.id)}
          >
            Delete artifact
          </button>
        </div>
      )}
    </>
  );
}

export function ArtifactPanel({
  open,
  onOpenChange,
  pinned,
  onPinChange,
  artifacts,
  activeId,
  onSelectId,
  onDelete,
}: ArtifactPanelProps) {
  const active = artifacts.find((a) => a.id === activeId) ?? artifacts[0] ?? null;

  const sharedContent = (
    <ArtifactPanelContent
      active={active}
      artifacts={artifacts}
      pinned={pinned}
      onPinChange={onPinChange}
      onOpenChange={onOpenChange}
      onSelectId={onSelectId}
      onDelete={onDelete}
    />
  );

  // Pinned: rendered inline by the ChatTab layout split — no portal, no overlay.
  if (pinned) {
    return <div className="artifact-panel-inline">{sharedContent}</div>;
  }

  // Floating: portal Sheet overlay.
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={active?.title ?? 'Artifact'}
      description={
        artifacts.length > 1 ? (
          <div className="artifact-nav">
            {artifacts.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`artifact-nav-item${a.id === active?.id ? ' active' : ''}`}
                onClick={() => onSelectId(a.id)}
                title={a.title}
              >
                {a.title}
              </button>
            ))}
          </div>
        ) : undefined
      }
      headerActions={
        <button
          type="button"
          className="artifact-pin-btn"
          onClick={() => { onPinChange(true); onOpenChange(false); }}
          title="Pin alongside chat"
          aria-label="Pin alongside chat"
        >
          📌
        </button>
      }
      footer={
        active && onDelete ? (
          <div className="artifact-sheet-footer">
            <button
              type="button"
              className="artifact-delete-btn"
              onClick={() => onDelete(active.id)}
            >
              Delete
            </button>
          </div>
        ) : undefined
      }
    >
      {active ? (
        <ArtifactView artifact={active} />
      ) : (
        <p className="artifact-empty">No artifacts in this conversation.</p>
      )}
    </Sheet>
  );
}

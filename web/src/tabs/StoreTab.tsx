// Store tab — community worker catalog, detail, install + sideload. Extracted from
// App.tsx (CODE_ROADMAP Phase 1.2). Prop-driven.
import { PreviewLinkCard, Progress } from '../ui';
import {
  StoreWorkerLogo, StoreTrustBadge, HelpTip, StatusPill, formatBytes, formatDate,
  storeAuthorHandle, storeCategoryKey, storeCategoryLabel, storePaletteIndex,
} from '../app-helpers';
import type { DashboardState, StoreWorkerDetail, StoreWorkerListing } from '../app-types';

export interface StoreTabProps {
  dashboard: DashboardState;
  storeWorkers: StoreWorkerListing[] | null;
  storeLoading: boolean;
  storeError: string | null;
  storeQuery: string;
  setStoreQuery: (v: string) => void;
  storeQueryInput: string;
  setStoreQueryInput: (v: string) => void;
  storeCategoryFilter: string;
  setStoreCategoryFilter: (v: string) => void;
  storeSelectedId: string | null;
  setStoreSelectedId: (v: string | null) => void;
  storeDetail: StoreWorkerDetail | null;
  setStoreDetail: (v: StoreWorkerDetail | null) => void;
  storeDetailLoading: boolean;
  sideloadFile: File | null;
  setSideloadFile: (v: File | null) => void;
  setConsentTarget: (v: StoreWorkerDetail | null) => void;
  busyKey: string | null;
  fetchStoreCatalog: (query: string) => void | Promise<void>;
  fetchStoreDetail: (id: string) => void | Promise<void>;
  installFromStore: (worker: StoreWorkerListing) => void | Promise<void>;
  sideloadWorkerZip: () => void | Promise<void>;
  mutate: (key: string, input: RequestInfo, init: RequestInit, successMessage: string) => void | Promise<void>;
}

export function StoreTab(props: StoreTabProps) {
  const {
    dashboard, storeWorkers, storeLoading, storeError, storeQuery, setStoreQuery,
    storeQueryInput, setStoreQueryInput, storeCategoryFilter, setStoreCategoryFilter,
    storeSelectedId, setStoreSelectedId, storeDetail, setStoreDetail, storeDetailLoading,
    sideloadFile, setSideloadFile, setConsentTarget, busyKey,
    fetchStoreCatalog, fetchStoreDetail, installFromStore, sideloadWorkerZip, mutate,
  } = props;
    const STORE_URL = 'https://bfrost.net/store';
    const installedIds = new Set(dashboard.workers.map((w) => w.id));
    const categoryOptions = storeWorkers
      ? Array.from(
        storeWorkers.reduce((categories, worker) => {
          const key = storeCategoryKey(worker.category);
          if (!categories.has(key)) categories.set(key, storeCategoryLabel(worker.category));
          return categories;
        }, new Map<string, string>()),
      )
        .map(([key, label]) => ({ key, label }))
        .sort((a, b) => a.label.localeCompare(b.label))
      : [];
    const activeCategoryFilter = categoryOptions.some((category) => category.key === storeCategoryFilter)
      ? storeCategoryFilter
      : 'all';
    const filteredStoreWorkers = storeWorkers
      ? storeWorkers.filter(
        (worker) => activeCategoryFilter === 'all' || storeCategoryKey(worker.category) === activeCategoryFilter,
      )
      : [];
    const activeCategoryLabel = activeCategoryFilter === 'all'
      ? 'all categories'
      : categoryOptions.find((category) => category.key === activeCategoryFilter)?.label ?? 'this category';
    const selectedListing = storeSelectedId && storeWorkers
      ? storeWorkers.find((worker) => worker.id === storeSelectedId) ?? null
      : null;
    const selectedWorker = storeDetail ?? selectedListing;

    const openStoreWorker = (workerId: string) => {
      setStoreSelectedId(workerId);
      void fetchStoreDetail(workerId);
    };

    return (
      <section className="panel tab-page store-tab">
        {/* Header */}
        <div className="panel-head">
          <div>
            <p className="panel-kicker">Community</p>
            <h2>Worker Store <HelpTip>Browse community-built workers from bfrost.net. Search by name or category, click a card to read the details and declared permissions, then click Install to add it — no terminal needed. Installed workers appear in the Workers tab immediately.</HelpTip></h2>
          </div>
          <PreviewLinkCard
            className="store-header-link-card"
            href={STORE_URL}
            external
            title="bfrost.net/store"
            description="Open the public catalog"
          />
        </div>

        {/* Search */}
        <div className="store-catalog-tools">
          <div className="store-search-row">
            <input
              type="search"
              className="store-search-input"
              placeholder="Search workers..."
              value={storeQueryInput}
              onChange={(e) => setStoreQueryInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setStoreQuery(storeQueryInput);
              }}
              autoComplete="off"
            />
            <button type="button" className="store-search-button" onClick={() => setStoreQuery(storeQueryInput)} disabled={storeLoading}>
              {storeLoading ? 'Searching...' : 'Search'}
            </button>
            {storeQuery ? (
              <button type="button" className="store-clear-button" onClick={() => { setStoreQuery(''); setStoreQueryInput(''); }}>
                Clear
              </button>
            ) : null}
          </div>

          {categoryOptions.length > 0 ? (
            <div className="store-filter-row" aria-label="Worker categories">
              <button
                type="button"
                className={`store-filter-chip${activeCategoryFilter === 'all' ? ' active' : ''}`}
                aria-pressed={activeCategoryFilter === 'all'}
                onClick={() => setStoreCategoryFilter('all')}
              >
                All
              </button>
              {categoryOptions.map((category) => (
                <button
                  key={category.key}
                  type="button"
                  className={`store-filter-chip${activeCategoryFilter === category.key ? ' active' : ''}`}
                  aria-pressed={activeCategoryFilter === category.key}
                  onClick={() => setStoreCategoryFilter(category.key)}
                >
                  {category.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* Sideload from .zip */}
        <details className="store-sideload-section">
          <summary>Sideload a worker archive (.zip / .tar.gz)</summary>
          <div className="store-sideload-row">
            <p className="footnote">
              Install a worker someone shared with you as an archive file, without going through the
              store. The archive must contain a valid <code>worker.json</code>.
            </p>
            <input
              type="file"
              accept=".zip,.tar.gz,.tgz"
              onChange={(e) => setSideloadFile(e.target.files?.[0] ?? null)}
            />
            {sideloadFile ? (
              <div className="panel-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={busyKey === 'sideload-upload'}
                  onClick={() => void sideloadWorkerZip()}
                >
                  {busyKey === 'sideload-upload' ? 'Installing…' : `Install "${sideloadFile.name}"`}
                </button>
                <button type="button" onClick={() => setSideloadFile(null)}>Cancel</button>
              </div>
            ) : null}
          </div>
        </details>

        {/* Detail panel */}
        {storeSelectedId ? (
          <div className="store-detail-panel">
            <div className="store-detail-toolbar">
              <button type="button" className="store-back-button" onClick={() => { setStoreSelectedId(null); setStoreDetail(null); }}>
                Back to catalog
              </button>
              <PreviewLinkCard
                href={`https://bfrost.net/store/${storeSelectedId}`}
                external
                title="View on bfrost.net"
                description="Shareable public listing"
              />
            </div>

            {selectedWorker ? (
              <div className={`store-detail-hero store-palette-${storePaletteIndex(selectedWorker.category)}`}>
                <StoreWorkerLogo worker={selectedWorker} size="large" installed={installedIds.has(selectedWorker.id)} />
                <div className="store-detail-title">
                  <span className="store-category-chip">{storeCategoryLabel(selectedWorker.category)}</span>
                  <h2>{selectedWorker.name}</h2>
                  <p>{selectedWorker.tagline}</p>
                </div>
                <StoreTrustBadge trust={selectedWorker.trust} />
              </div>
            ) : null}

            {storeDetailLoading ? (
              <div className="store-detail-loading" aria-live="polite">
                <span className="store-skeleton-line wide" />
                <span className="store-skeleton-line" />
                <span className="store-skeleton-line short" />
              </div>
            ) : storeDetail ? (
              <>
                <div className="store-detail-meta">
                  <span>{storeAuthorHandle(storeDetail.author)}</span>
                  <span>v{storeDetail.latestVersion}</span>
                  {storeDetail.license ? <span>{storeDetail.license}</span> : null}
                  {storeDetail.downloadCount > 0 ? (
                    <span>{storeDetail.downloadCount.toLocaleString()} installs</span>
                  ) : null}
                </div>

                <div className="store-detail-content">
                  <section className="store-detail-section store-detail-description">
                    <h3>Description</h3>
                    <p>{storeDetail.description || storeDetail.tagline}</p>
                  </section>

                  <div className="store-detail-grid">
                    <section className="store-detail-section">
                      <h3>Permissions</h3>
                      {storeDetail.permissions.length > 0 ? (
                        <ul className="store-permission-list">
                          {storeDetail.permissions.map((permission) => <li key={permission}><code>{permission}</code></li>)}
                        </ul>
                      ) : (
                        <p className="footnote">No special permissions declared.</p>
                      )}
                    </section>

                    <section className="store-detail-section">
                      <h3>Capabilities</h3>
                      <div className="store-capabilities">
                        {storeDetail.capabilities.jobs.length > 0 ? (
                          <span>Jobs: {storeDetail.capabilities.jobs.join(', ')}</span>
                        ) : null}
                        {storeDetail.capabilities.tools.length > 0 ? (
                          <span>Tools: {storeDetail.capabilities.tools.join(', ')}</span>
                        ) : null}
                        {storeDetail.capabilities.channels.length > 0 ? (
                          <span>Channels: {storeDetail.capabilities.channels.join(', ')}</span>
                        ) : null}
                        {storeDetail.capabilities.providers.length > 0 ? (
                          <span>Providers: {storeDetail.capabilities.providers.join(', ')}</span>
                        ) : null}
                        {storeDetail.capabilities.jobs.length === 0
                          && storeDetail.capabilities.tools.length === 0
                          && storeDetail.capabilities.channels.length === 0
                          && storeDetail.capabilities.providers.length === 0 ? (
                            <span>No runtime capabilities declared.</span>
                          ) : null}
                      </div>
                    </section>
                  </div>

                  {storeDetail.versions.length > 0 ? (
                    <section className="store-detail-section">
                      <h3>Version history</h3>
                      <ol className="store-version-list">
                        {storeDetail.versions.slice(0, 5).map((version) => (
                          <li key={version.version} className={version.yanked ? 'is-yanked' : ''}>
                            <div className="store-version-head">
                              <strong>v{version.version}</strong>
                              <span>{formatDate(version.publishedAt)}</span>
                              {version.yanked ? <StatusPill tone="warning">yanked</StatusPill> : null}
                            </div>
                            {version.changelog ? <p>{version.changelog}</p> : null}
                            <span className="store-version-meta">
                              Engine {version.bfrostEngine}
                              {version.bundleSizeBytes ? ` · ${formatBytes(version.bundleSizeBytes)}` : ''}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </section>
                  ) : null}

                  <div className="store-detail-actions">
                    {busyKey === `store-install-${storeDetail.id}` ? (
                      <Progress
                        value={null}
                        label={storeDetail.builtIn ? 'Restoring worker' : 'Installing worker'}
                        tone="warning"
                      />
                    ) : null}
                    {installedIds.has(storeDetail.id) ? (() => {
                      const installedWorker = dashboard.workers.find((w) => w.id === storeDetail.id);
                      // Infrastructure built-ins (builtIn=true, not deletable) are always
                      // present; just show a badge. Deletable plugin workers show Enable/Disable.
                      if (storeDetail.builtIn && installedWorker && !installedWorker.deletable) {
                        return <span className="store-installed-callout">✓ Always included</span>;
                      }
                      const isEnabled = installedWorker?.enabled ?? false;
                      return (
                        <>
                          <span className="store-installed-callout">✓ Included</span>
                          <button
                            type="button"
                            className={isEnabled ? '' : 'primary'}
                            disabled={busyKey === `worker-${storeDetail.id}`}
                            onClick={() =>
                              void mutate(
                                `worker-${storeDetail.id}`,
                                `/api/workers/${encodeURIComponent(storeDetail.id)}`,
                                { method: 'POST', body: JSON.stringify({ enabled: !isEnabled }) },
                                `${storeDetail.name} ${isEnabled ? 'disabled' : 'enabled'}.`,
                              )
                            }
                          >
                            {busyKey === `worker-${storeDetail.id}`
                              ? (isEnabled ? 'Disabling…' : 'Enabling…')
                              : (isEnabled ? 'Disable' : 'Enable')}
                          </button>
                        </>
                      );
                    })() : storeDetail.builtIn && !storeDetail.versions?.find((v) => !v.yanked && v.bundleUrl && v.bundleSha256) ? (
                      // Infrastructure built-in with no installable bundle — should never be
                      // missing but show a safe fallback.
                      <span className="store-installed-callout">✓ Always included</span>
                    ) : (
                      <button
                        type="button"
                        className="primary store-install-button"
                        disabled={busyKey === `store-install-${storeDetail.id}`}
                        onClick={() => {
                          const version = storeDetail.versions?.find((v) => !v.yanked && v.bundleUrl && v.bundleSha256);
                          if (!version) {
                            window.open(`https://bfrost.net/store/${storeDetail.id}`, '_blank');
                            return;
                          }
                          setConsentTarget(storeDetail);
                        }}
                      >
                        {busyKey === `store-install-${storeDetail.id}`
                          ? (storeDetail.builtIn ? 'Restoring…' : 'Installing…')
                          : (storeDetail.builtIn ? 'Restore worker' : 'Install worker')}
                      </button>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="empty-state store-empty-state">
                <div className="store-empty-icon" aria-hidden="true">📦</div>
                <p>Could not load worker details.</p>
                <p className="footnote">Try returning to the catalog and opening the listing again.</p>
              </div>
            )}
          </div>
        ) : null}

        {/* Catalog */}
        {!storeSelectedId ? (
          <>
            {storeError ? (
              <div className="empty-state">
                <p>Could not reach the store.</p>
                <p className="footnote">{storeError}</p>
                <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
                  <button type="button" onClick={() => void fetchStoreCatalog(storeQuery)}>Retry</button>
                  <a href={`https://bfrost.net/store`} target="_blank" rel="noopener noreferrer">
                    Open in browser ↗
                  </a>
                </div>
              </div>
            ) : storeLoading && !storeWorkers ? (
              <div className="store-catalog-grid store-skeleton-grid" aria-label="Loading catalog">
                {[0, 1, 2].map((item) => (
                  <div key={item} className="store-card store-card-skeleton">
                    <div className="store-card-top">
                      <span className="store-logo-skeleton" />
                      <span className="store-skeleton-pill" />
                    </div>
                    <span className="store-skeleton-line wide" />
                    <span className="store-skeleton-line" />
                    <span className="store-skeleton-line short" />
                  </div>
                ))}
              </div>
            ) : storeWorkers && filteredStoreWorkers.length === 0 ? (
              <div className="empty-state store-empty-state">
                <div className="store-empty-icon" aria-hidden="true">🔍</div>
                <p>No workers found{storeQuery ? ` for "${storeQuery}"` : activeCategoryFilter !== 'all' ? ` in ${activeCategoryLabel}` : ''}.</p>
                <p className="footnote">Try a different search or another category.</p>
              </div>
            ) : storeWorkers ? (
              <div className="store-catalog-grid">
                {filteredStoreWorkers.map((worker) => (
                  <button
                    type="button"
                    key={worker.id}
                    className={`store-card store-palette-${storePaletteIndex(worker.category)}`}
                    aria-label={`View details for ${worker.name}`}
                    onClick={() => openStoreWorker(worker.id)}
                  >
                    <div className="store-card-top">
                      <StoreWorkerLogo worker={worker} installed={installedIds.has(worker.id)} />
                      <StoreTrustBadge trust={worker.trust} />
                    </div>
                    <div className="store-card-title-row">
                      <h3>{worker.name}</h3>
                      <span className="store-category-chip">{storeCategoryLabel(worker.category)}</span>
                    </div>
                    <p className="store-card-tagline">{worker.tagline}</p>
                    <div className="store-card-meta">
                      <span className="store-author-handle">{storeAuthorHandle(worker.author)}</span>
                      <span>v{worker.latestVersion}</span>
                      {worker.downloadCount > 0 ? (
                        <span>{worker.downloadCount.toLocaleString()} installs</span>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            ) : null}

            <div className="store-footer">
              <p className="footnote">
                Want to publish your own worker?{' '}
                <a href="https://bfrost.net/publish" target="_blank" rel="noopener noreferrer">
                  Submit to the store ↗
                </a>
              </p>
            </div>
          </>
        ) : null}
      </section>
    );
}

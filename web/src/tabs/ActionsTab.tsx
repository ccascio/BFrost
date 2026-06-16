// Actions tab — pending action approvals + history. Extracted from App.tsx
// (CODE_ROADMAP Phase 1.2). Receives its state/handlers as props so it carries
// no App closure coupling and is render-smoke testable.
import { Button, CopyButton, ManagementBar, Sheet } from '../ui';
import { Detail, HelpTip, StatusPill, formatDate } from '../app-helpers';
import type { ActionRequest, ActionState } from '../app-types';

export interface ActionsTabProps {
  pendingActions: ActionRequest[];
  actionHistory: ActionRequest[];
  actionsLoading: boolean;
  selectedActionId: string | null;
  setSelectedActionId: (id: string | null) => void;
  busyKey: string | null;
  decideAction: (requestId: string, approved: boolean) => void | Promise<void>;
  fetchPendingActions: () => void | Promise<void>;
}

export function ActionsTab({
  pendingActions,
  actionHistory,
  actionsLoading,
  selectedActionId,
  setSelectedActionId,
  busyKey,
  decideAction,
  fetchPendingActions,
}: ActionsTabProps) {
    const selectedAction = pendingActions.find((a) => a.id === selectedActionId) ?? null;

    return (
      <div className="tab-content actions-tab">
        <div className="panel">
          <div className="panel-header">
            <h2>
              Pending Actions
              <HelpTip>
                Workers that need to perform write operations (e.g. creating or modifying files) must
                request your approval first. Review the diff preview and approve or reject each request.
                Approved actions run immediately; rejected ones are cancelled.
              </HelpTip>
            </h2>
          </div>

          <ManagementBar
            label="Action requests"
            selectedCount={selectedAction ? 1 : 0}
            totalCount={pendingActions.length}
            filters={<StatusPill tone={actionsLoading ? 'warning' : 'muted'}>{actionsLoading ? 'Refreshing' : 'Pending only'}</StatusPill>}
            actions={
              <>
                {selectedAction ? (
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={busyKey === `action-${selectedAction.id}`}
                    onClick={() => void decideAction(selectedAction.id, true)}
                  >
                    Approve selected
                  </Button>
                ) : null}
                {selectedAction ? (
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={busyKey === `action-${selectedAction.id}`}
                    onClick={() => void decideAction(selectedAction.id, false)}
                  >
                    Reject selected
                  </Button>
                ) : null}
                <Button variant="ghost" size="sm" onClick={() => void fetchPendingActions()}>
                  Refresh
                </Button>
              </>
            }
          />

          {actionsLoading && pendingActions.length === 0 ? (
            <div className="empty-state"><p>Loading…</p></div>
          ) : pendingActions.length === 0 ? (
            <div className="empty-state">
              <p>No pending actions.</p>
              <p className="footnote">
                When a worker requests a file write or another approved-write operation, it will appear
                here for your review.
              </p>
            </div>
          ) : (
            <div className="actions-list">
              {pendingActions.map((action) => (
                <div
                  key={action.id}
                  className={`actions-item${selectedActionId === action.id ? ' selected' : ''}`}
                >
                  {/* Selectable region — opens diff preview below */}
                  <button
                    type="button"
                    className="actions-item-body"
                    aria-expanded={selectedActionId === action.id}
                    aria-label={`${action.label} from ${action.workerId} — ${selectedActionId === action.id ? 'collapse' : 'expand'} diff preview`}
                    onClick={() => setSelectedActionId(selectedActionId === action.id ? null : action.id)}
                  >
                    <div className="actions-item-header">
                      <span className="actions-item-label">{action.label}</span>
                      <span className="actions-item-worker footnote">{action.workerId}</span>
                      <StatusPill tone="warning">pending</StatusPill>
                    </div>
                    <div className="actions-item-rationale footnote">{action.rationale}</div>
                  </button>
                  <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={busyKey === `action-${action.id}`}
                      onClick={() => void decideAction(action.id, true)}
                    >
                      Approve
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={busyKey === `action-${action.id}`}
                      onClick={() => void decideAction(action.id, false)}
                    >
                      Reject
                    </Button>
                    {action.preview ? (
                      <Button
                        size="sm"
                        onClick={() => setSelectedActionId(action.id)}
                      >
                        Review diff
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <Sheet
          open={!!selectedAction?.preview}
          onOpenChange={(open) => {
            if (!open) setSelectedActionId(null);
          }}
          title={selectedAction ? `Review action: ${selectedAction.label}` : 'Review action'}
          description={selectedAction ? `${selectedAction.workerId} requested ${selectedAction.actionClass}.` : undefined}
          side="right"
          footer={selectedAction ? (
            <>
              <CopyButton value={selectedAction.preview ?? ''} label="Copy diff" size="sm" />
              <Button
                variant="danger"
                disabled={busyKey === `action-${selectedAction.id}`}
                onClick={() => void decideAction(selectedAction.id, false)}
              >
                Reject
              </Button>
              <Button
                variant="primary"
                disabled={busyKey === `action-${selectedAction.id}`}
                onClick={() => void decideAction(selectedAction.id, true)}
              >
                Approve
              </Button>
            </>
          ) : null}
        >
          {selectedAction ? (
            <div className="action-review-sheet">
              <Detail label="Rationale" value={selectedAction.rationale} />
              <Detail label="Created" value={formatDate(selectedAction.createdAt)} />
              <pre className="actions-diff">{selectedAction.preview}</pre>
            </div>
          ) : null}
        </Sheet>

        {/* ── Action history ─────────────────────────────────────────── */}
        {actionHistory.length > 0 ? (
          <div className="panel">
            <div className="panel-header">
              <h2>
                Action History
                <HelpTip>
                  The last 50 action requests across all workers, newest first.
                  Includes auto-approved reads, approved/rejected writes, and blocked requests.
                </HelpTip>
              </h2>
            </div>
            <table className="schedule-preview-table">
              <thead>
                <tr>
                  <th>Worker</th>
                  <th>Action</th>
                  <th>Class</th>
                  <th>State</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {actionHistory.map((action) => {
                  const stateTone: Record<ActionState, 'good' | 'warning' | 'info' | 'muted'> = {
                    approved: 'good',
                    executed: 'good',
                    pending: 'warning',
                    rejected: 'muted',
                    failed: 'warning',
                  };
                  return (
                    <tr key={action.id}>
                      <td className="footnote">{action.workerId}</td>
                      <td>{action.label}</td>
                      <td><code className="footnote">{action.actionClass}</code></td>
                      <td><StatusPill tone={stateTone[action.state]}>{action.state}</StatusPill></td>
                      <td className="footnote">{new Date(action.createdAt).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    );
}

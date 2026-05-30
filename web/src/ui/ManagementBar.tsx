import type { ReactNode } from 'react';

interface ManagementBarProps {
  label: ReactNode;
  selectedCount?: number;
  totalCount?: number;
  actions?: ReactNode;
  filters?: ReactNode;
  pagination?: ReactNode;
}

export function ManagementBar({
  label,
  selectedCount = 0,
  totalCount,
  actions,
  filters,
  pagination,
}: ManagementBarProps) {
  return (
    <section className="ui-management-bar" aria-label={typeof label === 'string' ? label : 'Management controls'}>
      <div className="ui-management-summary">
        <strong>{label}</strong>
        <span>
          {selectedCount > 0 ? `${selectedCount} selected` : 'No selection'}
          {typeof totalCount === 'number' ? ` / ${totalCount} total` : ''}
        </span>
      </div>
      {filters ? <div className="ui-management-filters">{filters}</div> : null}
      {actions ? <div className="ui-management-actions">{actions}</div> : null}
      {pagination ? <div className="ui-management-pagination">{pagination}</div> : null}
    </section>
  );
}

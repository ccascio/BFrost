import { useState, useEffect } from 'react';
import { Icon } from './icons';

export interface SidebarEntry<T extends string = string> {
  id: T;
  label: string;
  icon?: string;
  group: string;
  order?: number;
  count?: number;
  /** When set, this entry is an indented child of the entry with this id. */
  parentId?: T;
}

interface SidebarProps<T extends string = string> {
  entries: SidebarEntry<T>[];
  activeTab: T;
  collapsed: boolean;
  onSelect: (id: T) => void;
  onToggleCollapsed: () => void;
}

export function Sidebar<T extends string>({
  entries,
  activeTab,
  collapsed,
  onSelect,
  onToggleCollapsed,
}: SidebarProps<T>) {
  // Build the set of parent IDs (entries that have children).
  const parentIds = new Set(entries.filter((e) => e.parentId).map((e) => e.parentId!));

  // Track which parent subtrees are expanded. Default: all collapsed.
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());

  // Auto-expand the parent when the active tab is a child.
  useEffect(() => {
    const activeEntry = entries.find((e) => e.id === activeTab);
    if (activeEntry?.parentId) {
      setExpandedParents((prev) => {
        if (prev.has(activeEntry.parentId!)) return prev;
        const next = new Set(prev);
        next.add(activeEntry.parentId!);
        return next;
      });
    }
  }, [activeTab, entries]);

  function toggleExpand(parentId: string, e: React.MouseEvent) {
    e.stopPropagation();
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(parentId)) next.delete(parentId);
      else next.add(parentId);
      return next;
    });
  }

  // Entries visible: children only when their parent is expanded.
  const visibleEntries = entries.filter((entry) => {
    if (!entry.parentId) return true;
    return expandedParents.has(entry.parentId);
  });

  const groups = groupEntries(visibleEntries);

  function moveFocus(current: HTMLButtonElement, direction: 1 | -1) {
    const buttons = Array.from(
      current.closest('.sidebar-nav')?.querySelectorAll<HTMLButtonElement>('.sidebar-item') ?? [],
    );
    const index = buttons.indexOf(current);
    const next = buttons[index + direction] ?? buttons[direction === 1 ? 0 : buttons.length - 1];
    next?.focus();
  }

  return (
    <aside className="sidebar" aria-label="Dashboard navigation" data-collapsed={collapsed}>
      <div className="sidebar-brand">
        <img className="sidebar-logo" src="/bfrost-logo.jpeg" alt="BFrost" />
        <div className="sidebar-title">
          <strong>BFrost</strong>
          <span>Admin</span>
        </div>
      </div>

      <nav className="sidebar-nav" aria-label="Dashboard sections">
        {groups.map((group) => (
          <section className="sidebar-group" key={group.name}>
            <h2>{group.name}</h2>
            <div className="sidebar-group-items">
              {group.entries.map((entry) => {
                const selected = entry.id === activeTab;
                const isChild = !!entry.parentId;
                const isParent = parentIds.has(entry.id);
                const isExpanded = isParent && expandedParents.has(entry.id);

                return (
                  <button
                    className={`sidebar-item${selected ? ' active' : ''}${isChild ? ' sidebar-child' : ''}${isParent ? ' sidebar-parent' : ''}`}
                    type="button"
                    aria-current={selected ? 'page' : undefined}
                    aria-expanded={isParent ? isExpanded : undefined}
                    aria-label={collapsed ? entry.label : undefined}
                    title={collapsed ? entry.label : undefined}
                    key={entry.id}
                    onClick={(e) => {
                      if (isParent) {
                        // Toggle subtree; navigate to the parent tab too.
                        toggleExpand(entry.id, e);
                      }
                      onSelect(entry.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
                        event.preventDefault();
                        moveFocus(event.currentTarget, 1);
                      }
                      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
                        event.preventDefault();
                        moveFocus(event.currentTarget, -1);
                      }
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        if (isParent) toggleExpand(entry.id, event as unknown as React.MouseEvent);
                        onSelect(entry.id);
                      }
                    }}
                  >
                    <Icon name={entry.icon} />
                    <span className="sidebar-label">{entry.label}</span>
                    <span className="sidebar-item-end">
                      {typeof entry.count === 'number' ? <strong>{entry.count}</strong> : null}
                      {isParent && !collapsed ? (
                        <span className={`sidebar-chevron${isExpanded ? ' open' : ''}`} aria-hidden="true">
                          <Icon name="chevron-right" />
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </nav>

      <button
        className="sidebar-collapse"
        type="button"
        aria-pressed={collapsed}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        onClick={onToggleCollapsed}
      >
        <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} />
        <span>{collapsed ? 'Expand' : 'Collapse'}</span>
      </button>

      {/* Rail: thin right-edge strip that toggles the sidebar on click */}
      <button
        className="sidebar-rail"
        type="button"
        tabIndex={-1}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        onClick={onToggleCollapsed}
      />
    </aside>
  );
}

function groupEntries<T extends string>(entries: SidebarEntry<T>[]) {
  const groupOrder = new Map<string, number>();
  const groups = new Map<string, SidebarEntry<T>[]>();
  entries.forEach((entry, index) => {
    if (!groups.has(entry.group)) {
      groups.set(entry.group, []);
      groupOrder.set(entry.group, index);
    }
    groups.get(entry.group)!.push(entry);
  });

  return Array.from(groups.entries())
    .sort(([a], [b]) => (groupOrder.get(a) ?? 0) - (groupOrder.get(b) ?? 0))
    .map(([name, groupEntries]) => ({
      name,
      entries: [...groupEntries].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.label.localeCompare(b.label)),
    }));
}

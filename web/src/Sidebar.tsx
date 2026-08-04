import { useState, useEffect, type CSSProperties, type SyntheticEvent } from 'react';
import { Icon } from './icons';
import { Tooltip } from './ui';

const COLLAPSED_GROUPS_STORAGE_KEY = 'bfrost.sidebarCollapsedGroups';

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
  onOpenSettings?: () => void;
  /**
   * Preferred ordering of group headings. Groups named here render in this order;
   * any group not listed falls in afterwards in first-appearance order. The names
   * are opaque to the core shell — providers and workers supply them via their
   * manifest `menu.group`.
   */
  groupOrder?: string[];
}

export function Sidebar<T extends string>({
  entries,
  activeTab,
  collapsed,
  onSelect,
  onToggleCollapsed,
  onOpenSettings,
  groupOrder,
}: SidebarProps<T>) {
  // Build the set of parent IDs (entries that have children).
  const parentIds = new Set(entries.filter((e) => e.parentId).map((e) => e.parentId!));

  // Track which single parent subtree is expanded — accordion behavior: expanding
  // one parent (e.g. navigating into a worker's Config child) always collapses any
  // other parent that was previously open.
  const [expandedParentId, setExpandedParentId] = useState<string | null>(null);

  // Track which groups are collapsed, persisted across reloads. Storing the *collapsed*
  // names (not the open ones) means a group that appears for the first time — a newly
  // installed worker's group, or a first run with no stored state — defaults to open.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const stored = JSON.parse(window.localStorage.getItem(COLLAPSED_GROUPS_STORAGE_KEY) ?? '[]');
      return new Set(Array.isArray(stored) ? stored.filter((name): name is string => typeof name === 'string') : []);
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(COLLAPSED_GROUPS_STORAGE_KEY, JSON.stringify([...collapsedGroups]));
  }, [collapsedGroups]);

  // Auto-expand the parent when the active tab is a child — and collapse any other
  // parent that was previously expanded (accordion: only one open at a time).
  useEffect(() => {
    const activeEntry = entries.find((e) => e.id === activeTab);
    if (activeEntry?.parentId) {
      setExpandedParentId((prev) => (prev === activeEntry.parentId ? prev : activeEntry.parentId!));
    }
  }, [activeTab, entries]);

  // Auto-expand the group when the active tab is inside it.
  useEffect(() => {
    const activeEntry = entries.find((e) => e.id === activeTab);
    if (activeEntry) {
      setCollapsedGroups((prev) => {
        if (!prev.has(activeEntry.group)) return prev;
        const next = new Set(prev);
        next.delete(activeEntry.group);
        return next;
      });
    }
  }, [activeTab, entries]);

  function toggleGroup(groupName: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupName)) next.delete(groupName);
      else next.add(groupName);
      return next;
    });
  }

  function toggleExpand(parentId: string, e: SyntheticEvent) {
    e.stopPropagation();
    setExpandedParentId((prev) => (prev === parentId ? null : parentId));
  }

  // Entries visible: children only when their parent is the single expanded one.
  const visibleEntries = entries.filter((entry) => {
    if (!entry.parentId) return true;
    return expandedParentId === entry.parentId;
  });

  const groups = groupEntries(visibleEntries, groupOrder);
  let globalItemIdx = 0;

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
        {groups.map((group) => {
          const isSingleEntryGroup = group.entries.length === 1;
          const groupCollapsed = !isSingleEntryGroup && !collapsed && collapsedGroups.has(group.name);
          return (
          <section className="sidebar-group" key={group.name}>
            {!isSingleEntryGroup && (
              <button
                className={`sidebar-group-heading${groupCollapsed ? '' : ' open'}`}
                type="button"
                aria-expanded={!groupCollapsed}
                onClick={() => !collapsed && toggleGroup(group.name)}
              >
                {group.name}
                {!collapsed && (
                  <span className={`sidebar-group-chevron${groupCollapsed ? '' : ' open'}`} aria-hidden="true">
                    <Icon name="chevron-right" />
                  </span>
                )}
              </button>
            )}
            <div className={`sidebar-group-items-wrap${groupCollapsed ? ' collapsed' : ''}`}>
            <div className="sidebar-group-items">
              {group.entries.map((entry, entryIndex) => {
                const selected = entry.id === activeTab;
                const isChild = !!entry.parentId;
                const isParent = parentIds.has(entry.id);
                const isExpanded = isParent && expandedParentId === entry.id;
                const itemIdx = globalItemIdx++;

                const itemStyle: CSSProperties = {
                  '--item-idx': Math.min(itemIdx, 12),
                  ...(isChild ? { animationDelay: `${Math.min(entryIndex, 6) * 24}ms` } : {}),
                } as CSSProperties;

                const item = (
                  <button
                    className={`sidebar-item${selected ? ' active' : ''}${isChild ? ' sidebar-child' : ''}${isParent ? ' sidebar-parent' : ''}`}
                    type="button"
                    aria-current={selected ? 'page' : undefined}
                    aria-expanded={isParent ? isExpanded : undefined}
                    aria-label={collapsed ? entry.label : undefined}
                    key={entry.id}
                    style={itemStyle}
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
                        if (isParent) toggleExpand(entry.id, event);
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

                return collapsed ? (
                  <Tooltip key={entry.id} content={entry.label} side="right">
                    {item}
                  </Tooltip>
                ) : item;
              })}
            </div>
            </div>
          </section>
          );
        })}
      </nav>

      {onOpenSettings && (() => {
        const btn = (
          <button
            className="sidebar-settings"
            type="button"
            aria-label="Settings"
            onClick={onOpenSettings}
          >
            <Icon name="config" />
            <span className="sidebar-label">Settings</span>
          </button>
        );
        return collapsed
          ? <Tooltip content="Settings" side="right">{btn}</Tooltip>
          : btn;
      })()}

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

function groupEntries<T extends string>(entries: SidebarEntry<T>[], preferredOrder?: string[]) {
  const appearance = new Map<string, number>();
  const groups = new Map<string, SidebarEntry<T>[]>();
  entries.forEach((entry, index) => {
    if (!groups.has(entry.group)) {
      groups.set(entry.group, []);
      appearance.set(entry.group, index);
    }
    groups.get(entry.group)!.push(entry);
  });

  // Groups listed in `preferredOrder` sort first in that order; the rest keep
  // their first-appearance order, sequenced after the named groups.
  const preferredIndex = new Map((preferredOrder ?? []).map((name, idx) => [name, idx]));
  const rank = (name: string): number => {
    const explicit = preferredIndex.get(name);
    if (explicit !== undefined) return explicit;
    return (preferredOrder?.length ?? 0) + (appearance.get(name) ?? 0);
  };

  return Array.from(groups.entries())
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([name, groupEntries]) => {
      const entryIds = new Set(groupEntries.map((entry) => entry.id));
      const childrenByParent = new Map<T, SidebarEntry<T>[]>();
      const roots: SidebarEntry<T>[] = [];

      for (const entry of groupEntries) {
        if (entry.parentId && entryIds.has(entry.parentId)) {
          const children = childrenByParent.get(entry.parentId) ?? [];
          children.push(entry);
          childrenByParent.set(entry.parentId, children);
        } else {
          roots.push(entry);
        }
      }

      const sortEntries = (items: SidebarEntry<T>[]) =>
        items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.label.localeCompare(b.label));

      return {
        name,
        entries: sortEntries(roots).flatMap((entry) => [
          entry,
          ...sortEntries(childrenByParent.get(entry.id) ?? []),
        ]),
      };
    });
}

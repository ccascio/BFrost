import { Icon } from './icons';

export interface SidebarEntry<T extends string = string> {
  id: T;
  label: string;
  icon?: string;
  group: string;
  order?: number;
  count?: number;
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
  const groups = groupEntries(entries);

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
                return (
                  <button
                    className={`sidebar-item${selected ? ' active' : ''}`}
                    type="button"
                    aria-current={selected ? 'page' : undefined}
                    aria-label={collapsed ? entry.label : undefined}
                    title={collapsed ? entry.label : undefined}
                    key={entry.id}
                    onClick={() => onSelect(entry.id)}
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
                        onSelect(entry.id);
                      }
                    }}
                  >
                    <Icon name={entry.icon} />
                    <span className="sidebar-label">{entry.label}</span>
                    {typeof entry.count === 'number' ? <strong>{entry.count}</strong> : null}
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

import type { SVGProps } from 'react';

export type IconKey =
  | 'actions'
  | 'activity'
  | 'article'
  | 'channels'
  | 'chat'
  | 'chevron-left'
  | 'chevron-right'
  | 'config'
  | 'health'
  | 'jobs'
  | 'megaphone'
  | 'newspaper'
  | 'overview'
  | 'store'
  | 'workers'
  | 'search'
  | 'system';

type IconComponent = (props: SVGProps<SVGSVGElement>) => JSX.Element;

const baseProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} satisfies SVGProps<SVGSVGElement>;

const icons: Record<IconKey, IconComponent> = {
  actions: (props) => (
    <svg {...baseProps} {...props}>
      <path d="M9 3H5a2 2 0 0 0-2 2v4" />
      <path d="M9 21H5a2 2 0 0 1-2-2v-4" />
      <path d="M15 3h4a2 2 0 0 1 2 2v4" />
      <path d="M15 21h4a2 2 0 0 0 2-2v-4" />
      <path d="M9 12h6" />
      <path d="m15 9 3 3-3 3" />
    </svg>
  ),
  activity: (props) => (
    <svg {...baseProps} {...props}>
      <path d="M4 13h4l2-7 4 12 2-5h4" />
    </svg>
  ),
  channels: (props) => (
    <svg {...baseProps} {...props}>
      <path d="M4.93 4.93a10 10 0 0 1 14.14 0" />
      <path d="M7.76 7.76a6 6 0 0 1 8.49 0" />
      <path d="M10.59 10.59a2 2 0 0 1 2.83 0" />
      <circle cx="12" cy="14" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  article: (props) => (
    <svg {...baseProps} {...props}>
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v5h5" />
      <path d="M9 12h6" />
      <path d="M9 16h6" />
    </svg>
  ),
  chat: (props) => (
    <svg {...baseProps} {...props}>
      <path d="M5 6.5A3.5 3.5 0 0 1 8.5 3h7A3.5 3.5 0 0 1 19 6.5v4a3.5 3.5 0 0 1-3.5 3.5H11l-5 4v-4.2A3.5 3.5 0 0 1 5 11z" />
    </svg>
  ),
  'chevron-left': (props) => (
    <svg {...baseProps} {...props}>
      <path d="m15 18-6-6 6-6" />
    </svg>
  ),
  'chevron-right': (props) => (
    <svg {...baseProps} {...props}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  ),
  config: (props) => (
    <svg {...baseProps} {...props}>
      <path d="M5 7h14" />
      <path d="M8 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
      <path d="M5 17h14" />
      <path d="M16 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
    </svg>
  ),
  health: (props) => (
    <svg {...baseProps} {...props}>
      <path d="M4 13h4l2-7 4 12 2-5h4" />
      <circle cx="12" cy="20" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  jobs: (props) => (
    <svg {...baseProps} {...props}>
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <path d="M3 6h.01" />
      <path d="M3 12h.01" />
      <path d="M3 18h.01" />
    </svg>
  ),
  megaphone: (props) => (
    <svg {...baseProps} {...props}>
      <path d="M4 13V9h4l9-4v12l-9-4z" />
      <path d="m8 13 1.5 5h3" />
      <path d="M19 9.5a3 3 0 0 1 0 3" />
    </svg>
  ),
  newspaper: (props) => (
    <svg {...baseProps} {...props}>
      <path d="M4 5h13a3 3 0 0 1 3 3v10a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2z" />
      <path d="M17 5v12a2 2 0 0 1-2 2" />
      <path d="M7 9h6" />
      <path d="M7 13h7" />
      <path d="M7 16h4" />
    </svg>
  ),
  overview: (props) => (
    <svg {...baseProps} {...props}>
      <path d="M4 13h7V4H4z" />
      <path d="M13 20h7V4h-7z" />
      <path d="M4 20h7v-5H4z" />
    </svg>
  ),
  workers: (props) => (
    <svg {...baseProps} {...props}>
      <path d="M8 7V4" />
      <path d="M16 7V4" />
      <path d="M7 10h10v3a5 5 0 0 1-10 0z" />
      <path d="M12 18v3" />
    </svg>
  ),
  search: (props) => (
    <svg {...baseProps} {...props}>
      <circle cx="11" cy="11" r="6" />
      <path d="m16 16 4 4" />
    </svg>
  ),
  store: (props) => (
    <svg {...baseProps} {...props}>
      <path d="M4 9V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3" />
      <path d="M2 9h20v2a5 5 0 0 1-5 5H7A5 5 0 0 1 2 11Z" />
      <path d="M12 16v5" />
      <path d="M8 21h8" />
    </svg>
  ),
  system: (props) => (
    <svg {...baseProps} {...props}>
      <rect x="4" y="5" width="16" height="12" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
    </svg>
  ),
};

export function Icon({ name, className }: { name?: string; className?: string }) {
  const Component = icons[(name as IconKey) || 'workers'] ?? icons.workers;
  return <Component className={className ?? 'icon'} />;
}

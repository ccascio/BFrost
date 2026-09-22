import type { CSSProperties, ReactNode } from 'react';

/**
 * Loading placeholders.
 *
 * The dashboard loads in two passes: `/api/dashboard` returns the shell, then each
 * section (`workerData`, `queue`, `events`, `pipelineStages`, …) arrives on its own
 * request. Between the two the shell renders with seeded-empty sections, so a panel
 * that is merely *waiting* looks identical to one that is genuinely empty — zeros,
 * em-dashes, and "nothing here yet" copy. These primitives fill that window with a
 * shape that reads as "data is on its way" instead.
 *
 * Everything here is worker-agnostic: shapes only, no knowledge of what fills them.
 */

export interface SkeletonProps {
  /** CSS width — number is read as `rem`, string passes through. Defaults to 100%. */
  width?: number | string;
  /** CSS height — number is read as `rem`, string passes through. */
  height?: number | string;
  /** `text` is a rounded bar, `block` a soft-cornered panel, `circle` an avatar dot. */
  variant?: 'text' | 'block' | 'circle';
  className?: string;
  style?: CSSProperties;
}

function toLength(value: number | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'number' ? `${value}rem` : value;
}

/** A single shimmering placeholder shape. */
export function Skeleton({ width, height, variant = 'text', className, style }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={`skeleton skeleton--${variant}${className ? ` ${className}` : ''}`}
      style={{ width: toLength(width), height: toLength(height), ...style }}
    />
  );
}

export interface SkeletonTextProps {
  /** How many bars to draw. */
  lines?: number;
  /** Width of every line except the last, which is deliberately shorter. */
  width?: number | string;
  className?: string;
}

/** A paragraph-shaped run of bars, last line short so it reads as prose. */
export function SkeletonText({ lines = 3, width = '100%', className }: SkeletonTextProps) {
  return (
    <span aria-hidden="true" className={`skeleton-stack${className ? ` ${className}` : ''}`}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} width={index === lines - 1 ? '58%' : width} />
      ))}
    </span>
  );
}

export interface SkeletonRowsProps {
  /** How many list rows to draw. */
  rows?: number;
  /** Draw a leading circle (avatar / ticker badge) on each row. */
  lead?: boolean;
  /** Draw a right-aligned value column on each row. */
  trailing?: boolean;
  className?: string;
}

/** Repeated list rows, matching the `identity · body · value` shape used across panels. */
export function SkeletonRows({ rows = 3, lead = false, trailing = true, className }: SkeletonRowsProps) {
  return (
    <div aria-hidden="true" className={`skeleton-rows${className ? ` ${className}` : ''}`}>
      {Array.from({ length: rows }, (_, index) => (
        <div className="skeleton-row" key={index}>
          {lead ? <Skeleton variant="circle" width={2} height={2} /> : null}
          <div className="skeleton-row__body">
            <Skeleton width={`${68 - index * 6}%`} height="0.72rem" />
            <Skeleton width={`${46 - index * 4}%`} height="0.6rem" />
          </div>
          {trailing ? (
            <div className="skeleton-row__value">
              <Skeleton width="3.4rem" height="0.72rem" />
              <Skeleton width="2.2rem" height="0.6rem" />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export interface SkeletonRegionProps {
  /** Announced to screen readers while the placeholder is up. */
  label: string;
  children: ReactNode;
  /**
   * Pass the layout class of the container being stood in for (a grid or flex class)
   * so the placeholder occupies the same box and nothing reflows when data lands.
   * `.skeleton-region` sets no `display` of its own precisely so this wins.
   */
  className?: string;
  style?: CSSProperties;
}

/**
 * Wraps placeholders in a busy region. The shapes themselves are `aria-hidden`, so
 * this is what tells assistive tech that something is loading rather than missing.
 */
export function SkeletonRegion({ label, children, className, style }: SkeletonRegionProps) {
  return (
    <div
      className={`skeleton-region${className ? ` ${className}` : ''}`}
      style={style}
      aria-busy="true"
      role="status"
    >
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

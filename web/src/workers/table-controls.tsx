import { useState, type ReactNode } from 'react';

export type TableSortDirection = 'asc' | 'desc';

export interface TableSortState<Key extends string> {
  column: Key;
  direction: TableSortDirection;
}

type SortValue = boolean | number | string | null | undefined;

/**
 * Keeps sorting interactions consistent across independently authored worker
 * dashboards without the host needing to know anything about their data.
 */
export function useTableSort<Key extends string>(initial: TableSortState<Key>) {
  const [sort, setSort] = useState<TableSortState<Key>>(initial);

  function toggleSort(column: Key) {
    setSort((current) => (
      current.column === column
        ? { column, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { column, direction: 'asc' }
    ));
  }

  // `setSort` is for controls that name a direction outright: a "newest first" picker cannot
  // express itself through a toggle, whose direction depends on which column is already sorted.
  return { sort, setSort, toggleSort };
}

export function sortTableRows<Row, Key extends string>(
  rows: readonly Row[],
  sort: TableSortState<Key>,
  valueFor: (row: Row, column: Key) => SortValue,
): Row[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const leftValue = valueFor(left.row, sort.column);
      const rightValue = valueFor(right.row, sort.column);
      const leftMissing = leftValue === null || leftValue === undefined || leftValue === '';
      const rightMissing = rightValue === null || rightValue === undefined || rightValue === '';

      if (leftMissing || rightMissing) {
        if (leftMissing && rightMissing) return left.index - right.index;
        return leftMissing ? 1 : -1;
      }

      const comparison = typeof leftValue === 'number' && typeof rightValue === 'number'
        ? leftValue - rightValue
        : String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true, sensitivity: 'base' });
      return (sort.direction === 'asc' ? comparison : -comparison) || left.index - right.index;
    })
    .map(({ row }) => row);
}

/**
 * Grid-layout sibling of SortableTableHeader for dashboards that render tables as
 * CSS grids (`role="table"` over divs/spans) instead of a real `<table>`. Emits a
 * `<span role="columnheader">` so it can sit directly inside a grid head row.
 */
export function SortableGridHeader<Key extends string>({
  column,
  label,
  sort,
  onSort,
  className,
}: {
  column: Key;
  label: ReactNode;
  sort: TableSortState<Key>;
  onSort: (column: Key) => void;
  className?: string;
}) {
  const isActive = sort.column === column;
  const direction = isActive ? sort.direction : undefined;
  const symbol = direction === 'asc' ? '↑' : direction === 'desc' ? '↓' : '↕';

  return (
    <span className={className} role="columnheader" aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}>
      <button
        type="button"
        className="BFrost-sortable-table-header"
        onClick={() => onSort(column)}
        aria-label={`Sort by ${typeof label === 'string' ? label : 'this column'}${direction ? `, currently ${direction === 'asc' ? 'ascending' : 'descending'}` : ''}`}
      >
        <span>{label}</span>
        <span className="BFrost-sortable-table-header__indicator" aria-hidden="true">{symbol}</span>
      </button>
    </span>
  );
}

export function SortableTableHeader<Key extends string>({
  column,
  label,
  sort,
  onSort,
  className,
}: {
  column: Key;
  label: ReactNode;
  sort: TableSortState<Key>;
  onSort: (column: Key) => void;
  className?: string;
}) {
  const isActive = sort.column === column;
  const direction = isActive ? sort.direction : undefined;
  const symbol = direction === 'asc' ? '↑' : direction === 'desc' ? '↓' : '↕';

  return (
    <th className={className} aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}>
      <button
        type="button"
        className="BFrost-sortable-table-header"
        onClick={() => onSort(column)}
        aria-label={`Sort by ${typeof label === 'string' ? label : 'this column'}${direction ? `, currently ${direction === 'asc' ? 'ascending' : 'descending'}` : ''}`}
      >
        <span>{label}</span>
        <span className="BFrost-sortable-table-header__indicator" aria-hidden="true">{symbol}</span>
      </button>
    </th>
  );
}

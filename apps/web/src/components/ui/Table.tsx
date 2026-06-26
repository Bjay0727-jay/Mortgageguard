"use client";

import { cn } from "./cn";

export interface Column<T> {
  /** Stable key for React + default cell accessor. */
  key: string;
  header: React.ReactNode;
  /** Custom cell renderer; defaults to `String(row[key])`. */
  render?: (row: T, index: number) => React.ReactNode;
  /** Extra classes for the cell/header (e.g. text alignment, width). */
  className?: string;
  /** Hide this column in the stacked mobile card layout. */
  hideOnMobile?: boolean;
}

export interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  emptyState?: React.ReactNode;
  caption?: string;
  className?: string;
}

function cell<T>(col: Column<T>, row: T, index: number): React.ReactNode {
  if (col.render) return col.render(row, index);
  return String((row as Record<string, unknown>)[col.key] ?? "");
}

/**
 * Responsive data table.
 *  - md+ : a real <table> inside a horizontally-scrollable container.
 *  - <md : each row collapses to a label/value card.
 */
export function Table<T>({ columns, data, rowKey, onRowClick, emptyState, caption, className }: TableProps<T>) {
  if (data.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  const interactive = !!onRowClick;
  const rowProps = (row: T) =>
    interactive
      ? {
          onClick: () => onRowClick!(row),
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onRowClick!(row);
            }
          },
          tabIndex: 0,
          role: "button",
          className: "cursor-pointer",
        }
      : {};

  return (
    <div className={className}>
      {/* Desktop / tablet: scrollable table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr className="border-b border-[var(--gray-200)] text-left">
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={cn("px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[var(--gray-500)]", col.className)}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr
                key={rowKey(row, i)}
                {...rowProps(row)}
                className={cn(
                  "border-b border-[var(--gray-100)] hover:bg-[var(--gray-50)]",
                  interactive && "cursor-pointer focus:bg-[var(--royal-pl)] focus:outline-none",
                )}
              >
                {columns.map((col) => (
                  <td key={col.key} className={cn("px-4 py-3 text-[var(--gray-800)]", col.className)}>
                    {cell(col, row, i)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: stacked cards */}
      <ul className="space-y-3 md:hidden">
        {data.map((row, i) => (
          <li
            key={rowKey(row, i)}
            {...rowProps(row)}
            className={cn(
              "rounded-[var(--radius-lg)] border border-[var(--gray-200)] bg-white p-4 shadow-[var(--shadow-xs)]",
              interactive && "cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--royal-lt)]",
            )}
          >
            {columns
              .filter((c) => !c.hideOnMobile)
              .map((col) => (
                <div key={col.key} className="flex items-start justify-between gap-3 py-1">
                  <span className="text-xs font-medium uppercase tracking-wide text-[var(--gray-500)]">{col.header}</span>
                  <span className="text-right text-sm text-[var(--gray-800)]">{cell(col, row, i)}</span>
                </div>
              ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

import type { SortColumn } from 'react-data-grid';
import { cardRankOrder, cardTypeOrder } from '../model';

export type SortValue = string | number | null | undefined;
export type SortKind = 'text' | 'number' | 'date' | 'rank' | 'type';
const japanese = new Intl.Collator('ja', { numeric: true, sensitivity: 'accent' });
const text = (value: SortValue) => String(value ?? '').normalize('NFKC').trim();
const blank = (value: SortValue) => value == null || text(value) === '';

/** Empty cells stay at the bottom in both directions. */
export function compareSheetValues(a: SortValue, b: SortValue, direction: SortColumn['direction'], kind: SortKind = 'text'): number {
  const emptyA = blank(a), emptyB = blank(b);
  if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1;
  let result: number;
  if (kind === 'number' || kind === 'date') {
    const first = kind === 'number' ? Number(a) : Date.parse(text(a).replaceAll('/', '-'));
    const second = kind === 'number' ? Number(b) : Date.parse(text(b).replaceAll('/', '-'));
    result = Number.isFinite(first) && Number.isFinite(second) ? first - second : japanese.compare(text(a), text(b));
  } else if (kind === 'rank') {
    // ASC goes from low to high, so a first DESC click puts SS at the top.
    const first = cardRankOrder(text(a)), second = cardRankOrder(text(b));
    if (first > 5 || second > 5) return first === second ? (direction === 'DESC' ? -1 : 1) * japanese.compare(text(a), text(b)) : first > 5 ? 1 : -1;
    result = second - first;
  } else if (kind === 'type') {
    result = cardTypeOrder(text(a)) - cardTypeOrder(text(b)) || japanese.compare(text(a), text(b));
  } else result = japanese.compare(text(a), text(b));
  return direction === 'DESC' ? -result : result;
}

/** Sort the whole dataset before selecting the lazy-loading/virtualized window. */
export function sortSheetRows<T>(rows: readonly T[], columns: readonly SortColumn[], value: (row: T, key: string) => SortValue, kind: (key: string) => SortKind = () => 'text', tie: (a: T, b: T) => number = () => 0): T[] {
  if (!columns.length) return [...rows];
  return [...rows].sort((a, b) => {
    for (const column of columns) {
      const result = compareSheetValues(value(a, column.columnKey), value(b, column.columnKey), column.direction, kind(column.columnKey));
      if (result) return result;
    }
    return tie(a, b);
  });
}

export function recordSortKind(key: string): SortKind {
  if (key === 'rank') return 'rank';
  if (key === 'card_type') return 'type';
  if (['joined_year', 'fiscal_year', 'rank_value', 'final_score'].includes(key)) return 'number';
  if (['start_date', 'end_date', 'at'].includes(key)) return 'date';
  return 'text';
}
export const compareSheetText = (a: string, b: string) => japanese.compare(text(a), text(b));

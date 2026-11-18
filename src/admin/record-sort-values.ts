import type { EventRow, LinkRow, ParticipationRow, PersonRow } from '../database';
import { compareCards } from '../model';
import { recordValues, type RecordCells } from './bulk-records';
import { mergeRows, type CardSummary, type Directory, type PreviewCard, type PreviewStore, type Sheet } from './model';

export function compareRecordCards(a: CardSummary, b: CardSummary, edits: Record<string, RecordCells> = {}) {
  const current = (row: CardSummary) => ({ ...row, name: edits[row.id]?.name ?? row.name, rank: edits[row.id]?.rank ?? row.rank, card_type: edits[row.id]?.card_type ?? row.card_type });
  return compareCards(current(a), current(b));
}

export function recordSortValues(sheet: Sheet, rows: readonly (CardSummary | PersonRow | EventRow)[], directory: Directory, store: PreviewStore, details: { relations: ParticipationRow[]; links: LinkRow[] }, names: ReadonlyMap<string, string>, textValues: Record<string, Record<string, string>> = {}) {
  const relations = mergeRows(mergeRows(directory.masters, Object.fromEntries(details.relations.map(row => [row.id, row]))), store.relations, store.removedRelations);
  const links = mergeRows(details.links, store.links, store.removedLinks);
  const relationGroups = new Map<string, ParticipationRow[]>(), linkGroups = new Map<string, LinkRow[]>();
  for (const relation of relations) {
    const id = sheet === 'people' ? relation.person_id : relation.event_id;
    const group = relationGroups.get(id); if (group) group.push(relation); else relationGroups.set(id, [relation]);
  }
  for (const link of links) {
    const id = sheet === 'people' ? link.person_id : !link.person_id ? link.event_id : null;
    if (id) { const group = linkGroups.get(id); if (group) group.push(link); else linkGroups.set(id, [link]); }
  }
  return new Map(rows.map(row => {
    const values: RecordCells = recordValues(sheet, { row: row as PreviewCard | PersonRow | EventRow, relations: relationGroups.get(row.id) ?? [], links: linkGroups.get(row.id) ?? [] }, names);
    for (const [key, records] of Object.entries(textValues)) values[key] = sheet === 'cards' && store.cards[row.id] ? String((store.cards[row.id] as unknown as Record<string, unknown>)[key] ?? '') : records[row.id] ?? '';
    if (sheet === 'cards') values.event_id = names.get(values.event_id) ?? values.event_id;
    return [row.id, values] as const;
  }));
}

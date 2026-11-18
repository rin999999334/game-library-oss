import type { EventRow, LinkRow, ParticipationRow, PersonRow } from '../database';
import { safeExternalUrl, normaliseSearch } from '../model';
import Papa from 'papaparse';
import { makeChangeEntry, type ChangeSnapshot } from './history';
import { cardTypes, changedLinks, linkCategory, mergeRows, normaliseLink, validateEditor, type Directory, type PreviewCard, type PreviewStore, type Sheet } from './model';
import { changedParticipations, convertParticipationKind } from './participation-edits';

export type RecordCells = Record<string, string>;
export type RecordBaseline = ChangeSnapshot & { values: RecordCells; isNew: boolean };
export type RecordEdit = { id: string; values: RecordCells; image?: Blob; removeImage?: boolean };
export type InputColumn = { key: string; label: string; kind?: 'image' | 'number' | 'date' | 'long' | 'choice'; choices?: readonly string[]; aliases?: string[] };
export const inputColumns: Record<Sheet, InputColumn[]> = {
  cards: [
    { key: 'event_id', label: '所属ゲーム', aliases: ['ゲーム', 'game', 'event', 'event_id'] },
    { key: 'imageUrl', label: '画像', kind: 'image', aliases: ['画像URL', 'image', 'image_url'] },
    { key: 'source_card_id', label: 'ID', aliases: ['カードID', 'source_card_id'] },
    { key: 'name', label: '名前', aliases: ['カード名', 'name'] },
    { key: 'rank', label: 'ランク', kind: 'choice', choices: ['SS', 'S', 'A', 'B', 'C', 'D'], aliases: ['rank'] },
    { key: 'card_type', label: 'タイプ', kind: 'choice', choices: cardTypes, aliases: ['type', 'card_type'] },
    { key: 'effect_text', label: '効果', kind: 'long', aliases: ['effect', 'effect_text'] },
    { key: 'flavor_text', label: 'カードフレーバー', kind: 'long', aliases: ['フレーバー', 'flavor', 'flavor_text'] },
  ],
  people: [
    { key: 'display_name', label: '名前', aliases: ['name', 'display_name'] },
    { key: 'joined_year', label: '入学年', kind: 'number', aliases: ['入学', 'joined_year'] },
    { key: 'x', label: 'Twitter / X', aliases: ['twitter', 'X', 'twitter_url'] },
    { key: 'blog', label: 'ブログ', aliases: ['blog', 'blog_url'] },
    { key: 'event_ids', label: '参加ゲーム', aliases: ['ゲーム', 'games', '参加ゲームID'] },
  ],
  games: [
    { key: 'imageUrl', label: '画像', kind: 'image', aliases: ['画像URL', 'image', 'image_url'] },
    { key: 'name', label: 'ゲーム名', aliases: ['名前', 'name'] },
    { key: 'fiscal_year', label: '開催年', kind: 'number', aliases: ['year', 'fiscal_year'] },
    { key: 'start_date', label: '開始日', kind: 'date', aliases: ['start_date'] },
    { key: 'end_date', label: '終了日', kind: 'date', aliases: ['end_date'] },
    { key: 'schedule_note', label: '期間の補足', aliases: ['開催期間', 'note', 'schedule_note'] },
    { key: 'master_ids', label: 'マスター', aliases: ['masters', 'マスターID'] },
    { key: 'blog', label: 'ブログ', aliases: ['blog', 'blog_url', 'ブログURL'] },
    { key: 'board', label: '掲示板', aliases: ['board', 'bbs', 'board_url', '掲示板URL'] },
    { key: 'x', label: 'Twitter / X', aliases: ['twitter', 'X', 'twitter_url', 'XURL'] },
  ],
};
const nullable = (value: string) => value.trim() ? value : null;
class RecordFieldError extends Error { constructor(readonly field: string, message: string) { super(message); } }
export function createBlankRecord(sheet: Sheet, gameId = '', id: string = crypto.randomUUID()): RecordBaseline {
  const row = sheet === 'cards' ? { id, event_id: gameId, name: '', source_card_id: null, source_type: null, card_type: null, rank: null, effect_text: null, flavor_text: null, publication_status: 'draft', created_at: new Date().toISOString(), imageUrl: '' } satisfies PreviewCard
    : sheet === 'people' ? { id, display_name: '', code_name: null, joined_year: null } satisfies PersonRow
      : { id, name: '', fiscal_year: null, start_date: null, end_date: null, schedule_note: null, status: null, theme: null } satisfies EventRow;
  const baseline: RecordBaseline = { row, relations: [], links: [], values: {}, isNew: true };
  baseline.values = recordValues(sheet, baseline, new Map());
  if (sheet === 'people') baseline.values.event_ids = gameId;
  return baseline;
}
export function recordValues(sheet: Sheet, snapshot: ChangeSnapshot, names: ReadonlyMap<string, string>, gameImageUrl = ''): RecordCells {
  const row = snapshot.row as unknown as Record<string, unknown>;
  const values = Object.fromEntries(inputColumns[sheet].map(column => [column.key, row[column.key] == null ? '' : String(row[column.key])]));
  if (sheet === 'people') {
    values.x = snapshot.links.find(link => linkCategory(link) === 'x')?.url ?? '';
    values.blog = snapshot.links.find(link => linkCategory(link) === 'blog')?.url ?? '';
    values.event_ids = [...new Set(snapshot.relations.map(rel => rel.event_id))].map(id => names.get(id) ?? id).join(' ; ');
  } else if (sheet === 'games') {
    values.imageUrl = gameImageUrl;
    values.master_ids = [...new Set(snapshot.relations.filter(rel => rel.kind === 'master').map(rel => rel.person_id))].map(id => names.get(id) ?? id).join(' ; ');
    for (const category of ['blog', 'board', 'x'] as const) values[category] = snapshot.links.find(link => linkCategory(link) === category)?.url ?? '';
  }
  return values;
}
export function personPasteBaseline(id: string, directory: Directory, store: PreviewStore, fetched: { links: LinkRow[]; relations: ParticipationRow[] }, names: ReadonlyMap<string, string>): RecordBaseline | null {
  const row = store.people[id] ?? directory.people.find(person => person.id === id);
  if (!row) return null;
  const snapshot = { row, links: mergeRows(fetched.links, store.links, store.removedLinks).filter(link => link.person_id === id), relations: mergeRows(fetched.relations, store.relations, store.removedRelations).filter(relation => relation.person_id === id) };
  return { ...snapshot, isNew: false, values: recordValues('people', snapshot, names) };
}
export function gamePasteBaseline(id: string, directory: Directory, store: PreviewStore, fetched: ParticipationRow[], names: ReadonlyMap<string, string>, imageUrl = '', fetchedLinks: LinkRow[] = []): RecordBaseline | null {
  const row = store.games[id] ?? directory.games.find(game => game.id === id);
  if (!row) return null;
  const snapshot = { row, links: mergeRows(fetchedLinks, store.links, store.removedLinks).filter(link => link.event_id === id && !link.person_id), relations: mergeRows(fetched, store.relations, store.removedRelations).filter(relation => relation.event_id === id) };
  return { ...snapshot, isNew: false, values: recordValues('games', snapshot, names, store.gameImageUrls[id] ?? imageUrl) };
}
export function hasRecordChanges(before: RecordBaseline, edit: RecordEdit) {
  if (edit.image || edit.removeImage) return true;
  if (before.isNew) return Object.entries(edit.values).some(([key, value]) => !['event_id', 'event_ids'].includes(key) && value.trim());
  return Object.keys(edit.values).some(key => edit.values[key] !== before.values[key]);
}
export type RecordIssue = { id: string; field: string; message: string };
export class RecordBulkValidationError extends Error {
  constructor(readonly issues: RecordIssue[]) { super(`${issues.length}件の入力を確認してください。${issues[0]?.message ?? ''}`); this.name = 'RecordBulkValidationError'; }
}
function resolveOne(value: string, choices: { id: string; name: string }[], label: string) {
  const trimmed = value.trim(), direct = choices.find(choice => choice.id === trimmed);
  if (direct) return direct.id;
  const matches = choices.filter(choice => normaliseSearch(choice.name) === normaliseSearch(trimmed));
  if (matches.length === 1) return matches[0].id;
  throw new Error(matches.length > 1 ? `${label}「${trimmed}」は同名の記録があります。識別子で指定してください。` : `${label}「${trimmed}」が見つかりません。`);
}
export function gameReferenceId(value: string, games: readonly EventRow[]) { return resolveOne(value, games.map(game => ({ id: game.id, name: game.name })), 'ゲーム'); }
function resolveMany(value: string, choices: { id: string; name: string }[], label: string) {
  if (!value.trim()) return [];
  // A complete name takes precedence over separators inside that name.
  if (choices.some(choice => choice.id === value.trim() || normaliseSearch(choice.name) === normaliseSearch(value.trim()))) return [resolveOne(value, choices, label)];
  return [...new Set(value.split(/[;\n、,]/).map(item => item.trim()).filter(Boolean).map(item => resolveOne(item, choices, label)))];
}
function year(value: string, label: string) {
  if (!value.trim()) return null;
  if (!/^\d{4}$/.test(value.trim()) || Number(value) < 1900 || Number(value) > 2100) throw new Error(`${label}は1900〜2100の整数で入力してください。`);
  return Number(value);
}
function date(value: string) {
  if (!value.trim()) return null;
  const canonical = value.trim().replaceAll('/', '-');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(canonical) || Number.isNaN(Date.parse(canonical)) || new Date(canonical).toISOString().slice(0, 10) !== canonical) throw new Error('日付は YYYY-MM-DD で入力してください。');
  return canonical;
}
function editableLinks(before: LinkRow[], id: string, values: RecordCells, baselineValues: RecordCells, sheet: 'people' | 'games' = 'people') {
  let next = [...before];
  const categories = sheet === 'games' ? ['blog', 'board', 'x'] as const : ['x', 'blog'] as const;
  for (const category of categories) {
    if (values[category] === baselineValues[category]) continue;
    const label = category === 'x' ? 'X' : category === 'board' ? '掲示板' : 'ブログ';
    const existing = next.find(link => linkCategory(link) === category), normalised = normaliseLink(values[category] ?? '', category === 'x' ? 'twitter' : label);
    const canonical = normalised ? safeExternalUrl(normalised) : '';
    if (normalised && !canonical) throw new RecordFieldError(category, `${label}は http / https のURLで入力してください。`);
    const url = canonical ?? '';
    if (existing) next = url ? next.map(link => link.id === existing.id ? { ...link, url } : link) : next.filter(link => link.id !== existing.id);
    else if (url) next.push({ id: crypto.randomUUID(), person_id: sheet === 'people' ? id : null, event_id: sheet === 'games' ? id : null, kind: category === 'x' ? 'twitter' : label, label, url });
  }
  return next;
}
export function planRecordBulk(sheet: Sheet, store: PreviewStore, before: ReadonlyMap<string, RecordBaseline>, edits: Record<string, RecordEdit>, directory: Directory) {
  const games = mergeRows(directory.games, store.games), people = mergeRows(directory.people, store.people);
  const names = new Map([...games.map(row => [row.id, row.name] as const), ...people.map(row => [row.id, row.display_name] as const)]);
  const gameChoices = games.map(row => ({ id: row.id, name: row.name })), personChoices = people.map(row => ({ id: row.id, name: row.display_name }));
  const issues: RecordIssue[] = [], changes: { original: RecordBaseline; after: ChangeSnapshot; image?: Blob; imageUrlChanged: boolean }[] = [];
  for (const edit of Object.values(edits)) {
    const original = before.get(edit.id);
    if (!original || original.row.id !== edit.id) { issues.push({ id: edit.id, field: 'name', message: 'この記録は現在の一覧にありません。' }); continue; }
    if (!hasRecordChanges(original, edit)) continue;
    const values = { ...original.values, ...edit.values }; let field = sheet === 'people' ? 'display_name' : 'name';
    try {
      let row = original.row, relations = original.relations, links = original.links;
      if (sheet === 'cards' && 'effect_text' in row) {
        let eventId = row.event_id;
        if (original.isNew || values.event_id !== original.values.event_id) { field = 'event_id'; eventId = gameReferenceId(values.event_id ?? '', games); }
        field = 'card_type'; if (values.card_type !== original.values.card_type && values.card_type && !cardTypes.some(type => type === values.card_type)) throw new Error('タイプは attack / guard / spell / quick / other から選んでください。');
        field = 'rank'; if (values.rank !== original.values.rank && values.rank && !['SS', 'S', 'A', 'B', 'C', 'D'].includes(values.rank.toUpperCase())) throw new Error('ランクは SS / S / A / B / C / D から選んでください。');
        row = { ...row, event_id: eventId, name: values.name, source_card_id: nullable(values.source_card_id), rank: values.rank === original.values.rank ? row.rank : nullable(values.rank.toUpperCase()), card_type: nullable(values.card_type), effect_text: nullable(values.effect_text), flavor_text: nullable(values.flavor_text), imageUrl: values.imageUrl.trim() };
      } else if (sheet === 'people' && 'display_name' in row) {
        field = 'joined_year'; row = { ...row, display_name: values.display_name, joined_year: values.joined_year === original.values.joined_year ? row.joined_year : year(values.joined_year, '入学年') };
        field = 'x'; links = editableLinks(links, row.id, values, original.values);
        if (values.event_ids !== original.values.event_ids || original.isNew) {
          field = 'event_ids'; const wanted = resolveMany(values.event_ids, gameChoices, 'ゲーム');
          relations = relations.filter(rel => wanted.includes(rel.event_id));
          for (const eventId of wanted) if (!relations.some(rel => rel.event_id === eventId)) relations.push({ id: crypto.randomUUID(), person_id: row.id, event_id: eventId, kind: 'participant', status: 'attended', name_at_event: row.display_name, team_id: null, role_id: null });
        }
      } else if (sheet === 'games' && 'fiscal_year' in row) {
        links = editableLinks(links, row.id, values, original.values, 'games');
        field = 'fiscal_year'; const fiscalYear = values.fiscal_year === original.values.fiscal_year ? row.fiscal_year : year(values.fiscal_year, '開催年');
        field = 'start_date'; const start = values.start_date === original.values.start_date ? row.start_date : date(values.start_date);
        field = 'end_date'; const end = values.end_date === original.values.end_date ? row.end_date : date(values.end_date);
        row = { ...row, name: values.name, fiscal_year: fiscalYear, start_date: start, end_date: end, schedule_note: nullable(values.schedule_note) };
        if (values.master_ids !== original.values.master_ids) {
          field = 'master_ids'; const wanted = resolveMany(values.master_ids, personChoices, 'マスター');
          relations = relations.map(rel => wanted.includes(rel.person_id) ? convertParticipationKind(rel, 'master') : rel.kind === 'master' ? convertParticipationKind(rel, 'participant') : rel);
          for (const personId of wanted) if (!relations.some(rel => rel.person_id === personId)) relations.push({ id: crypto.randomUUID(), person_id: personId, event_id: row.id, kind: 'master', status: 'attended', name_at_event: names.get(personId) ?? null, team_id: null, role_id: null });
        }
      }
      field = 'imageUrl'; const imageUrlChanged = sheet !== 'people' && (values.imageUrl !== original.values.imageUrl || Boolean(edit.removeImage));
      if (imageUrlChanged && values.imageUrl.trim() && !safeExternalUrl(values.imageUrl.trim())) throw new Error('画像は http / https のURLで入力してください。');
      if (edit.image && (edit.image.size > 10 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(edit.image.type))) throw new Error('画像は PNG / JPEG / WebP の10MB以下にしてください。');
      field = sheet === 'people' ? 'display_name' : 'name';
      const validationDirectory = { ...directory, games: sheet === 'games' ? mergeRows(games, { [row.id]: row as EventRow }) : games, people: sheet === 'people' ? mergeRows(people, { [row.id]: row as PersonRow }) : people };
      const invalid = validateEditor(sheet, row, links, relations, validationDirectory, original.isNew ? undefined : original);
      if (invalid) { if (/終了日/.test(invalid)) field = 'end_date'; throw new Error(invalid); }
      changes.push({ original, after: { row, relations, links }, image: edit.image, imageUrlChanged });
    } catch (cause) { issues.push({ id: edit.id, field: cause instanceof RecordFieldError ? cause.field : field, message: cause instanceof Error ? cause.message : '入力を確認してください。' }); }
  }
  if (sheet === 'cards') {
    const changed = new Map(changes.map(change => [change.after.row.id, change.after.row as PreviewCard]));
    const all = mergeRows(directory.cards, { ...store.cards, ...Object.fromEntries(changed) });
    const groups = new Map<string, string[]>();
    for (const row of all) if (row.source_card_id?.trim()) { const key = `${row.event_id}:${row.source_card_id.trim()}`, group = groups.get(key); if (group) group.push(row.id); else groups.set(key, [row.id]); }
    for (const change of changes) {
      const row = change.after.row as PreviewCard, original = change.original.row as PreviewCard;
      if (!row.source_card_id || (!change.original.isNew && row.event_id === original.event_id && row.source_card_id === original.source_card_id)) continue;
      if ((groups.get(`${row.event_id}:${row.source_card_id.trim()}`)?.length ?? 0) > 1) issues.push({ id: row.id, field: 'source_card_id', message: `このゲームのカードID「${row.source_card_id}」が重複しています。` });
    }
  }
  if (issues.length) throw new RecordBulkValidationError(issues);
  if (!changes.length) return null;
  const patch: Record<string, PreviewCard | PersonRow | EventRow> = {}, relations = { ...store.relations }, links = { ...store.links }, images = { ...store.images }, gameImageUrls = { ...store.gameImageUrls }, history = [...store.history];
  const removedRelations = new Set(store.removedRelations), removedLinks = new Set(store.removedLinks);
  for (const change of changes) {
    const id = change.after.row.id;
    patch[id] = change.after.row;
    const afterRelationIds = new Set(change.after.relations.map(row => row.id)), afterLinkIds = new Set(change.after.links.map(row => row.id));
    for (const row of change.original.relations) if (!afterRelationIds.has(row.id)) removedRelations.add(row.id);
    for (const row of change.after.relations) removedRelations.delete(row.id);
    for (const row of changedParticipations(change.original.relations, change.after.relations)) relations[row.id] = row;
    for (const row of change.original.links) if (!afterLinkIds.has(row.id)) removedLinks.add(row.id);
    for (const row of change.after.links) removedLinks.delete(row.id);
    for (const row of changedLinks(change.original.links, change.after.links)) links[row.id] = row;
    if (change.imageUrlChanged) delete images[`${sheet}:${id}`];
    if (sheet === 'games' && change.imageUrlChanged) gameImageUrls[id] = edits[id].values.imageUrl.trim();
    if (change.image) images[`${sheet}:${id}`] = change.image;
    const entry = makeChangeEntry(sheet, change.original, change.after, change.original.isNew, names, Boolean(change.image) || change.imageUrlChanged);
    if (entry) history.push(entry);
  }
  const next = { ...store, relations, links, images, gameImageUrls, history, removedRelations: [...removedRelations], removedLinks: [...removedLinks], savedAt: new Date().toISOString() };
  if (sheet === 'cards') next.cards = { ...store.cards, ...patch } as Record<string, PreviewCard>;
  else if (sheet === 'people') next.people = { ...store.people, ...patch } as Record<string, PersonRow>;
  else next.games = { ...store.games, ...patch } as Record<string, EventRow>;
  return { next, changedIds: changes.map(change => change.after.row.id) };
}

export function parseDelimited(text: string, delimiter = '\t'): string[][] {
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), { delimiter, skipEmptyLines: 'greedy', dynamicTyping: false });
  if (parsed.errors.length) throw new Error('引用符や区切りを確認してください。貼り付けた表を読み込めませんでした。');
  const rows = parsed.data;
  if (rows.length > 5000) throw new Error('一度に貼り付ける表は5,000行以内にしてください。');
  return rows;
}
export function mapPasteHeader(sheet: Sheet, first: string[]): (string | '')[] | null {
  const mapping = first.map(value => inputColumns[sheet].find(column => [column.label, column.key, ...(column.aliases ?? [])].some(alias => normaliseSearch(alias.replace(/\s/g, '')) === normaliseSearch(value.replace(/\s/g, ''))))?.key ?? '');
  return mapping.filter(Boolean).length >= Math.min(2, first.length) && new Set(mapping.filter(Boolean)).size === mapping.filter(Boolean).length ? mapping : null;
}
export function matchImageFiles(files: { name: string; type: string; size: number }[], rows: { id: string; sourceId: string }[]) {
  const matches: { id: string; fileIndex: number }[] = [], unmatched: string[] = [], seen = new Set<string>();
  for (const [fileIndex, file] of files.entries()) {
    const stem = file.name.replace(/\.[^.]+$/, ''), candidates = rows.filter(row => row.sourceId.trim() === stem);
    if (candidates.length !== 1 || seen.has(candidates[0]?.id) || file.size > 10 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { unmatched.push(file.name); continue; }
    seen.add(candidates[0].id); matches.push({ id: candidates[0].id, fileIndex });
  }
  return { matches, unmatched };
}

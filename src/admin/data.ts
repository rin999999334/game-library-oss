import { configured } from '../supabase';
import { adminClient as supabase } from './apply';
import type { ParticipationRow, LinkRow } from '../database';
import type { Directory, PreviewCard, PreviewStore } from './model';
import { emptyStore } from './model';
import { cardImageSource, clearArtworkCache, readFrontImages } from '../artwork';
const cardColumns = 'id,event_id,name,source_card_id,source_type,card_type,rank,effect_text,flavor_text,publication_status,created_at' as const;
const relationColumns = 'id,person_id,event_id,team_id,role_id,kind,name_at_event,status' as const;
const linkColumns = 'id,person_id,event_id,kind,label,url' as const;
function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null) throw new Error('データを取得できませんでした。');
  return result.data;
}
async function pages<T>(request: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const result: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const rows = unwrap(await request(offset, offset + 999)); result.push(...rows);
    if (rows.length < 1000) return result;
  }
}
let directoryRequest: Promise<Directory> | undefined;
export function loadDirectory(refresh = false): Promise<Directory> {
  if (refresh) directoryRequest = undefined;
  return directoryRequest ??= (async () => {
    if (!configured) throw new Error('Supabaseの接続設定が見つかりません。');
    const [games, cards, people, masters, teams] = await Promise.all([
      pages((from, to) => supabase.from('events').select('id,name,fiscal_year,start_date,end_date,schedule_note,status,theme').order('id').range(from, to)),
      pages((from, to) => supabase.from('cards').select('id,event_id,name,source_card_id,rank,card_type,publication_status').order('id').range(from, to)),
      pages((from, to) => supabase.from('people').select('id,display_name,code_name,joined_year').order('id').range(from, to)),
      pages((from, to) => supabase.from('participations').select(relationColumns).eq('kind', 'master').order('id').range(from, to)),
      pages((from, to) => supabase.from('teams').select('id,event_id,display_name,rank_value,rank_note,final_score').order('id').range(from, to)),
    ]);
    return { games, cards, people, masters, teams };
  })().catch(error => { directoryRequest = undefined; throw error; });
}
const cardCache = new Map<string, PreviewCard>();
const personCache = new Map<string, { relations: ParticipationRow[]; links: LinkRow[] }>();
const teamCache = new Map<string, ParticipationRow[]>();
const gameCache = new Map<string, { relations: ParticipationRow[]; links: LinkRow[] }>();
const cardSortCache = new Map<'effect_text' | 'flavor_text', Promise<Record<string, string>>>();
export function loadCardSortValues(key: 'effect_text' | 'flavor_text'): Promise<Record<string, string>> {
  const cached = cardSortCache.get(key);
  if (cached) return cached;
  // Sorting text does not need the artwork or complete editor snapshots.
  const request = pages((from, to) => supabase.from('cards').select('id,effect_text,flavor_text').order('id').range(from, to))
    .then(rows => Object.fromEntries(rows.map(row => [row.id, row[key] ?? ''])))
    .catch(error => { cardSortCache.delete(key); throw error; });
  cardSortCache.set(key, request);
  return request;
}
let cacheEpoch = 0;
async function chunks(ids: string[], request: (keys: string[]) => Promise<void>) {
  // Keep URLs bounded and at most three batches in flight when jumping far down a sheet.
  for (let start = 0; start < ids.length; start += 300) await Promise.all(Array.from({ length: Math.min(3, Math.ceil((ids.length - start) / 100)) }, (_, index) => request(ids.slice(start + index * 100, start + (index + 1) * 100))));
}
export async function loadCards(ids: string[]): Promise<PreviewCard[]> {
  const epoch = cacheEpoch;
  await chunks(ids.filter(id => !cardCache.has(id)), async missing => {
    const [rows, images] = await Promise.all([
      supabase.from('cards').select(cardColumns).in('id', missing).then(unwrap),
      readFrontImages(missing, supabase, false),
    ]);
    const urls = new Map<string, string>();
    for (const image of images) if (!urls.has(image.card_id)) { const src = cardImageSource(image); if (src) urls.set(image.card_id, src); }
    if (epoch === cacheEpoch) for (const card of rows) cardCache.set(card.id, { ...card, imageUrl: urls.get(card.id) ?? '' });
  });
  if (epoch !== cacheEpoch) return loadCards(ids);
  return ids.flatMap(id => cardCache.has(id) ? [cardCache.get(id)!] : []);
}
export function clearCardCache() { cacheEpoch++; directoryRequest = undefined; cardCache.clear(); personCache.clear(); teamCache.clear(); gameCache.clear(); cardSortCache.clear(); clearArtworkCache(); }
export async function loadPeopleDetails(ids: string[]) {
  const epoch = cacheEpoch;
  await chunks(ids.filter(id => !personCache.has(id)), async missing => {
    const [relations, links] = await Promise.all([
      pages((from, to) => supabase.from('participations').select(relationColumns).in('person_id', missing).order('id').range(from, to)),
      pages((from, to) => supabase.from('resource_links').select(linkColumns).in('person_id', missing).order('id').range(from, to)),
    ]);
    if (epoch === cacheEpoch) for (const id of missing) personCache.set(id, { relations: relations.filter(row => row.person_id === id), links: links.filter(row => row.person_id === id) });
  });
  if (epoch !== cacheEpoch) return loadPeopleDetails(ids);
  const details = ids.flatMap(id => personCache.has(id) ? [personCache.get(id)!] : []);
  return { relations: details.flatMap(detail => detail.relations), links: details.flatMap(detail => detail.links) };
}
export async function loadGameRelations(id: string) {
  return pages((from, to) => supabase.from('participations').select(relationColumns).eq('event_id', id).order('id').range(from, to));
}
export async function loadGameDetails(id: string) {
  const cached = gameCache.get(id);
  if (cached) return cached;
  const epoch = cacheEpoch;
  const [relations, links] = await Promise.all([
    loadGameRelations(id),
    pages((from, to) => supabase.from('resource_links').select(linkColumns).eq('event_id', id).is('person_id', null).order('id').range(from, to)),
  ]);
  if (epoch !== cacheEpoch) return loadGameDetails(id);
  const details = { relations, links }; gameCache.set(id, details); return details;
}
export async function loadTeamRelations(ids: string[]): Promise<ParticipationRow[]> {
  const epoch = cacheEpoch;
  await chunks(ids.filter(id => !teamCache.has(id)), async missing => {
    const rows = await pages((from, to) => supabase.from('participations').select(relationColumns).in('team_id', missing).order('id').range(from, to));
    const groups = new Map<string, ParticipationRow[]>();
    for (const row of rows) if (row.team_id) { const group = groups.get(row.team_id); if (group) group.push(row); else groups.set(row.team_id, [row]); }
    if (epoch === cacheEpoch) for (const id of missing) teamCache.set(id, groups.get(id) ?? []);
  });
  if (epoch !== cacheEpoch) return loadTeamRelations(ids);
  return ids.flatMap(id => teamCache.get(id) ?? []);
}
const PREVIEW_DB = 'kakurenbo-admin-preview-v1';
export class PreviewConflictError extends Error {
  constructor() { super('別の画面で下書きが更新されています。この変更は保存されていません。再読み込みして最新の下書きを確認してください。'); this.name = 'PreviewConflictError'; }
}
export function restorePreview(value: unknown): PreviewStore {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1) return emptyStore();
  const saved = value as Partial<PreviewStore>;
  return { ...emptyStore(), ...saved, teams: saved.teams ?? {}, holds: saved.holds ?? {}, gameImageUrls: saved.gameImageUrls ?? {}, revision: Number.isSafeInteger(saved.revision) && saved.revision! >= 0 ? saved.revision! : 0, history: saved.history ?? [] };
}
export function revisePreview(current: PreviewStore, next: PreviewStore): PreviewStore {
  if (current.revision !== next.revision) throw new PreviewConflictError();
  return { ...next, revision: current.revision + 1 };
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PREVIEW_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('preview');
    request.onerror = () => reject(new Error('このブラウザでは下書きを保存できません。'));
    request.onsuccess = () => resolve(request.result);
  });
}
export async function readPreview(): Promise<PreviewStore> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('preview', 'readonly'), request = tx.objectStore('preview').get('draft');
    request.onsuccess = () => resolve(restorePreview(request.result));
    request.onerror = () => reject(new Error('下書きを読み込めませんでした。'));
    tx.oncomplete = tx.onabort = () => db.close();
  });
}
export async function savePreview(store: PreviewStore): Promise<PreviewStore> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('preview', 'readwrite'), records = tx.objectStore('preview'), request = records.get('draft');
    let saved: PreviewStore | undefined, failure: unknown;
    request.onsuccess = () => {
      try { saved = revisePreview(restorePreview(request.result), store); records.put(saved, 'draft'); }
      catch (cause) { failure = cause; tx.abort(); }
    };
    tx.oncomplete = () => { db.close(); resolve(saved!); };
    tx.onerror = tx.onabort = () => { db.close(); reject(failure ?? new Error('下書きを保存できませんでした。ブラウザの空き容量を確認してください。')); };
  });
}

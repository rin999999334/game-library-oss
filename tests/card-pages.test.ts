import test from 'node:test';
import assert from 'node:assert/strict';
import type { CardRow, EventRow, ImageRow } from '../src/database';
import { forget } from '../src/cache';
import { cardPreview, imageSize } from '../src/card-preview';

// All requests below terminate in the local mock; no Supabase connection is made.
const originalUrl = process.env.VITE_SUPABASE_URL, originalKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
process.env.VITE_SUPABASE_URL = 'https://card-pages-test.supabase.co';
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'card-pages-test';
const { loadCard, loadCardPage, loadCardPages, loadSearch, loadSearchPages } = await import('../src/api');
if (originalUrl === undefined) delete process.env.VITE_SUPABASE_URL; else process.env.VITE_SUPABASE_URL = originalUrl;
if (originalKey === undefined) delete process.env.VITE_SUPABASE_PUBLISHABLE_KEY; else process.env.VITE_SUPABASE_PUBLISHABLE_KEY = originalKey;

const game = (id: string, year: number): EventRow => ({ id, name: id, fiscal_year: year, start_date: `${year}-01-01`, end_date: null, schedule_note: null, status: null, theme: null });
const card = (id: string, eventId: string, name: string, rank = 'A', type = 'attack'): CardRow => ({ id, event_id: eventId, name, rank, card_type: type, source_card_id: id, source_type: null, effect_text: null, flavor_text: null, publication_status: 'published', created_at: '2026-01-01' });
const listValues = (value: string) => value.slice(4, -1).split(',').map(part => part.replace(/^"|"$/g, ''));

function mockReads(cards: CardRow[], events: EventRow[] = [], images: ImageRow[] = []) {
  const original = globalThis.fetch, requests: URL[] = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input)); requests.push(url);
    let rows: (CardRow | EventRow | ImageRow)[] = url.pathname.endsWith('/events') ? events : url.pathname.endsWith('/cards') ? cards : url.pathname.endsWith('/card_images') ? images : [];
    for (const field of ['event_id', 'card_type', 'rank', 'publication_status', 'id', 'card_id', 'role', 'image_status']) {
      const value = url.searchParams.get(field); if (!value) continue;
      rows = rows.filter(row => {
        const stored = (row as unknown as Record<string, unknown>)[field];
        return value.startsWith('in.(') ? listValues(value).includes(String(stored)) : value.startsWith('eq.') ? stored === value.slice(3) : true;
      });
    }
    const total = rows.length, from = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? total);
    rows = [...rows].sort((a, b) => a.id.localeCompare(b.id)).slice(from, from + limit);
    // Full rows intentionally arrive in a different order from the chosen IDs.
    if (url.pathname.endsWith('/cards') && url.searchParams.has('id')) rows.reverse();
    return new Response(JSON.stringify(rows), { headers: { 'Content-Type': 'application/json', 'Content-Range': `${from}-${from + rows.length - 1}/${total}` } });
  };
  return { requests, restore: () => { globalThis.fetch = original; } };
}
const directoryReads = (requests: URL[]) => requests.filter(url => url.pathname.endsWith('/cards') && !url.searchParams.has('id'));

test('DB image dimensions reserve the original ratio before any image download, including direct card links', async () => {
  const row = card('metadata-dimensions-card', 'metadata-dimensions-game', '画像だけのカード');
  const image: ImageRow = { id: 'metadata-image', card_id: row.id, storage_path: null, external_url: 'https://example.com/original-metadata.jpg', width: 1200, height: 1800, role: 'front', display_order: 1, image_status: 'available' };
  const mock = mockReads([row], [], [image]);
  try {
    await loadCard(row.id);
    assert.deepEqual(imageSize(image.external_url!), { width: 1200, height: 1800 });
    const imageRead = mock.requests.find(url => url.pathname.endsWith('/card_images'))!;
    assert.match(imageRead.searchParams.get('select')!, /width,height/);
    assert.ok(mock.requests.every(url => url.hostname === 'card-pages-test.supabase.co'));
    const page = await loadCardPage({ eventId: row.event_id, type: '', sort: 'game' }, 0);
    assert.equal(page.items[0].originalImageUrl, image.external_url);
    assert.deepEqual(imageSize(page.items[0].originalImageUrl), { width: 1200, height: 1800 });
  } finally { mock.restore(); }
});

test('game ordering preserves newest groups and display-ID ordering across page boundaries', async () => {
  const newer = Array.from({ length: 40 }, (_, i) => card(`newer-${String(i).padStart(2, '0')}`, 'newer-game', `あ${40 - i}`, 'D'));
  const older = Array.from({ length: 30 }, (_, i) => card(`older-${String(i).padStart(2, '0')}`, 'older-game', `い${30 - i}`, 'SS'));
  const mock = mockReads([...older, ...newer], [game('older-game', 2025), game('newer-game', 2026)]);
  try {
    const result = await loadCardPages({ type: '', sort: 'game' }, 2);
    const expected = [...newer, ...older].map(row => row.id);
    assert.deepEqual(result.items.map(row => row.id), expected);
    assert.equal(result.total, 70); assert.equal(new Set(result.items.map(row => row.id)).size, 70);
    const directories = directoryReads(mock.requests);
    assert.equal(directories.length, 1);
    assert.equal(directories[0].searchParams.get('select'), 'id,event_id,source_card_id,name,rank,card_type');
    const details = mock.requests.filter(url => url.pathname.endsWith('/cards') && url.searchParams.has('id'));
    assert.deepEqual(details.map(url => listValues(url.searchParams.get('id')!).length).sort((a, b) => b - a), [24, 24, 22]);
  } finally { mock.restore(); }
});

test('selected-game directories apply game, guard aliases, rank search, and publication filters before sorting', async () => {
  const cards = [card('filter-spell', 'filter-game', 'あ', 'S', 'spell'), card('filter-defense', 'filter-game', 'い', 's', 'defense'), card('filter-guard', 'filter-game', 'あ', 'S', 'guard'), card('filter-defence', 'filter-game', 'う', 'S', 'defence'), card('filter-a', 'filter-game', 'あ', 'A', 'guard'), card('filter-elsewhere', 'another-game', 'あ', 'S', 'guard'), { ...card('filter-draft', 'filter-game', 'あ', 'S', 'guard'), publication_status: 'draft' }];
  const mock = mockReads(cards);
  try {
    const result = await loadCardPage({ eventId: 'filter-game', type: 'defense', sort: 'game', q: 'Ｓ' }, 0);
    assert.deepEqual(result.items.map(row => row.id), ['filter-defence', 'filter-defense', 'filter-guard']);
    assert.equal(result.total, 3);
    const request = directoryReads(mock.requests)[0];
    assert.equal(request.searchParams.get('event_id'), 'eq.filter-game');
    assert.equal(request.searchParams.get('card_type'), 'in.(defence,defense,guard)');
    assert.equal(request.searchParams.get('rank'), 'in.(s,S)');
    assert.equal(request.searchParams.get('publication_status'), 'eq.published');
  } finally { mock.restore(); }
});

test('display-ID sorting spans pages naturally, with equal-ID rank/type/name ties and missing IDs last', async () => {
  const base = Array.from({ length: 60 }, (_, i) => ({ ...card(`uuid-${String(i).padStart(2, '0')}`, 'id-pagination-game', `わ${i}`, i === 50 ? 'SS' : 'D'), source_card_id: String(60 - i) }));
  const sameId = (id: string, type: string, name: string, sourceId = '24') => ({ ...card(id, 'id-pagination-game', name, 'SS', type), source_card_id: sourceId });
  const attackA = sameId('tie-z', 'attack', 'あ', '２４'), attackI = sameId('tie-a', 'attack', 'い');
  const guard = sameId('tie-guard', 'defence', 'あ'), quick = sameId('tie-quick', 'quick', 'あ'), spell = sameId('tie-spell', 'spell', 'あ');
  const empty = { ...sameId('missing-empty', 'attack', 'あ'), source_card_id: '' }, whitespace = { ...sameId('missing-space', 'attack', 'い'), source_card_id: '　' }, missing = { ...sameId('missing-null', 'quick', 'あ'), source_card_id: null };
  const mock = mockReads([...base, spell, missing, attackI, quick, empty, guard, whitespace, attackA]);
  try {
    const result = await loadCardPages({ eventId: 'id-pagination-game', type: '', sort: 'game' }, 2);
    const byNumber = new Map(base.map(row => [Number(row.source_card_id), row]));
    const expected = Array.from({ length: 60 }, (_, i) => i + 1).flatMap<CardRow>(number => number === 24 ? [attackA, attackI, guard, quick, spell, byNumber.get(number)!] : [byNumber.get(number)!]).concat([empty, whitespace, missing]);
    assert.deepEqual(result.items.map(row => row.id), expected.map(row => row.id));
    assert.equal(result.total, 68);
    assert.equal(result.items[23].id, attackA.id); assert.equal(result.items[24].id, attackI.id);
    assert.equal(new Set(result.items.map(row => row.id)).size, 68);
    assert.equal(directoryReads(mock.requests).length, 1);
  } finally { mock.restore(); }
});

test('global rank sorting scans lightweight directory pages once before slicing any card page', async () => {
  // This fixture replaces the backend, so its directory must not reuse the prior fixture.
  forget('card-directory:["","",""]');
  const lower = Array.from({ length: 1000 }, (_, i) => card(`large-${String(i).padStart(4, '0')}`, 'large-game', `あ${i}`, 'A', i % 2 ? 'guard' : 'attack'));
  // UUID ordering puts the strongest card in the second directory page.
  const strongest = card('zz-strongest', 'other-game', 'わ', 'SS', 'spell');
  const mock = mockReads([...lower, strongest]);
  try {
    const params = { eventId: undefined, type: '', sort: 'rank' as const, q: undefined };
    const [first, second] = await Promise.all([loadCardPage(params, 0), loadCardPage(params, 1)]);
    assert.equal(first.items[0].id, strongest.id); assert.equal(first.total, 1001); assert.equal(second.total, 1001);
    assert.deepEqual(first.items.slice(1).map(row => row.id), lower.filter(row => row.card_type === 'attack').slice(0, 23).map(row => row.id));
    assert.deepEqual(second.items.map(row => row.id), lower.filter(row => row.card_type === 'attack').slice(23, 47).map(row => row.id));
    assert.equal(new Set([...first.items, ...second.items].map(row => row.id)).size, 48);
    assert.deepEqual(directoryReads(mock.requests).map(url => Number(url.searchParams.get('offset'))), [0, 1000]);
    assert.equal(mock.requests.filter(url => url.pathname.endsWith('/events')).length, 0);
  } finally { mock.restore(); }
});

test('explicit number and newest modes retain filtered server pagination and totals', async () => {
  const cards = Array.from({ length: 31 }, (_, i) => card(`explicit-${String(i).padStart(2, '0')}`, 'explicit-game', `あ${i}`));
  const mock = mockReads(cards);
  try {
    for (const sort of ['number', 'newest'] as const) {
      const result = await loadCardPage({ eventId: 'explicit-game', type: 'attack', sort }, 1);
      assert.equal(result.total, 31); assert.equal(result.items.length, 7);
    }
    const reads = mock.requests.filter(url => url.pathname.endsWith('/cards'));
    assert.equal(reads.length, 2);
    assert.deepEqual(reads.map(url => url.searchParams.get('order')), ['source_card_id.asc.nullslast,id.asc', 'created_at.desc,id.asc']);
    assert.ok(reads.every(url => url.searchParams.get('event_id') === 'eq.explicit-game' && url.searchParams.get('card_type') === 'eq.attack' && url.searchParams.get('offset') === '24' && url.searchParams.get('limit') === '24'));
  } finally { mock.restore(); }
});

test('card search hands full card data and the original image sizing key to detail, including later pages', async () => {
  const cards = Array.from({ length: 25 }, (_, i) => ({ ...card(`search-preview-${String(i).padStart(2, '0')}`, 'search-preview-game', `検索handoff専用${i}`), effect_text: `効果${i}` }));
  const images: ImageRow[] = cards.map(row => ({ id: `image-${row.id}`, card_id: row.id, storage_path: `search-preview/${row.id}.png`, role: 'front', display_order: 0, image_status: 'available' }));
  const mock = mockReads(cards, [], images);
  try {
    const first = await loadSearch('card', '検索handoff専用');
    const item = first.items[0], preview = cardPreview(item.id);
    assert.equal(first.total, 25);
    assert.equal(preview?.effect_text, '効果0');
    assert.equal(preview?.imageUrl, item.image);
    assert.equal(preview?.originalImageUrl, item.originalImageUrl);
    assert.match(item.originalImageUrl!, /\/storage\/v1\/object\/public\/card-images\/search-preview\//);
    assert.match(item.image!, /\/storage\/v1\/render\/image\/public\/card-images\/search-preview\//);
    assert.notEqual(item.image, item.originalImageUrl);
    const all = await loadSearchPages('card', '検索handoff専用', 1), last = all.items.at(-1)!;
    assert.equal(all.items.length, 25);
    assert.equal(cardPreview(last.id)?.effect_text, '効果24');
    assert.equal(cardPreview(last.id)?.originalImageUrl, last.originalImageUrl);
  } finally { mock.restore(); }
});

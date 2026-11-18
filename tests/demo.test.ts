import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEvents, loadCardPage, loadCard, loadEventDetail, loadPerson, loadSearch } from '../src/demo/api';

test('fictional demo supports browsing, pagination, related detail and search with networking disabled', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Demo must not use a network connection'); };
  try {
    const events = await loadEvents();
    assert.equal(events.length, 2);
    const pages = await Promise.all([0, 1, 2].map(page => loadCardPage({ type: '', sort: 'game' }, page)));
    assert.deepEqual(pages.map(page => page.items.length), [24, 24, 12]);
    assert.equal(new Set(pages.flatMap(page => page.items.map(card => card.id))).size, 60);
    const event = await loadEventDetail(events[0].id);
    assert.equal(event.attendance.length, 3);
    assert.equal(event.preview.total, 30);
    const person = await loadPerson(event.attendance[0].person_id);
    assert.equal(person.history.length, 2);
    assert.equal((await loadCard(event.preview.items[0].id)).event_id, event.event.id);
    assert.equal((await loadSearch('game', '探索')).total, 1);
    assert.equal((await loadSearch('person', 'あお')).total, 1);
    assert.equal((await loadSearch('person', '青組')).total, 1);
    assert.equal((await loadSearch('card', 'サンプルカード')).total, 60);
    assert.equal((await loadSearch('card', '防御')).total, 10);
    assert.equal((await loadSearch('card', 'ランクSS')).total, 10);
    assert.equal((await loadCardPage({ eventId: events[0].id, type: 'defence', sort: 'rank' }, 0)).total, 5);
    assert.equal((await loadSearch('person', '')).total, 0);
    await assert.rejects(loadCard('unknown'));
    await assert.rejects(loadEventDetail('unknown'));
    await assert.rejects(loadPerson('unknown'));
  } finally { globalThis.fetch = originalFetch; }
});

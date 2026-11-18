import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { EventRow, LinkRow, PersonRow, ParticipationRow } from '../database';
import { eventTag, orderGames, safeExternalUrl } from '../model';
import { loadCards, loadGameDetails, loadPeopleDetails } from './data';
import { canonicaliseEditedLinks, cardTypes, mergeLinkEdits, mergeRelationEdits, mergeRows, normaliseLink, period, scopedRelations, sheetInfo, validateEditor, type Directory, type PreviewCard, type PreviewStore, type Sheet } from './model';
import Picker from './Picker';
import { makeChangeEntry } from './history';
import { convertParticipationKind, participationConflict, upsertParticipation } from './participation-edits';
import { visibleFocusTargets } from './focus';
import Icon from './Icon';
export type Selection = { sheet: Sheet; id: string; isNew?: boolean };
type Editable = PreviewCard | PersonRow | EventRow;
type Props = { selection: Selection; directory: Directory; store: PreviewStore; imageUrls: Record<string, string>; modal: boolean; onSave: (next: PreviewStore) => Promise<void>; onClose: () => void; onNavigate: (sheet: Sheet, id: string) => void; onDirty: (dirty: boolean) => void; onRelated: (sheet: 'cards' | 'people', gameId: string) => void; onZoom: (src: string, name: string) => void };
const nullable = (value: string) => value.trim() ? value : null;
function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) { return <div className="adm-field"><span className="adm-field-label">{label}</span>{children}{hint && <small>{hint}</small>}</div>; }
export default function Editor({ selection, directory, store, imageUrls, modal, onSave, onClose, onNavigate, onDirty, onRelated, onZoom }: Props) {
  const { sheet, id, isNew } = selection;
  const [row, setRow] = useState<Editable | null>(null), [relations, setRelations] = useState<ParticipationRow[]>([]), [links, setLinks] = useState<LinkRow[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [saving, setSaving] = useState(false), [file, setFile] = useState<Blob | null>(null), [dirty, setDirty] = useState(false);
  const baseline = useRef<{ row: Editable; relations: ParticipationRow[]; links: LinkRow[] } | null>(null);
  const panel = useRef<HTMLElement>(null), nameInput = useRef<HTMLInputElement>(null), saveLock = useRef(false), restoreSaveFocus = useRef(false);
  const origin = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null), titleId = useId();
  const baseStore = useRef(store).current;
  const games = useMemo(() => orderGames(mergeRows(directory.games, store.games)), [directory.games, store.games]);
  const people = useMemo(() => mergeRows(directory.people, store.people).sort((a, b) => a.display_name.localeCompare(b.display_name, 'ja')), [directory.people, store.people]);
  const currentDirectory = { ...directory, games, people };
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        let initial: Editable, history: ParticipationRow[] = [], resources: LinkRow[] = [];
        if (sheet === 'cards') initial = baseStore.cards[id] ?? (isNew ? { id, event_id: games[0]?.id ?? '', name: '', source_card_id: null, rank: null, source_type: null, card_type: null, effect_text: null, flavor_text: null, publication_status: 'draft', created_at: new Date().toISOString(), imageUrl: '' } : (await loadCards([id]))[0]);
        else if (sheet === 'people') {
          initial = baseStore.people[id] ?? directory.people.find(person => person.id === id) ?? { id, display_name: '', code_name: null, joined_year: null };
          const details = isNew ? { relations: [], links: [] } : await loadPeopleDetails([id]);
          history = scopedRelations(details.relations, baseStore, 'person_id', id);
          resources = mergeRows(details.links, baseStore.links, baseStore.removedLinks).filter(link => link.person_id === id);
        } else {
          initial = baseStore.games[id] ?? directory.games.find(game => game.id === id) ?? { id, name: '', fiscal_year: new Date().getFullYear(), start_date: null, end_date: null, schedule_note: null, status: null, theme: null };
          const details = isNew ? { relations: [], links: [] } : await loadGameDetails(id);
          history = scopedRelations(details.relations, baseStore, 'event_id', id);
          resources = mergeRows(details.links, baseStore.links, baseStore.removedLinks).filter(link => link.event_id === id && !link.person_id);
        }
        if (!initial) throw new Error('記録が見つかりません。');
        if (cancelled) return;
        baseline.current = { row: initial, relations: history, links: resources };
        setRow(initial); setRelations(history); setLinks(resources); setLoading(false);
      } catch (cause) { if (!cancelled) { setError(cause instanceof Error ? cause.message : '読み込めませんでした。'); setLoading(false); } }
    }
    void load(); return () => { cancelled = true; };
    // The editor owns the snapshot opened by this selection, until Save or Discard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, sheet]);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => { const listener = (event: BeforeUnloadEvent) => { if (dirty || saveLock.current) event.preventDefault(); }; window.addEventListener('beforeunload', listener); return () => window.removeEventListener('beforeunload', listener); }, [dirty]);
  useLayoutEffect(() => {
    const element = panel.current;
    return () => {
      const focused = document.activeElement;
      if (focused !== document.body && !element?.contains(focused)) return;
      queueMicrotask(() => {
        if (!element || element.isConnected) return;
        const currentFocus = document.activeElement;
        if ((currentFocus === document.body || element?.contains(currentFocus)) && origin.current?.isConnected && !origin.current.closest('[inert]')) origin.current.focus({ preventScroll: true });
      });
    };
  }, []);
  useEffect(() => { if (!loading && row) nameInput.current?.focus({ preventScroll: true }); }, [loading]);
  useLayoutEffect(() => {
    if (saving || !restoreSaveFocus.current) return;
    restoreSaveFocus.current = false;
    if (document.activeElement === document.body) nameInput.current?.focus({ preventScroll: true });
  }, [saving]);
  const [localFileUrl, setLocalFileUrl] = useState('');
  useLayoutEffect(() => {
    const url = file ? URL.createObjectURL(file) : ''; setLocalFileUrl(url);
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [file]);
  const name = row ? ('display_name' in row ? row.display_name : row.name) : '';
  const imageKey = `${sheet}:${id}`;
  const src = localFileUrl || imageUrls[imageKey] || (row && 'imageUrl' in row ? row.imageUrl : '');
  const touch = () => { if (saveLock.current) return; setDirty(true); setError(''); };
  function update(key: string, value: unknown) { if (row && !saveLock.current) { setRow({ ...row, [key]: value }); touch(); } }
  function changeRelation(relationId: string, patch: Partial<ParticipationRow>) { if (saveLock.current) return; setRelations(rows => rows.map(rel => rel.id === relationId ? { ...(patch.kind ? convertParticipationKind(rel, patch.kind) : rel), ...patch } : rel)); touch(); }
  function discard() {
    const initial = baseline.current; if (!initial || saveLock.current) return;
    setRow(initial.row); setRelations(initial.relations); setLinks(initial.links); setFile(null); setDirty(false); setError('');
  }
  async function save() {
    if (!row || !baseline.current || saveLock.current) return;
    const canonicalLinks = canonicaliseEditedLinks(links, baseline.current.links);
    const validationDirectory = { ...currentDirectory, games: sheet === 'games' ? mergeRows(games, { [id]: row as EventRow }) : games, people: sheet === 'people' ? mergeRows(people, { [id]: row as PersonRow }) : people };
    const invalid = participationConflict(relations) || validateEditor(sheet, row, canonicalLinks, relations, validationDirectory, isNew ? undefined : baseline.current);
    if (invalid) { setError(invalid); return; }
    saveLock.current = true; setSaving(true); setError('');
    try {
      let next = mergeRelationEdits(store, baseline.current.relations, relations);
      next = mergeLinkEdits(next, baseline.current.links, canonicalLinks);
      if (sheet === 'cards') next = { ...next, cards: { ...next.cards, [id]: row as PreviewCard } };
      if (sheet === 'people') next = { ...next, people: { ...next.people, [id]: row as PersonRow } };
      if (sheet === 'games') next = { ...next, games: { ...next.games, [id]: row as EventRow } };
      if (file) next = { ...next, images: { ...next.images, [imageKey]: file } };
      const entry = makeChangeEntry(sheet, baseline.current, { row, relations, links: canonicalLinks }, Boolean(isNew && !store[sheet][id]), new Map([...games.map(game => [game.id, game.name] as const), ...people.map(person => [person.id, person.display_name] as const)]), Boolean(file && (dirty || !store.images[imageKey])));
      await onSave({ ...next, history: entry ? [...(store.history ?? []), entry] : store.history ?? [], savedAt: new Date().toISOString() });
      baseline.current = { row, relations, links: canonicalLinks }; setLinks(canonicalLinks); setFile(null); setDirty(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存できませんでした。'); }
    finally { saveLock.current = false; restoreSaveFocus.current = true; setSaving(false); }
  }
  function addRelation(otherId: string, kind: string) {
    if (saveLock.current) return;
    try {
      const result = upsertParticipation(relations, { personId: sheet === 'people' ? id : otherId, eventId: sheet === 'games' ? id : otherId, kind, nameAtEvent: sheet === 'people' ? name : people.find(person => person.id === otherId)?.display_name ?? null });
      if (!result.changed) { setError('この人物・ゲームはすでに登録されています。既存の参加履歴を確認してください。'); return; }
      setRelations(result.rows); touch();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '参加履歴を追加できませんでした。'); }
  }
  function removeRelation(relationId: string) {
    if (saveLock.current) return;
    setRelations(rows => sheet === 'games' ? rows.map(rel => rel.id === relationId ? convertParticipationKind(rel, 'participant') : rel) : rows.filter(rel => rel.id !== relationId));
    touch();
  }
  function addLink(kind: string) { if (saveLock.current) return; setLinks(rows => [...rows, { id: crypto.randomUUID(), person_id: sheet === 'people' ? id : null, event_id: sheet === 'games' ? id : null, kind, label: kind === 'twitter' ? 'X' : kind, url: '' }]); touch(); }
  function updateLink(linkId: string, patch: Partial<LinkRow>) { if (saveLock.current) return; setLinks(rows => rows.map(link => link.id === linkId ? { ...link, ...patch } : link)); touch(); }
  function keyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented) return;
    if (event.key === 'Escape') { event.preventDefault(); if (!saveLock.current) onClose(); return; }
    if (!modal || event.key !== 'Tab') return;
    const controls = panel.current ? visibleFocusTargets(panel.current) : [];
    if (!controls.length) { event.preventDefault(); panel.current?.focus(); return; }
    const first = controls[0], last = controls[controls.length - 1], focused = document.activeElement;
    if (event.shiftKey && (focused === first || focused === panel.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (focused === last || focused === panel.current)) { event.preventDefault(); first.focus(); }
  }
  return <aside className="adm-editor" ref={panel} role={modal ? 'dialog' : undefined} aria-modal={modal || undefined} aria-labelledby={titleId} aria-busy={saving} tabIndex={-1} onKeyDown={keyDown}>
    <header className="adm-editor-header"><div><span className="adm-eyebrow">{isNew ? '新しい記録' : '記録を編集'}</span><h2 id={titleId}>{name || `${sheetInfo[sheet].singular}を追加`}</h2></div><button type="button" className="adm-icon-button" aria-label="編集パネルを閉じる" disabled={saving} onClick={() => { if (!saveLock.current) onClose(); }}><Icon name="close"/></button></header>
    <fieldset className="adm-editor-content" disabled={saving} style={{ border: 0, margin: 0, minInlineSize: 0 }}>
      {loading && <div className="adm-loading" role="status">記録を読み込んでいます…</div>}
      {!loading && row && <>
        {sheet !== 'people' && <div className="adm-image-field"><button className={`adm-editor-art ${sheet === 'games' ? 'game' : ''}`} disabled={!src} aria-label="画像を大きく見る" onClick={() => src && onZoom(src, name)}>{src ? <img src={src} alt={name}/> : sheet === 'games' ? <span>{eventTag(name || 'ゲーム')}</span> : <Icon name="image" size={26}/>}</button><div><strong>{sheet === 'games' ? 'ホームの画像' : 'カードの画像'}</strong><label className="adm-button adm-upload">画像を選択<input type="file" accept="image/png,image/jpeg,image/webp" aria-label="画像ファイルを選択" onChange={event => { if (saveLock.current) return; const selected = event.target.files?.[0]; event.currentTarget.value = ''; if (!selected) return; if (!['image/png', 'image/jpeg', 'image/webp'].includes(selected.type) || selected.size > 10 * 1024 * 1024) { setError('PNG / JPEG / WebPの10MB以下の画像を選んでください。'); return; } setFile(selected); touch(); }}/></label><small>元の画像の比率を保持します</small></div></div>}
        <section className="adm-editor-section"><h3>基本情報</h3>
          <Field label={sheet === 'games' ? 'ゲーム名' : '名前'}><input ref={nameInput} aria-label={sheet === 'games' ? 'ゲーム名' : '名前'} value={name} placeholder={`${sheetInfo[sheet].singular}の名前`} onChange={event => update(sheet === 'people' ? 'display_name' : 'name', event.target.value)}/></Field>
          {sheet === 'people' && 'joined_year' in row && <Field label="入学年"><input aria-label="入学年" type="number" min="1900" max="2100" value={row.joined_year ?? ''} onChange={event => update('joined_year', event.target.value ? Number(event.target.value) : null)}/></Field>}
          {sheet === 'cards' && 'event_id' in row && <><Field label="所属ゲーム"><div className="adm-linked-field"><Picker label="所属ゲーム" options={games.map(game => ({ id: game.id, label: game.name }))} value={row.event_id} onChange={value => update('event_id', value)}/><button type="button" className="adm-icon-button" aria-label="所属ゲームを開く" title="ゲームを開く" onClick={() => onNavigate('games', row.event_id)}><Icon name="arrow" size={17}/></button></div></Field><div className="adm-field-grid"><Field label="ID"><input aria-label="カードのID" value={row.source_card_id ?? ''} placeholder="原カードの番号" onChange={event => update('source_card_id', nullable(event.target.value))}/></Field><Field label="ランク"><select aria-label="ランク" value={row.rank ?? ''} onChange={event => update('rank', nullable(event.target.value))}><option value="">未設定</option>{[...new Set(['SS', 'S', 'A', 'B', 'C', 'D', ...(row.rank ? [row.rank] : [])])].map(rank => <option key={rank}>{rank}</option>)}</select></Field></div><Field label="タイプ"><select aria-label="タイプ" value={row.card_type ?? ''} onChange={event => update('card_type', event.target.value)}><option value="" disabled>未設定</option>{row.card_type && !cardTypes.some(type => type === row.card_type) && <option value={row.card_type} disabled>{row.card_type}</option>}{cardTypes.map(type => <option key={type} value={type}>{type}</option>)}</select></Field></>}
          {sheet === 'games' && 'start_date' in row && <><div className="adm-field-grid"><Field label="開始日"><input aria-label="開始日" type="date" value={row.start_date ?? ''} onChange={event => update('start_date', nullable(event.target.value))}/></Field><Field label="終了日"><input aria-label="終了日" type="date" value={row.end_date ?? ''} onChange={event => update('end_date', nullable(event.target.value))}/></Field></div><div className="adm-field-grid"><Field label="開催年"><input aria-label="開催年" type="number" min="1900" max="2100" value={row.fiscal_year ?? ''} onChange={event => update('fiscal_year', event.target.value ? Number(event.target.value) : null)}/></Field><Field label="期間の補足"><input aria-label="期間の補足" value={row.schedule_note ?? ''} onChange={event => update('schedule_note', nullable(event.target.value))}/></Field></div><div className="adm-period-preview"><span>ホームでの表示</span><strong>{period(row)}</strong></div></>}
        </section>
        {sheet === 'cards' && 'effect_text' in row && <section className="adm-editor-section"><h3>カードの内容</h3><Field label="効果"><textarea aria-label="効果" rows={5} value={row.effect_text ?? ''} placeholder="効果を入力" onChange={event => update('effect_text', nullable(event.target.value))}/></Field><Field label="カードフレーバー"><textarea aria-label="カードフレーバー" rows={4} value={row.flavor_text ?? ''} placeholder="フレーバーを入力" onChange={event => update('flavor_text', nullable(event.target.value))}/></Field></section>}
        {sheet !== 'cards' && <section className="adm-editor-section"><div className="adm-section-heading"><h3>外部リンク</h3><div><button type="button" className="adm-text-button" onClick={() => addLink('twitter')}><Icon name="x" size={13}/> Xを追加</button><button type="button" className="adm-text-button" onClick={() => addLink('ブログ')}><Icon name="plus" size={14}/> ブログ</button>{sheet === 'games' && <button type="button" className="adm-text-button" onClick={() => addLink('掲示板')}><Icon name="plus" size={14}/> 掲示板</button>}</div></div>{links.length ? links.map(link => <div className="adm-link-editor" key={link.id}><div className="adm-link-heading"><input aria-label="リンクの表示名" value={link.label} onChange={event => updateLink(link.id, { label: event.target.value })}/><button type="button" className="adm-icon-button" aria-label={`${link.label}のリンクを外す`} onClick={() => { setLinks(rows => rows.filter(row => row.id !== link.id)); touch(); }}><Icon name="close" size={15}/></button></div><input aria-label={`${link.label}のURL`} value={link.url} placeholder={link.kind === 'twitter' ? '@ID または https://x.com/…' : 'https://…'} onChange={event => updateLink(link.id, { url: event.target.value })}/>{safeExternalUrl(normaliseLink(link.url, link.kind)) && <a className="adm-subtle-link" href={safeExternalUrl(normaliseLink(link.url, link.kind))!} target="_blank" rel="noreferrer">リンクを確認 <Icon name="arrow" size={12}/></a>}</div>) : <p className="adm-empty-inline">{sheet === 'games' ? 'ブログ・掲示板・XのURLを登録できます。' : 'XやブログのURLを登録できます。'}</p>}</section>}
        {sheet !== 'cards' && <section className="adm-editor-section"><h3>{sheet === 'games' ? 'マスター' : '参加ゲーム'}</h3><div className="adm-relations">{relations.filter(rel => sheet === 'people' || rel.kind === 'master').sort((a, b) => games.findIndex(game => game.id === a.event_id) - games.findIndex(game => game.id === b.event_id)).map(rel => <div className="adm-relation" key={rel.id}><div className="adm-relation-heading"><button type="button" className="adm-relation-name" onClick={() => onNavigate(sheet === 'people' ? 'games' : 'people', sheet === 'people' ? rel.event_id : rel.person_id)}>{sheet === 'people' ? games.find(game => game.id === rel.event_id)?.name ?? 'ゲーム未登録' : people.find(person => person.id === rel.person_id)?.display_name ?? '人物未登録'}<Icon name="arrow" size={13}/></button><button type="button" className="adm-icon-button" aria-label={sheet === "games" ? "マスターの担当を解除" : "この参加履歴を外す"} title={sheet === "games" ? "参加履歴を残してマスター担当を解除" : "この履歴だけを外す"} onClick={() => removeRelation(rel.id)}><Icon name="close" size={14}/></button></div><div className="adm-relation-fields"><input aria-label="参加時の名前" value={rel.name_at_event ?? ''} placeholder="参加時の名前" onChange={event => changeRelation(rel.id, { name_at_event: nullable(event.target.value) })}/><select aria-label="参加区分" value={rel.kind ?? 'participant'} onChange={event => changeRelation(rel.id, { kind: event.target.value })}><option value="participant">参加者</option><option value="master">マスター</option>{rel.kind && !['participant', 'master'].includes(rel.kind) && <option value={rel.kind}>{rel.kind}</option>}</select></div>{rel.status !== 'attended' && <small>参加状態: {rel.status}</small>}</div>)}{!relations.some(rel => sheet === 'people' || rel.kind === 'master') && <p className="adm-empty-inline">{sheet === 'people' ? '参加ゲーム' : 'マスター'}が未登録です。</p>}</div><Picker label={sheet === 'people' ? '参加ゲームを追加' : 'マスターを追加'} value="" options={(sheet === 'people' ? games.map(game => ({ id: game.id, label: game.name })) : people.map(person => ({ id: person.id, label: person.display_name }))).filter(choice => !relations.some(rel => (sheet === 'people' ? rel.event_id === choice.id : rel.person_id === choice.id) && (sheet === 'people' || rel.kind === 'master')))} onChange={value => addRelation(value, sheet === 'people' ? 'participant' : 'master')} placeholder={sheet === 'people' ? '＋ 参加ゲームを追加' : '＋ マスターを追加'}/>{sheet === 'games' && <small className="adm-relation-note">マスターを解除すると参加者に戻ります。参加時の名前と参加状態は保持されます。</small>}</section>}
        {sheet === 'games' && <section className="adm-editor-section"><h3>関連するシート</h3><div className="adm-related-actions"><button type="button" className="adm-button" onClick={() => onRelated('cards', id)}><Icon name="cards" size={16}/>このゲームのカード<Icon name="arrow" size={13}/></button><button type="button" className="adm-button" onClick={() => onRelated('people', id)}><Icon name="people" size={16}/>このゲームの参加者<Icon name="arrow" size={13}/></button></div></section>}<details className="adm-record-details"><summary>詳細情報</summary><Field label="記録の識別子"><input aria-label="記録の識別子" readOnly value={id}/></Field>{'publication_status' in row && <small>公開状態: {row.publication_status === 'published' ? '公開済み' : row.publication_status}</small>}{isNew && <small>ローカルの新しい記録です。</small>}</details>
      </>}
      {error && <div className="adm-form-error" role="alert">{error}</div>}
    </fieldset>
    <footer className="adm-editor-footer"><small>{dirty ? '未保存の変更あり' : 'ブラウザ内の下書き'}</small><div><button type="button" className="adm-button" disabled={!dirty || saving} onClick={discard}>変更を戻す</button><button type="button" className="adm-button primary" disabled={loading || !row || (!dirty && !isNew) || saving} onClick={() => void save()}>{saving ? '保存中…' : '下書きを保存'}</button></div></footer>
  </aside>;
}

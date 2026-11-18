import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DataGrid, type Column, type DataGridHandle, type RenderEditCellProps, type RowsChangeData, type SortColumn } from 'react-data-grid';
import 'react-data-grid/lib/styles.css';
import type { EventRow, LinkRow, ParticipationRow, PersonRow } from '../database';
import { loadCards, loadCardSortValues, loadGameDetails, loadGameRelations, loadPeopleDetails } from './data';
import { compareSheetText, recordSortKind, sortSheetRows } from './sorting';
import { compareRecordCards, recordSortValues } from './record-sort-values';
import { mergeRows, sheetInfo, sortedDirectory, type CardSummary, type Directory, type PreviewCard, type PreviewStore, type Sheet } from './model';
import { createBlankRecord, gamePasteBaseline, gameReferenceId, hasRecordChanges, inputColumns, mapPasteHeader, matchImageFiles, parseDelimited, personPasteBaseline, planRecordBulk, recordValues, RecordBulkValidationError, type InputColumn, type RecordBaseline, type RecordCells, type RecordEdit, type RecordIssue } from './bulk-records';
import Icon from './Icon';

type Props = {
  sheet: Sheet; directory: Directory; store: PreviewStore; games: EventRow[];
  onSave: (next: PreviewStore) => Promise<void>; onDirty: (value: boolean) => void;
  onOpen: (sheet: Sheet, id: string) => void; onNavigate: (sheet: Sheet, id: string) => void;
  onHold: (sheet: Sheet, id: string) => void; onReload?: () => void; saving?: boolean;
  imageUrls?: Record<string, string>; gameArtwork?: Record<string, string>; initialGameId?: string;
};
type GridRecord = { id: string; values: RecordCells; baseline: RecordBaseline | null; isNew: boolean; modified: boolean; held: boolean; issueFields: ReadonlySet<string>; imageSrc: string };
type PasteState = { text: string; startId: string | null; startColumn: number; mode: 'new' | 'replace'; delimiter: string };
const NO_ISSUES: ReadonlySet<string> = new Set(), ROW_HEIGHT = 54;
const sheetViews = new Map<Sheet, { q: string; gameId: string; sort: string; top: number; left: number }>();
function inputColumnLayout(definition: InputColumn): Pick<Column<GridRecord>, 'width' | 'minWidth'> {
  const fixed = definition.kind === 'image' ? 116 : definition.kind === 'number' ? 100 : definition.kind === 'choice' ? 105 : definition.kind === 'date' ? 150 : definition.key === 'source_card_id' ? 90 : null;
  if (fixed !== null) return { width: fixed, minWidth: Math.min(fixed, 80) };
  const minimum = definition.kind === 'long' ? 240 : definition.key === 'event_ids' || definition.key === 'master_ids' ? 260 : definition.key === 'event_id' || definition.key === 'schedule_note' ? 180 : 210;
  const weight = definition.kind === 'long' || definition.key === 'event_ids' || definition.key === 'master_ids' ? 2 : 1;
  // RDG measures CSS grid tracks, preserving native resizing and horizontal scrolling.
  return { width: `minmax(${minimum}px, ${weight}fr)`, minWidth: minimum };
}

function CellEditor({ row, column, onRowChange, onClose, definition, onEditing, games, people, listId }: RenderEditCellProps<GridRecord> & { definition: InputColumn; onEditing: (value: boolean, row?: GridRecord) => void; games: EventRow[]; people: PersonRow[]; listId: string }) {
  const control = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null);
  useLayoutEffect(() => { control.current?.focus({ preventScroll: true }); if (control.current instanceof HTMLInputElement || control.current instanceof HTMLTextAreaElement) control.current.select(); return () => onEditing(false); }, [onEditing]);
  function change(value: string) { const updated = { ...row, values: { ...row.values, [column.key]: value } }; onEditing(value !== row.baseline?.values[column.key], updated); onRowChange(updated); }
  const shared = { className: 'adm-grid-editor', 'aria-label': `${definition.label}を編集`, value: row.values[column.key] ?? '', onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => change(event.target.value), onBlur: () => onClose(true, false) };
  if (definition.key === 'event_id') return <select {...shared} ref={element => { control.current = element; }}><option value="">ゲームを選択</option>{games.map(game => <option key={game.id} value={game.id}>{game.name}</option>)}</select>;
  if (definition.kind === 'choice') return <select {...shared} ref={element => { control.current = element; }}><option value="">未設定</option>{row.values[column.key] && !definition.choices?.includes(row.values[column.key]) && <option value={row.values[column.key]}>{row.values[column.key]}</option>}{definition.choices?.map(value => <option key={value}>{value}</option>)}</select>;
  if (definition.kind === 'long') return <textarea {...shared} ref={element => { control.current = element; }} rows={5} onKeyDown={event => { if (event.key === 'Enter' && event.shiftKey) event.stopPropagation(); }}/>;
  const choices = definition.key === 'event_ids' ? games.map(game => game.name) : definition.key === 'master_ids' ? people.map(person => person.display_name) : [];
  return <><input {...shared} ref={element => { control.current = element; }} type="text" inputMode={definition.kind === 'number' ? 'numeric' : undefined} list={choices.length ? listId : undefined} placeholder={definition.kind === 'date' ? 'YYYY-MM-DD' : definition.key === 'x' ? '@ID またはURL' : definition.key === 'event_ids' || definition.key === 'master_ids' ? '名前を ; で区切る' : ''}/>{choices.length > 0 && <datalist id={listId}>{choices.map((value, index) => <option key={`${index}:${value}`} value={value}/>)}</datalist>}</>;
}

function PasteDialog({ state, sheet, onClose, onStage, busy }: { state: PasteState; sheet: Sheet; onClose: () => void; onStage: (data: string[][], mapping: string[], mode: PasteState['mode'], startId: string | null) => Promise<RecordIssue[]>; busy: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null), textRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(state.text), [mode, setMode] = useState(state.mode), [delimiter, setDelimiter] = useState(state.delimiter), [hasHeader, setHasHeader] = useState<boolean | null>(null), [customMapping, setCustomMapping] = useState<string[] | null>(null), [error, setError] = useState('');
  const parsed = useMemo(() => { try { return { rows: parseDelimited(text, delimiter), error: '' }; } catch (cause) { return { rows: [] as string[][], error: cause instanceof Error ? cause.message : '表を読み込めませんでした。' }; } }, [text, delimiter]);
  const detected = useMemo(() => mapPasteHeader(sheet, parsed.rows[0] ?? []), [sheet, parsed.rows]);
  const header = hasHeader ?? Boolean(detected), data = header ? parsed.rows.slice(1) : parsed.rows;
  const width = Math.max(0, ...parsed.rows.map(row => row.length));
  const mapping = customMapping ?? Array.from({ length: width }, (_, index) => header ? detected?.[index] ?? '' : inputColumns[sheet][state.startColumn + index]?.key ?? '');
  useEffect(() => { const element = dialog.current!; element.showModal(); textRef.current?.focus(); return () => element.close(); }, []);
  async function stage() {
    if (!data.length || parsed.error || busy) return;
    const active = mapping.filter(Boolean);
    if (!active.length) { setError('取り込む列を選んでください。'); return; }
    if (new Set(active).size !== active.length) { setError('同じ列を重複して指定しないでください。'); return; }
    try { await onStage(data, mapping, mode, state.startId); onClose(); } catch (cause) { setError(cause instanceof Error ? cause.message : '表を取り込めませんでした。'); }
  }
  function replaceText(value: string) { setText(value); setHasHeader(null); setCustomMapping(null); setError(''); }
  function downloadTemplate() {
    const content = `\uFEFF${inputColumns[sheet].map(column => column.label).join('\t')}\n`, url = URL.createObjectURL(new Blob([content], { type: 'text/tab-separated-values;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${sheetInfo[sheet].name}-入力テンプレート.tsv`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <dialog className="adm-dialog adm-paste-dialog" ref={dialog} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}><header><h2>表を貼り付ける</h2><button className="adm-icon-button" disabled={busy} aria-label="表の取り込みを閉じる" onClick={onClose}><Icon name="close"/></button></header>
    <textarea ref={textRef} className="adm-paste-input" aria-label="Excelやスプレッドシートの表を貼り付ける" placeholder="Excel・スプレッドシートでコピーした表を貼り付け" value={text} disabled={busy} onChange={event => replaceText(event.target.value)}/>
    <div className="adm-paste-controls"><label><input type="checkbox" checked={header} disabled={busy} onChange={event => { setHasHeader(event.target.checked); setCustomMapping(null); }}/>先頭行は列名</label><select aria-label="表の区切り文字" value={delimiter} disabled={busy} onChange={event => { setDelimiter(event.target.value); setHasHeader(null); setCustomMapping(null); }}><option value={'\t'}>タブ区切り</option><option value=",">CSV</option></select><select aria-label="貼り付け先" value={mode} disabled={busy} onChange={event => setMode(event.target.value as PasteState['mode'])}><option value="new">新しい行として追加</option>{state.startId && <option value="replace">選択した行から上書き</option>}</select><label className="adm-button adm-upload">ファイルを選択<input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ''; if (!file) return; if (file.size > 5 * 1024 * 1024) { setError('5MB以下の表を選んでください。'); return; } void file.text().then(value => { setDelimiter(file.name.endsWith('.csv') ? ',' : '\t'); replaceText(value); }).catch(() => setError('ファイルを読み込めませんでした。')); }}/></label></div>
    {data.length > 0 && <><div className="adm-paste-preview"><table><thead><tr>{mapping.map((value, index) => <th key={index}><small>{header ? parsed.rows[0][index] || `${index + 1}列目` : `${index + 1}列目`}</small><select aria-label={`${index + 1}列目の取り込み先`} value={value} disabled={busy} onChange={event => setCustomMapping(mapping.map((key, position) => position === index ? event.target.value : key))}><option value="">取り込まない</option>{inputColumns[sheet].map(column => <option key={column.key} value={column.key}>{column.label}</option>)}</select></th>)}</tr></thead><tbody>{data.slice(0, 8).map((row, index) => <tr key={index}>{mapping.map((_, column) => <td key={column}>{row[column] ?? ''}</td>)}</tr>)}</tbody></table></div><span className="adm-entry-footer">{data.length.toLocaleString('ja-JP')}行{data.length > 8 ? '・先頭8行を表示' : ''}</span></>}
    {(error || parsed.error) && <div className="adm-form-error" role="alert">{error || parsed.error}</div>}
    <footer><button className="adm-button" disabled={busy} onClick={downloadTemplate}>入力テンプレート</button><button className="adm-button" disabled={busy} onClick={onClose}>キャンセル</button><button className="adm-button primary" disabled={busy || !data.length || Boolean(parsed.error)} onClick={() => void stage()}>{busy ? '確認中…' : mode === 'new' ? '入力欄に追加' : '入力欄に貼り付け'}</button></footer>
  </dialog>;
}

export default function RecordSheet({ sheet, directory, store, games, onSave, onDirty, onOpen, onNavigate, onHold, onReload, saving = false, imageUrls = {}, gameArtwork = {}, initialGameId = '' }: Props) {
  const initialView = useRef((() => { const cached = sheetViews.get(sheet); return initialGameId && cached?.gameId !== initialGameId ? { q: '', gameId: initialGameId, sort: 'default', top: 0, left: 0 } : cached ?? { q: '', gameId: initialGameId, sort: 'default', top: 0, left: 0 }; })()).current;
  const [q, setQ] = useState(initialView.q), [gameId, setGameId] = useState(initialView.gameId), [sort, setSort] = useState(initialView.sort), [quantity, setQuantity] = useState(sheet === 'cards' ? '100' : '1');
  const [cards, setCards] = useState<Record<string, PreviewCard>>({}), [details, setDetails] = useState<{ relations: ParticipationRow[]; links: LinkRow[] }>({ relations: [], links: [] }), [detailError, setDetailError] = useState('');
  const [sortColumns, setSortColumns] = useState<readonly SortColumn[]>([]), [sorting, setSorting] = useState(false), [sortText, setSortText] = useState<Record<string, Record<string, string>>>({}), [sortEdits, setSortEdits] = useState<Record<string, RecordCells>>({});
  const [newRows, setNewRows] = useState<RecordBaseline[]>([]), [edits, setEdits] = useState<Record<string, RecordEdit>>({}), [issues, setIssues] = useState<RecordIssue[]>([]), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [paste, setPaste] = useState<PasteState | null>(null), [busy, setBusy] = useState(false), [liveEditing, setLiveEditing] = useState(false), [viewport, setViewport] = useState(Math.max(0, Math.floor(initialView.top / ROW_HEIGHT / 50) * 50)), [reload, setReload] = useState(0);
  const grid = useRef<DataGridHandle>(null), before = useRef(new Map<string, RecordBaseline>()), editRef = useRef(edits), liveRow = useRef<GridRecord | null>(null), loadInFlight = useRef(new Set<string>()), loadedPeople = useRef(new Set<string>()), loadedGames = useRef(new Set<string>()), lock = useRef(false), selected = useRef({ id: null as string | null, column: 0 }), imageInput = useRef<HTMLInputElement>(null), imageTarget = useRef<string | null>(null);
  const defaultOrdered = useMemo(() => sortedDirectory(directory, store, sheet, q, gameId, '', sort, details.relations), [directory, store, sheet, q, gameId, sort, details.relations]);
  const people = useMemo(() => mergeRows(directory.people, store.people), [directory.people, store.people]);
  const names = useMemo(() => new Map([...games.map(game => [game.id, game.name] as const), ...people.map(person => [person.id, person.display_name] as const)]), [games, people]);
  const definitions = inputColumns[sheet];
  const sortingValues = useMemo(() => recordSortValues(sheet, defaultOrdered, directory, store, details, names, sortText), [sheet, defaultOrdered, directory, store, details, names, sortText]);
  const defaultPositions = useMemo(() => new Map(defaultOrdered.map((row, index) => [row.id, index])), [defaultOrdered]);
  const ordered = useMemo(() => sortSheetRows<(typeof defaultOrdered)[number]>(defaultOrdered, sortColumns, (row, key) => {
    const value = sortEdits[row.id]?.[key] ?? sortingValues.get(row.id)?.[key];
    return sheet === 'cards' && key === 'event_id' ? names.get(value ?? '') ?? value : value;
  }, recordSortKind, (a, b) => sheet === 'cards' ? compareRecordCards(a as CardSummary, b as CardSummary, sortEdits) : (defaultPositions.get(a.id) ?? 0) - (defaultPositions.get(b.id) ?? 0) || compareSheetText(a.id, b.id)), [defaultOrdered, defaultPositions, sortColumns, sortEdits, sortingValues, sheet, names]);
  useEffect(() => { const previous = sheetViews.get(sheet); sheetViews.set(sheet, { q, gameId, sort, top: previous?.top ?? initialView.top, left: previous?.left ?? initialView.left }); }, [sheet, q, gameId, sort, initialView]);
  useLayoutEffect(() => { const element = grid.current?.element; if (element) { element.scrollTop = initialView.top; element.scrollLeft = initialView.left; } }, [initialView]);
  const loadIds = useMemo(() => ordered.slice(viewport, viewport + 100).map(row => row.id), [ordered, viewport]);
  const loadKey = loadIds.join(',');
  const ensureDetails = useCallback(async (ids: string[]) => {
    const existing = ids.filter(id => !newRows.some(row => row.row.id === id));
    if (sheet === 'cards') {
      const missing = existing.filter(id => !cards[id] && !store.cards[id]);
      if (missing.length) { const loaded = await loadCards(missing); setCards(old => ({ ...old, ...Object.fromEntries(loaded.map(row => [row.id, row])) })); return loaded; }
    } else if (sheet === 'people') {
      const requested = existing.filter(id => directory.people.some(person => person.id === id));
      if (requested.length) {
        // Return the complete cached snapshot even when a background fetch has
        // finished before React replaces a caller's loading-row snapshot.
        const loaded = await loadPeopleDetails(requested);
        requested.forEach(id => loadedPeople.current.add(id));
        setDetails(old => ({ relations: mergeRows(old.relations, Object.fromEntries(loaded.relations.map(row => [row.id, row]))), links: mergeRows(old.links, Object.fromEntries(loaded.links.map(row => [row.id, row]))) }));
        return loaded;
      }
    } else if (sheet === 'games') {
      const requested = existing.filter(id => directory.games.some(game => game.id === id));
      const fetched: ParticipationRow[] = [], fetchedLinks: LinkRow[] = [];
      for (let offset = 0; offset < requested.length; offset += 3) {
        const group = requested.slice(offset, offset + 3), batches = await Promise.all(group.map(id => loadGameDetails(id)));
        group.forEach(id => loadedGames.current.add(id));
        const relations = batches.flatMap(batch => batch.relations), links = batches.flatMap(batch => batch.links); fetched.push(...relations); fetchedLinks.push(...links);
        setDetails(old => ({ links: mergeRows(old.links, Object.fromEntries(links.map(row => [row.id, row]))), relations: mergeRows(old.relations, Object.fromEntries(relations.map(row => [row.id, row]))) }));
      }
      return { links: fetchedLinks, relations: fetched };
    }
    return null;
  }, [sheet, newRows, cards, store.cards, directory.people, directory.games]);
  useEffect(() => {
    const missing = loadIds.filter(id => !loadInFlight.current.has(id) && (sheet === 'cards' ? !cards[id] && !store.cards[id] : sheet === 'people' ? !loadedPeople.current.has(id) && directory.people.some(person => person.id === id) : !loadedGames.current.has(id) && directory.games.some(game => game.id === id)));
    if (!missing.length) return;
    missing.forEach(id => loadInFlight.current.add(id));
    void ensureDetails(missing).then(() => setDetailError('')).catch(cause => setDetailError(cause instanceof Error ? cause.message : 'セルの情報を読み込めませんでした。')).finally(() => missing.forEach(id => loadInFlight.current.delete(id)));
  }, [loadKey, reload, sheet, cards, store.cards, directory.people, directory.games, ensureDetails]);
  useEffect(() => {
    if (sheet !== 'people' || !gameId) return;
    let active = true;
    void loadGameRelations(gameId).then(relations => { if (active) setDetails(old => ({ ...old, relations: mergeRows(old.relations, Object.fromEntries(relations.map(row => [row.id, row]))) })); }).catch(cause => { if (active) setDetailError(cause instanceof Error ? cause.message : '参加ゲームを読み込めませんでした。'); });
    return () => { active = false; };
  }, [sheet, gameId, reload]);
  const baselines = useMemo(() => {
    const map = new Map<string, RecordBaseline>(newRows.map(row => [row.row.id, row]));
    const relations = mergeRows(mergeRows(directory.masters, Object.fromEntries(details.relations.map(row => [row.id, row]))), store.relations, store.removedRelations), links = mergeRows(details.links, store.links, store.removedLinks);
    for (const item of ordered) {
      const row = sheet === 'cards' ? store.cards[item.id] ?? cards[item.id] : item;
      if (!row || (sheet === 'people' && directory.people.some(person => person.id === item.id) && !loadedPeople.current.has(item.id)) || (sheet === 'games' && directory.games.some(game => game.id === item.id) && !loadedGames.current.has(item.id))) continue;
      const snapshot = { row: row as PreviewCard | PersonRow | EventRow, relations: sheet === 'people' ? relations.filter(rel => rel.person_id === row.id) : sheet === 'games' ? relations.filter(rel => rel.event_id === row.id) : [], links: sheet === 'people' ? links.filter(link => link.person_id === row.id) : sheet === 'games' ? links.filter(link => link.event_id === row.id && !link.person_id) : [] };
      map.set(item.id, { ...snapshot, isNew: false, values: recordValues(sheet, snapshot, names, store.gameImageUrls[item.id] ?? gameArtwork[item.id] ?? '') });
    }
    return map;
  }, [newRows, ordered, sheet, store, cards, details, directory.masters, directory.people, directory.games, names, gameArtwork]);
  const changedCount = useMemo(() => Object.values(edits).filter(edit => { const baseline = before.current.get(edit.id); return baseline && hasRecordChanges(baseline, edit); }).length, [edits]);
  const dirty = changedCount > 0 || liveEditing;
  useLayoutEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useLayoutEffect(() => () => onDirty(false), [onDirty]);
  useEffect(() => { const listener = (event: BeforeUnloadEvent) => { if (dirty || lock.current) event.preventDefault(); }; window.addEventListener('beforeunload', listener); return () => window.removeEventListener('beforeunload', listener); }, [dirty]);
  const setEditing = useCallback((value: boolean, row?: GridRecord) => { liveRow.current = value && row ? row : null; setLiveEditing(value); }, []);
  const updateEdits = useCallback((next: Record<string, RecordEdit>) => { editRef.current = next; setEdits(next); }, []);
  const issueMap = useMemo(() => { const map = new Map<string, Set<string>>(); for (const issue of issues) { const fields = map.get(issue.id) ?? new Set<string>(); fields.add(issue.field); map.set(issue.id, fields); } return map; }, [issues]);
  const [fileUrls, setFileUrls] = useState<Record<string, string>>({}), fileUrlCache = useRef(new Map<string, { blob: Blob; url: string }>());
  useLayoutEffect(() => {
    let changed = false;
    const images = new Map(Object.values(edits).filter(edit => edit.image).map(edit => [edit.id, edit.image!]));
    for (const [id, cached] of fileUrlCache.current) if (images.get(id) !== cached.blob) { URL.revokeObjectURL(cached.url); fileUrlCache.current.delete(id); changed = true; }
    for (const [id, blob] of images) if (!fileUrlCache.current.has(id)) { fileUrlCache.current.set(id, { blob, url: URL.createObjectURL(blob) }); changed = true; }
    if (changed) setFileUrls(Object.fromEntries([...fileUrlCache.current].map(([id, cached]) => [id, cached.url])));
  }, [edits]);
  useLayoutEffect(() => () => { for (const cached of fileUrlCache.current.values()) URL.revokeObjectURL(cached.url); fileUrlCache.current.clear(); }, []);
  function openImagePicker(id: string | null) { imageTarget.current = id; if (imageInput.current) { imageInput.current.multiple = id === null; imageInput.current.click(); } }
  const gridRows = useMemo<GridRecord[]>(() => [...newRows.map(row => row.row), ...ordered].map(item => {
    const baseline = before.current.get(item.id) ?? baselines.get(item.id) ?? null, edit = edits[item.id];
    const values = edit?.values ?? baseline?.values ?? Object.fromEntries(definitions.map(column => [column.key, (item as unknown as Record<string, unknown>)[column.key] == null ? '' : String((item as unknown as Record<string, unknown>)[column.key])]));
    const editedImageUrl = edit && baseline && (edit.values.imageUrl !== baseline.values.imageUrl || edit.removeImage);
    return { id: item.id, values, baseline, isNew: baseline?.isNew ?? false, modified: Boolean(edit && baseline && hasRecordChanges(baseline, edit)), held: Boolean(store.holds[`${sheet}:${item.id}`]), issueFields: issueMap.get(item.id) ?? NO_ISSUES, imageSrc: fileUrls[item.id] || (editedImageUrl ? values.imageUrl : imageUrls[`${sheet}:${item.id}`] || values.imageUrl || '') };
  }), [newRows, ordered, baselines, edits, definitions, store.holds, sheet, issueMap, fileUrls, imageUrls]);
  const stageRow = useCallback((row: GridRecord, columnKey?: string) => {
    if (lock.current || saving || !row.baseline) return;
    if (!before.current.has(row.id)) before.current.set(row.id, row.baseline);
    const previous = editRef.current[row.id], imageUrlEdited = columnKey === 'imageUrl' || row.values.imageUrl !== (previous?.values.imageUrl ?? row.baseline.values.imageUrl);
    updateEdits({ ...editRef.current, [row.id]: { ...previous, id: row.id, values: row.values, ...(imageUrlEdited ? { image: undefined, removeImage: Boolean(store.images[`${sheet}:${row.id}`]) } : {}) } });
    setIssues(old => old.filter(issue => issue.id !== row.id)); setError('');
  }, [saving, updateEdits, store.images, sheet]);
  const clearImage = useCallback((row: GridRecord) => {
    if (lock.current || saving || !row.baseline) return;
    if (!before.current.has(row.id)) before.current.set(row.id, row.baseline);
    const previous = editRef.current[row.id];
    updateEdits({ ...editRef.current, [row.id]: { ...previous, id: row.id, values: { ...row.values, imageUrl: '' }, image: undefined, removeImage: Boolean(store.images[`${sheet}:${row.id}`]) || Boolean(row.baseline.values.imageUrl) } });
    setIssues(old => old.filter(issue => issue.id !== row.id)); setError('');
  }, [saving, updateEdits, store.images, sheet]);
  const columns = useMemo<Column<GridRecord>[]>(() => [
    { key: '_number', name: '#', width: 48, frozen: true, resizable: false, renderCell: ({ row, rowIdx }) => <span className="adm-muted">{row.isNew ? '+' : rowIdx - newRows.length + 1}</span> },
    { key: '_hold', name: '保留', width: 52, frozen: true, resizable: false, renderCell: ({ row, tabIndex }) => <button className={`adm-icon-button ${row.held ? 'active' : ''}`} title={row.held ? '保留を解除' : '保留にする'} aria-label={row.held ? '保留を解除' : '保留にする'} aria-pressed={row.held} disabled={row.isNew || saving || busy || row.modified || dirty} tabIndex={tabIndex} onClick={() => onHold(sheet, row.id)}><Icon name="pending" size={16}/></button> },
    ...definitions.map((definition, index): Column<GridRecord> => ({ key: definition.key, name: definition.label, sortable: definition.kind !== 'image' && !busy && !sorting && !saving, sortDescendingFirst: definition.key === 'rank', frozen: sheet === 'cards' ? index === 0 : sheet === 'people' ? index === 0 : index <= 1, ...inputColumnLayout(definition),
      editable: row => Boolean(row.baseline) && !saving && !busy && !sorting,
      cellClass: row => `adm-grid-cell ${row.baseline && row.values[definition.key] !== row.baseline.values[definition.key] ? 'modified' : ''} ${row.issueFields.has(definition.key) ? 'invalid' : ''}`,
      renderCell: ({ row, tabIndex }) => definition.kind === 'image' ? <div className="adm-grid-image"><button className={sheet === 'games' ? 'adm-game-art-button' : 'adm-card-thumb'} disabled={saving || busy || !row.baseline} aria-label="画像を選択" tabIndex={tabIndex} onClick={() => openImagePicker(row.id)}>{row.imageSrc ? <img src={row.imageSrc} alt=""/> : <Icon name="image" size={16}/>}</button><span title={row.values[definition.key]}>{edits[row.id]?.image ? '画像を選択済み' : row.values[definition.key] ? '画像URL' : '—'}</span>{row.imageSrc && <button className="adm-icon-button" tabIndex={tabIndex} aria-label="画像を解除" title="画像を解除" disabled={saving || busy || !row.baseline} onClick={() => clearImage(row)}><Icon name="close" size={15}/></button>}</div> : <span title={row.values[definition.key]}>{definition.key === 'event_id' ? names.get(row.values[definition.key]) ?? row.values[definition.key] : row.values[definition.key] || (!row.baseline ? '読み込み中…' : '')}</span>,
      renderEditCell: props => <CellEditor {...props} definition={definition} onEditing={setEditing} games={games} people={people} listId={`adm-entry-options-${sheet}-${definition.key}`}/>,
    })),
    { key: '_open', name: '', width: 48, resizable: false, renderCell: ({ row, tabIndex }) => <button className="adm-icon-button" title="詳しく編集" aria-label="記録を詳しく編集" disabled={row.isNew || saving || busy || dirty} tabIndex={tabIndex} onClick={() => onOpen(sheet, row.id)}><Icon name="chevron" size={16}/></button> },
  ], [definitions, sheet, names, saving, busy, sorting, dirty, newRows.length, onHold, onOpen, games, people, setEditing, edits, clearImage]);
  function rowsChanged(rows: GridRecord[], { indexes, column }: RowsChangeData<GridRecord>) { for (const index of indexes) stageRow(rows[index], column.key); setLiveEditing(false); }
  function addRows(count: number) {
    if (saving || lock.current) return;
    if (sheet === 'cards' && !gameId) { setError('先に所属ゲームを選んでください。'); return; }
    if (!Number.isInteger(count) || count < 1 || count > 500) { setError('追加する行数は1〜500で入力してください。'); return; }
    const created = Array.from({ length: count }, () => createBlankRecord(sheet, gameId));
    created.forEach(row => before.current.set(row.row.id, row)); setNewRows(old => [...created, ...old]); setError('');
    requestAnimationFrame(() => grid.current?.selectCell({ rowIdx: 0, idx: definitions.findIndex(column => column.key === (sheet === 'people' ? 'display_name' : 'name')) + 2 }, { enableEditor: true }));
  }
  async function save() {
    if (saving || lock.current) return;
    if (liveRow.current) stageRow(liveRow.current, definitions[selected.current.column]?.key);
    if (liveEditing) grid.current?.selectCell({ rowIdx: gridRows.findIndex(row => row.id === selected.current.id), idx: selected.current.column + 2 });
    lock.current = true; setBusy(true); setError('');
    try {
      const plan = planRecordBulk(sheet, store, before.current, editRef.current, directory);
      if (!plan) { setNotice('入力内容に変更はありません。'); return; }
      await onSave(plan.next);
      setNewRows(old => old.filter(row => !plan.changedIds.includes(row.row.id))); updateEdits({}); setSortEdits({}); before.current.clear(); setIssues([]); setLiveEditing(false); setNotice(`${plan.changedIds.length}件を下書きに保存しました。`);
    } catch (cause) {
      if (cause instanceof RecordBulkValidationError) { setIssues(cause.issues); const index = gridRows.findIndex(row => row.id === cause.issues[0]?.id); if (index >= 0) grid.current?.selectCell({ rowIdx: index, idx: definitions.findIndex(column => column.key === cause.issues[0].field) + 2 }); }
      setError(cause instanceof Error ? cause.message : '入力を保存できませんでした。');
    } finally { lock.current = false; setBusy(false); }
  }
  async function stagePaste(data: string[][], mapping: string[], mode: PasteState['mode'], startId: string | null) {
    if (saving || lock.current) throw new Error('保存が終わるまでお待ちください。');
    if (sheet === 'cards' && !gameId && mode === 'new' && !mapping.includes('event_id')) throw new Error('所属ゲームを選ぶか、表にゲームの列を含めてください。');
    lock.current = true; setBusy(true);
    try {
      const start = mode === 'replace' ? gridRows.findIndex(row => row.id === startId) : -1;
      if (mode === 'replace' && start < 0) throw new Error('貼り付け先の行が見つかりません。');
      const targets = mode === 'replace' ? gridRows.slice(start, start + data.length) : [];
      if (mode === 'replace' && targets.length < data.length) throw new Error('貼り付ける行が一覧を超えています。「新しい行として追加」を選んでください。');
      const loaded = await ensureDetails(targets.filter(row => !row.baseline).map(row => row.id));
      const loadedCards = Array.isArray(loaded) ? new Map(loaded.map(row => [row.id, row])) : new Map<string, PreviewCard>();
      const loadedPeopleData = loaded && !Array.isArray(loaded) ? loaded : { links: [] as LinkRow[], relations: [] as ParticipationRow[] };
      const created: RecordBaseline[] = [], planned = { ...editRef.current };
      for (const [index, cells] of data.entries()) {
        let baseline = mode === 'new' ? createBlankRecord(sheet, gameId) : before.current.get(targets[index].id) ?? targets[index].baseline;
        if (!baseline && sheet === 'cards') { const row = loadedCards.get(targets[index].id); if (row) { const snapshot = { row, links: [], relations: [] }; baseline = { ...snapshot, isNew: false, values: recordValues(sheet, snapshot, names) }; } }
        if (!baseline && sheet === 'people') baseline = personPasteBaseline(targets[index].id, directory, store, loadedPeopleData, names);
        if (!baseline && sheet === 'games') baseline = gamePasteBaseline(targets[index].id, directory, store, loadedPeopleData.relations, names, gameArtwork[targets[index].id] ?? '', loadedPeopleData.links);
        if (!baseline) throw new Error('貼り付け先の情報を読み込めませんでした。再試行してください。');
        if (mode === 'new') created.push(baseline);
        before.current.set(baseline.row.id, baseline);
        const values = { ...(planned[baseline.row.id]?.values ?? baseline.values) };
        mapping.forEach((key, column) => { if (key) values[key] = cells[column] ?? ''; });
        planned[baseline.row.id] = { ...planned[baseline.row.id], id: baseline.row.id, values, ...(mapping.includes('imageUrl') ? { image: undefined, removeImage: Boolean(store.images[`${sheet}:${baseline.row.id}`]) } : {}) };
      }
      let found: RecordIssue[] = [];
      try { planRecordBulk(sheet, store, before.current, planned, directory); } catch (cause) { if (cause instanceof RecordBulkValidationError) found = cause.issues; else throw cause; }
      setNewRows(old => [...created, ...old]); updateEdits(planned); setIssues(found); setError(found.length ? `${found.length}件の入力を確認してください。入力欄は保持されています。` : ''); setNotice(`${data.length}行を入力欄に${mode === 'new' ? '追加' : '貼り付け'}ました。`);
      requestAnimationFrame(() => grid.current?.selectCell({ rowIdx: mode === 'new' ? 0 : start, idx: Math.max(2, definitions.findIndex(column => column.key === mapping.find(Boolean)) + 2) }));
      return found;
    } finally { lock.current = false; setBusy(false); }
  }
  async function chooseImages(files: File[], target: string | null) {
    if (saving || lock.current || !files.length) return;
    lock.current = true; setBusy(true);
    try {
      const rowTargets = target ? gridRows.filter(row => row.id === target) : gridRows.filter(row => { if (sheet !== 'cards') return false; try { return gameReferenceId(row.values.event_id, games) === gameId; } catch { return false; } });
      if (!target && !gameId) throw new Error('画像をまとめて選ぶ前に、所属ゲームを選んでください。');
      const result = target ? { matches: [{ id: target, fileIndex: 0 }], unmatched: [] as string[] } : matchImageFiles(files, rowTargets.map(row => ({ id: row.id, sourceId: row.values.source_card_id || '' })));
      const loaded = await ensureDetails(result.matches.map(match => match.id));
      const loadedCards = Array.isArray(loaded) ? new Map(loaded.map(row => [row.id, row])) : new Map<string, PreviewCard>();
      const next = { ...editRef.current };
      for (const match of result.matches) {
        const file = files[match.fileIndex];
        if (file.size > 10 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('画像は PNG / JPEG / WebP の10MB以下を選んでください。');
        const current = gridRows.find(row => row.id === match.id); let baseline = before.current.get(match.id) ?? current?.baseline;
        if (!baseline && loadedCards.has(match.id)) { const snapshot = { row: loadedCards.get(match.id)!, links: [], relations: [] }; baseline = { ...snapshot, isNew: false, values: recordValues(sheet, snapshot, names) }; }
        if (!baseline) throw new Error('画像の関連付け先を読み込めませんでした。');
        before.current.set(match.id, baseline); next[match.id] = { id: match.id, values: next[match.id]?.values ?? current?.values ?? baseline.values, image: file };
      }
      updateEdits(next); setNotice(`${result.matches.length}枚の画像を関連付けました。`); setError(result.unmatched.length ? `関連付けできなかった画像 ${result.unmatched.length}枚：${result.unmatched.slice(0, 5).join('、')}${result.unmatched.length > 5 ? '…' : ''}。画像のファイル名をカードIDに合わせてください。` : '');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '画像を関連付けできませんでした。'); }
    finally { lock.current = false; setBusy(false); }
  }
  function discard() { updateEdits({}); setSortEdits({}); before.current.clear(); setNewRows([]); setIssues([]); setError(''); setLiveEditing(false); }
  async function changeSortColumns(next: readonly SortColumn[]) {
    if (saving || lock.current) return;
    if (liveRow.current) stageRow(liveRow.current);
    const currentSelection = { ...selected.current };
    lock.current = true; setBusy(true); setSorting(true); setDetailError('');
    try {
      for (const { columnKey } of next) {
        if (sheet === 'cards' && (columnKey === 'effect_text' || columnKey === 'flavor_text') && !sortText[columnKey]) {
          const values = await loadCardSortValues(columnKey); setSortText(old => ({ ...old, [columnKey]: values }));
        }
      }
      if (sheet === 'people' && next.some(column => ['x', 'blog', 'event_ids'].includes(column.columnKey))) await ensureDetails(directory.people.map(person => person.id));
      if (sheet === 'games' && next.some(column => ['x', 'blog', 'board'].includes(column.columnKey))) await ensureDetails(directory.games.map(game => game.id));
      // Like a spreadsheet, edits do not move a row until another sort is requested.
      setSortEdits(Object.fromEntries(Object.values(editRef.current).map(edit => [edit.id, { ...edit.values }])));
      selected.current = currentSelection; setSortColumns(next); setLiveEditing(false);
    } catch (cause) { setDetailError(cause instanceof Error ? cause.message : '並び替えに必要な情報を読み込めませんでした。'); }
    finally { lock.current = false; setBusy(false); setSorting(false); }
  }
  function changePreset(value: string) { setSortColumns([]); setSortEdits({}); filter(() => setSort(value)); }
  function filter(action: () => void) { action(); setViewport(0); if (grid.current?.element) grid.current.element.scrollTop = 0; const previous = sheetViews.get(sheet); if (previous) sheetViews.set(sheet, { ...previous, top: 0 }); }
  return <div className="adm-record-sheet">
    <div className="adm-toolbar"><div className="adm-search"><Icon name="search" size={18}/><input aria-label={`${sheetInfo[sheet].name}を検索`} value={q} disabled={busy} placeholder={sheet === 'cards' ? 'カード名・IDで検索' : '名前で検索'} onChange={event => filter(() => setQ(event.target.value))}/>{q && <button className="adm-icon-button" aria-label="検索をクリア" onClick={() => filter(() => setQ(''))}><Icon name="close" size={15}/></button>}</div><div className="adm-toolbar-filters">{sheet !== 'games' && <label className="adm-filter-select"><Icon name="games" size={16}/><select aria-label="ゲームで絞り込む" value={gameId} disabled={busy} onChange={event => filter(() => setGameId(event.target.value))}><option value="">すべてのゲーム</option>{games.map(game => <option key={game.id} value={game.id}>{game.name}</option>)}</select></label>}<select className="adm-filter-select" aria-label="並び順" disabled={busy} value={sortColumns.length ? "columns" : sort} onChange={event => changePreset(event.target.value)}>{sortColumns.length > 0 && <option value="columns">列の並び替え</option>}<option value="default">{sheet === 'people' ? '入学順' : sheet === 'games' ? '最新順' : 'ゲーム順'}</option><option value="name">名前順</option>{sheet === 'cards' && <option value="rank">ランク順</option>}</select>{onReload && <button className="adm-icon-button" aria-label="再読み込み" title="再読み込み" disabled={dirty || busy || saving} onClick={onReload}><Icon name="refresh" size={18}/></button>}</div></div>
    <div className="adm-entry-actions"><label><input aria-label="追加する行数" inputMode="numeric" value={quantity} disabled={busy || saving} onChange={event => setQuantity(event.target.value)}/>行</label><button className="adm-button" disabled={busy || saving} onClick={() => addRows(Number(quantity))}><Icon name="plus" size={16}/>行を追加</button><button className="adm-button" disabled={busy || saving} onClick={() => setPaste({ text: '', mode: 'new', startId: selected.current.id, startColumn: 0, delimiter: '\t' })}>表を貼り付け</button>{sheet === 'cards' && <button className="adm-button" disabled={busy || saving || !gameId} title="画像のファイル名をカードIDに合わせて関連付け" onClick={() => openImagePicker(null)}><Icon name="image" size={16}/>画像をまとめて選択</button>}<span className="adm-batch-count" role="status">{changedCount > 0 ? `変更 ${changedCount}件` : ''}</span>{(changedCount > 0 || newRows.length > 0) && <button className="adm-button" disabled={busy || saving} onClick={() => { if (!dirty || window.confirm('未保存の入力を戻しますか？')) discard(); }}>入力を戻す</button>}<button className="adm-button primary" disabled={(!changedCount && !liveEditing) || busy || saving} onClick={() => void save()}>{busy ? '処理中…' : 'まとめて下書き保存'}</button></div>
    <div className="adm-grid-root"><DataGrid ref={grid} className={`rdg-light ${sheet}`} aria-label={`${sheetInfo[sheet].name}の入力シート`} columns={columns} sortColumns={sortColumns} onSortColumnsChange={next => void changeSortColumns(next)} aria-busy={sorting} rows={gridRows} rowKeyGetter={row => row.id} rowHeight={ROW_HEIGHT} headerRowHeight={42} onRowsChange={rowsChanged} defaultColumnOptions={{ resizable: true }} onSelectedCellChange={({ rowIdx, row, column }) => { if (rowIdx >= 0) selected.current = { id: row?.id ?? null, column: Math.max(0, definitions.findIndex(definition => definition.key === column.key)) }; if (rowIdx >= newRows.length) setViewport(Math.max(0, Math.floor((rowIdx - newRows.length) / 50) * 50)); }} onScroll={event => { sheetViews.set(sheet, { q, gameId, sort, top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft }); const index = Math.max(0, Math.floor((event.currentTarget.scrollTop / ROW_HEIGHT - newRows.length) / 50) * 50); setViewport(old => old === index ? old : index); }} onCellClick={(args, event) => { if (!(event.target as HTMLElement).closest('button') && args.column.editable && args.row.baseline) args.selectCell(true); }} onCellPaste={({ row, column }, event) => { if (!row.baseline || busy || saving || !definitions.some(definition => definition.key === column.key)) return row; const text = event.clipboardData.getData('text/plain'); const startColumn = Math.max(0, definitions.findIndex(definition => definition.key === column.key)); if (text.includes('\t') || (text.includes('\n') && !['effect_text', 'flavor_text'].includes(column.key))) { event.preventDefault(); setPaste({ text, mode: 'replace', startId: row.id, startColumn, delimiter: '\t' }); return row; } if ((event.target as HTMLElement).closest('input,textarea,select')) return row; event.preventDefault(); return { ...row, values: { ...row.values, [column.key]: text } }; }} onCellCopy={({ row, column }, event) => { if ((event.target as HTMLElement).closest('input,textarea,select') || !definitions.some(definition => definition.key === column.key)) return; event.clipboardData.setData('text/plain', row.values[column.key] ?? ''); event.preventDefault(); }} onFill={({ columnKey, sourceRow, targetRow }) => !targetRow.baseline || saving || busy || !definitions.some(definition => definition.key === columnKey) ? targetRow : ({ ...targetRow, values: { ...targetRow.values, [columnKey]: sourceRow.values[columnKey] } })} rowClass={row => row.isNew ? 'adm-grid-new-row' : undefined}/></div>
    <div className="adm-entry-footer"><span>{ordered.length.toLocaleString('ja-JP')}件{newRows.length ? `・新規入力 ${newRows.length}行` : ''}</span><span>列名で並び替え · Tabで移動 · Shift + Enterで改行 · 表をコピーして貼り付け</span>{sheet === 'cards' && gameId && <button className="adm-text-button" disabled={dirty || busy} onClick={() => onNavigate('games', gameId)}>所属ゲームを開く<Icon name="arrow" size={12}/></button>}</div>
    {notice && <span className="adm-entry-footer" role="status">{notice}</span>}{detailError && <div className="adm-table-error" role="alert">{detailError}<button onClick={() => { setReload(old => old + 1); setDetailError(''); }}>再試行</button></div>}{error && <div className="adm-form-error" role="alert">{error}</div>}{issues.length > 0 && <div className="adm-paste-errors">{issues.slice(0, 5).map((issue, index) => <button key={`${issue.id}:${index}`} onClick={() => { const rowIdx = gridRows.findIndex(row => row.id === issue.id); if (rowIdx >= 0) grid.current?.selectCell({ rowIdx, idx: definitions.findIndex(column => column.key === issue.field) + 2 }, { enableEditor: true }); }}>{index + 1}. {issue.message}</button>)}</div>}
    {sheet !== 'people' && <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp" multiple className="adm-sr-only" aria-label="画像ファイルを選択" onChange={event => { const files = Array.from(event.target.files ?? []); event.currentTarget.value = ''; void chooseImages(files, imageTarget.current); }}/>}
    {paste && <PasteDialog state={paste} sheet={sheet} busy={busy} onClose={() => setPaste(null)} onStage={stagePaste}/>}
  </div>;
}

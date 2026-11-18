import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DataGrid, type Column, type DataGridHandle, type RenderEditCellProps, type RowsChangeData, type SortColumn } from 'react-data-grid';
import type { EventRow, ParticipationRow, TeamRow } from '../database';
import { loadTeamRelations } from './data';
import { mergeRows, type Directory, type PreviewStore } from './model';
import { sortedTeams } from './team-model';
import { changedTeamIds, planTeamBulk, TeamBulkValidationError } from './team-bulk';
import TeamEditor from './TeamEditor';
import Icon from './Icon';
import { compareSheetText, recordSortKind, sortSheetRows } from './sorting';

type Props = { directory: Directory; store: PreviewStore; games: EventRow[]; onSave: (next: PreviewStore) => Promise<void>; onDirty: (dirty: boolean) => void; onGame: (id: string) => void; modal: boolean; onEditing: (open: boolean) => void; saving?: boolean; openTeamId?: string | null; onOpened?: () => void; onHold?: (sheet: 'teams', id: string) => void };
type TeamField = 'display_name' | 'rank_value' | 'rank_note' | 'final_score';
type TeamCells = Record<TeamField, string>;
type GridTeam = { id: string; team: TeamRow; values: TeamCells };
const ROW_HEIGHT = 54;
const fields: TeamField[] = ['display_name', 'rank_value', 'rank_note', 'final_score'];
function teamCells(team: TeamRow): TeamCells { return Object.fromEntries(fields.map(key => [key, team[key] == null ? '' : String(team[key])])) as TeamCells; }
function teamEdits(rows: Record<string, GridTeam>): Record<string, TeamRow> { return Object.fromEntries(Object.values(rows).map(row => [row.id, { ...row.team, display_name: row.values.display_name, rank_note: row.values.rank_note.trim() ? row.values.rank_note : null, rank_value: row.values.rank_value.trim() ? Number(row.values.rank_value) : null, final_score: row.values.final_score.trim() ? Number(row.values.final_score) : null }])); }

function TeamCellEditor({ row, column, onRowChange, onClose, onLiveEdit }: RenderEditCellProps<GridTeam> & { onLiveEdit: (dirty: boolean, row: GridTeam | null) => void }) {
  const input = useRef<HTMLInputElement>(null), key = column.key as TeamField, initial = useRef(row.values[key]);
  useLayoutEffect(() => { input.current?.focus({ preventScroll: true }); input.current?.select(); return () => onLiveEdit(false, null); }, [onLiveEdit]);
  return <input ref={input} className="adm-grid-editor" aria-label={`${row.team.display_name}の${column.name}を編集`} value={row.values[key]} inputMode={key === 'rank_value' ? 'numeric' : key === 'final_score' ? 'decimal' : undefined} onChange={event => { const next = { ...row, values: { ...row.values, [key]: event.target.value } }; onLiveEdit(event.target.value !== initial.current, next); onRowChange(next); }} onBlur={() => onClose(true, false)}/>;
}
function PendingDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  return <dialog className="adm-dialog" ref={dialog} onCancel={event => { event.preventDefault(); onCancel(); }}><header><h2>未保存の変更があります</h2><button className="adm-icon-button" aria-label="確認を閉じる" onClick={onCancel}><Icon name="close"/></button></header><p>変更を戻して移動しますか？ 保存する場合は編集を続けてください。</p><footer><button className="adm-button" onClick={onCancel}>編集を続ける</button><button className="adm-button primary" onClick={onConfirm}>変更を戻して移動</button></footer></dialog>;
}

export default function TeamSheet({ directory, store, games, onSave, onDirty, onGame, modal, onEditing, saving = false, openTeamId, onOpened, onHold }: Props) {
  const [q, setQ] = useState(''), [gameId, setGameId] = useState(''), [sort, setSort] = useState('default'), [viewport, setViewport] = useState(0);
  const [sortColumns, setSortColumns] = useState<readonly SortColumn[]>([]), [sorting, setSorting] = useState(false), [sortEdits, setSortEdits] = useState<Record<string, TeamCells>>({});
  const [selection, setSelection] = useState<{ team: TeamRow; isNew: boolean; origin: HTMLElement | null } | null>(null), [dirty, setDirty] = useState(false), [pending, setPending] = useState<(() => void) | null>(null);
  const [bulkMode, setBulkMode] = useState(false), [rawEdits, setRawEdits] = useState<Record<string, GridTeam>>({}), [liveEditing, setLiveEditing] = useState(false), [bulkError, setBulkError] = useState(''), [bulkSaving, setBulkSaving] = useState(false);
  const bulkBefore = useRef<ReadonlyMap<string, TeamRow>>(new Map()), bulkLock = useRef(false), editsRef = useRef(rawEdits), liveRow = useRef<GridTeam | null>(null);
  const [relations, setRelations] = useState<ParticipationRow[]>([]), [readyTeams, setReadyTeams] = useState<Set<string>>(new Set()), [loading, setLoading] = useState(false), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const grid = useRef<DataGridHandle>(null), bulkButton = useRef<HTMLButtonElement>(null);
  const defaultOrdered = useMemo(() => sortedTeams(directory, store, games, q, gameId, sort), [directory, store.teams, games, q, gameId, sort]);
  const edits = useMemo(() => teamEdits(rawEdits), [rawEdits]);
  const gamesById = useMemo(() => new Map(games.map(game => [game.id, game])), [games]);
  const people = useMemo(() => new Map(mergeRows(directory.people, store.people).map(person => [person.id, person])), [directory.people, store.people]);
  const membersByTeam = useMemo(() => {
    const groups = new Map<string, ParticipationRow[]>();
    for (const row of mergeRows(relations, store.relations, store.removedRelations)) if (row.team_id) { const group = groups.get(row.team_id); if (group) group.push(row); else groups.set(row.team_id, [row]); }
    return groups;
  }, [relations, store.relations, store.removedRelations]);
  const memberSortNames = useMemo(() => new Map([...membersByTeam].map(([id, members]) => [id, [...new Map(members.map(member => [member.person_id, member.name_at_event || people.get(member.person_id)?.display_name || '人物未登録'])).values()].sort(compareSheetText).join(' ; ')])), [membersByTeam, people]);
  const ordered = useMemo(() => sortSheetRows(defaultOrdered, sortColumns, (team, key) => key === 'event_id' ? gamesById.get(team.event_id)?.name ?? team.event_id : key === '_members' ? memberSortNames.get(team.id) : sortEdits[team.id]?.[key as TeamField] ?? team[key as TeamField], recordSortKind, (a, b) => compareSheetText(a.display_name, b.display_name) || compareSheetText(a.id, b.id)), [defaultOrdered, sortColumns, gamesById, memberSortNames, sortEdits]);
  const gridRows = useMemo<GridTeam[]>(() => ordered.map(team => rawEdits[team.id] ?? { id: team.id, team, values: teamCells(team) }), [ordered, rawEdits]);
  const idsKey = ordered.slice(Math.max(0, viewport - 25), viewport + 100).map(row => row.id).join(',');
  const changedIds = useMemo(() => changedTeamIds(bulkBefore.current, edits), [edits]);
  const hasUnsaved = dirty || changedIds.length > 0 || liveEditing;
  const onLiveEdit = useCallback((value: boolean, row: GridTeam | null) => { liveRow.current = row; setLiveEditing(value); }, []);
  const updateEdits = useCallback((next: Record<string, GridTeam>) => { editsRef.current = next; setRawEdits(next); }, []);
  useLayoutEffect(() => { onDirty(hasUnsaved); }, [hasUnsaved, onDirty]);
  useEffect(() => { const prevent = (event: BeforeUnloadEvent) => { if (hasUnsaved || bulkLock.current) event.preventDefault(); }; window.addEventListener('beforeunload', prevent); return () => window.removeEventListener('beforeunload', prevent); }, [hasUnsaved]);
  useLayoutEffect(() => { onEditing(Boolean(selection)); }, [selection, onEditing]);
  useLayoutEffect(() => () => { onDirty(false); onEditing(false); }, [onDirty, onEditing]);
  const guard = (action: () => void) => { if (saving || bulkLock.current) return; if (hasUnsaved) setPending(() => action); else action(); };
  const select = (team: TeamRow, isNew = false) => {
    if (bulkMode || selection?.team.id === team.id) return;
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    guard(() => { setSelection({ team, isNew, origin }); setDirty(false); });
  };
  useEffect(() => {
    if (!openTeamId) return;
    const all = sortedTeams(directory, store, games, '', '', 'default'), index = all.findIndex(team => team.id === openTeamId);
    if (index >= 0) { setQ(''); setGameId(''); setSort('default'); setSortColumns([]); setViewport(Math.floor(index / 50) * 50); setSelection({ team: all[index], isNew: false, origin: document.activeElement instanceof HTMLElement ? document.activeElement : null }); setDirty(false); }
    else setError('このチームは現在の一覧にありません。');
    onOpened?.();
  }, [openTeamId, directory, store, games, onOpened]);
  useEffect(() => {
    let cancelled = false; setLoading(true); setError('');
    const existing = new Set((directory.teams ?? []).map(team => team.id)), ids = idsKey.split(',').filter(id => existing.has(id));
    void loadTeamRelations(ids).then(rows => { if (!cancelled) { setRelations(old => mergeRows(old, Object.fromEntries(rows.map(row => [row.id, row])))); setReadyTeams(old => new Set([...old, ...ids])); setLoading(false); } }).catch(cause => { if (!cancelled) { setError(cause instanceof Error ? cause.message : '参加者を読み込めませんでした。'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [idsKey, directory.teams, reload]);
  function filter(action: () => void) { action(); setViewport(0); grid.current?.scrollToCell({ rowIdx: 0 }); }
  async function changeSortColumns(next: readonly SortColumn[]) {
    if (saving || bulkLock.current || sorting) return;
    if (liveRow.current) { updateEdits({ ...editsRef.current, [liveRow.current.id]: liveRow.current }); liveRow.current = null; setLiveEditing(false); }
    setSorting(true); setError('');
    try {
      if (next.some(column => column.columnKey === '_members')) {
        const ids = (directory.teams ?? []).map(team => team.id), rows = await loadTeamRelations(ids);
        setRelations(old => mergeRows(old, Object.fromEntries(rows.map(row => [row.id, row])))); setReadyTeams(old => new Set([...old, ...ids]));
      }
      setSortEdits(Object.fromEntries(Object.values(editsRef.current).map(row => [row.id, { ...row.values }])));
      filter(() => setSortColumns(next));
    } catch (cause) { setError(cause instanceof Error ? cause.message : '並び替えに必要な情報を読み込めませんでした。'); }
    finally { setSorting(false); }
  }
  function startBulk() {
    guard(() => {
      bulkBefore.current = new Map(mergeRows(directory.teams ?? [], store.teams).map(team => [team.id, team]));
      setSelection(null); setDirty(false); updateEdits({}); setLiveEditing(false); setBulkError(''); setBulkMode(true);
      requestAnimationFrame(() => grid.current?.selectCell({ rowIdx: 0, idx: 2 }, { enableEditor: true }));
    });
  }
  function focusBulkButton() { requestAnimationFrame(() => { if (document.activeElement === document.body) bulkButton.current?.focus({ preventScroll: true }); }); }
  function stopBulk() { guard(() => { updateEdits({}); setSortEdits({}); setLiveEditing(false); setBulkMode(false); setBulkError(''); focusBulkButton(); }); }
  function rowsChanged(rows: GridTeam[], data: RowsChangeData<GridTeam>) {
    if (saving || bulkLock.current) return;
    const next = { ...editsRef.current }; for (const index of data.indexes) next[rows[index].id] = rows[index];
    updateEdits(next); setBulkError('');
  }
  async function saveBulk() {
    if (saving || bulkLock.current) return;
    if (liveRow.current) { updateEdits({ ...editsRef.current, [liveRow.current.id]: liveRow.current }); liveRow.current = null; }
    bulkLock.current = true; setBulkSaving(true); setBulkError('');
    try {
      const result = planTeamBulk(store, bulkBefore.current, teamEdits(editsRef.current), games);
      if (result) await onSave(result.next);
      updateEdits({}); setSortEdits({}); setLiveEditing(false); setBulkMode(false); focusBulkButton();
    } catch (cause) {
      setBulkError(cause instanceof Error ? cause.message : '変更を保存できませんでした。');
      if (cause instanceof TeamBulkValidationError) {
        const all = sortedTeams(directory, store, games, '', '', 'default'), index = all.findIndex(team => team.id === cause.teamId);
        setQ(''); setGameId(''); setSort('default'); setSortColumns([]); setViewport(Math.max(0, Math.floor(index / 50) * 50));
        const idx = /得点/.test(cause.message) ? 6 : /順位/.test(cause.message) ? 4 : 2;
        requestAnimationFrame(() => grid.current?.selectCell({ rowIdx: Math.max(0, index), idx }, { enableEditor: true }));
      }
    } finally { bulkLock.current = false; setBulkSaving(false); }
  }
  const editColumn = (key: TeamField, name: string, width: number | string, frozen = false): Column<GridTeam> => ({ key, name, width, sortable: !sorting && !bulkSaving && !saving, sortDescendingFirst: key === 'final_score', minWidth: key === 'rank_note' ? 160 : undefined, frozen, editable: bulkMode && !saving && !bulkSaving && !sorting, cellClass: row => `adm-grid-cell ${row.values[key] !== String((bulkBefore.current.get(row.id) ?? row.team)[key] ?? '') && bulkMode ? 'modified' : ''}`,
    renderEditCell: props => <TeamCellEditor {...props} onLiveEdit={onLiveEdit}/>, renderCell: ({ row, tabIndex }) => key === 'display_name' && !bulkMode ? <button className="adm-row-title" tabIndex={tabIndex} onClick={() => select(row.team)}>{store.teams[row.id] && <span className="adm-changed-dot" aria-hidden="true"/>}{row.values[key]}</button> : <span>{row.values[key] || '—'}</span> });
  const columns: Column<GridTeam>[] = [
    { key: '_number', name: '#', width: 48, minWidth: 48, frozen: true, resizable: false, renderCell: ({ rowIdx }) => <span className="adm-muted">{rowIdx + 1}</span> },
    { key: '_hold', name: '保留', width: 56, minWidth: 56, frozen: true, resizable: false, renderCell: ({ row, tabIndex }) => <button className={`adm-icon-button ${store.holds[`teams:${row.id}`] ? 'active' : ''}`} tabIndex={tabIndex} aria-label={`${row.team.display_name}を${store.holds[`teams:${row.id}`] ? '保留解除' : '保留にする'}`} aria-pressed={Boolean(store.holds[`teams:${row.id}`])} disabled={!onHold || saving || bulkSaving || hasUnsaved} onClick={() => onHold?.('teams', row.id)}><Icon name="pending" size={16}/></button> },
    editColumn('display_name', 'チーム名', 244, true),
    { key: 'event_id', name: '所属ゲーム', sortable: !sorting && !bulkSaving && !saving, width: 'minmax(200px, 1fr)', minWidth: 200, renderCell: ({ row, tabIndex }) => <button className="adm-game-link" tabIndex={tabIndex} onClick={() => onGame(row.team.event_id)}>{gamesById.get(row.team.event_id)?.name ?? 'ゲーム未登録'}</button> },
    editColumn('rank_value', '順位', 100), editColumn('rank_note', '順位補足', 'minmax(160px, 1fr)'), editColumn('final_score', '最終得点', 120),
    { key: '_members', name: '参加者', sortable: !sorting && !bulkSaving && !saving, width: 'minmax(280px, 2fr)', minWidth: 280, renderCell: ({ row, tabIndex }) => { const members = [...new Map((membersByTeam.get(row.id) ?? []).map(member => [member.person_id, member])).values()], ready = readyTeams.has(row.id) || !(directory.teams ?? []).some(team => team.id === row.id); return <div className="adm-chips">{members.slice(0, 2).map(member => <span className="adm-chip person" key={member.person_id}>{member.name_at_event || people.get(member.person_id)?.display_name || '人物未登録'}</span>)}{members.length > 2 && <button className="adm-chip more" tabIndex={tabIndex} disabled={bulkMode} onClick={() => select(row.team)}>＋{members.length - 2}</button>}{!members.length && <span className="adm-muted">{ready ? '—' : '読み込み中…'}</span>}{ready && <small className="adm-muted">{members.length}人</small>}</div>; } },
    { key: '_open', name: '編集', width: 60, minWidth: 60, resizable: false, renderCell: ({ row, tabIndex }) => <button className="adm-icon-button" tabIndex={tabIndex} disabled={bulkMode} aria-label={`${row.team.display_name}を編集`} onClick={() => select(row.team)}><Icon name="chevron" size={16}/></button> },
  ];
  const editor = selection && <TeamEditor key={selection.team.id} team={selection.team} isNew={selection.isNew} originElement={selection.origin} directory={directory} store={store} games={games} modal={modal} onSave={onSave} onDirty={setDirty} onClose={() => guard(() => { setSelection(null); setDirty(false); })} onGame={onGame}/>;
  const editorHost = document.getElementById('adm-team-editor-host');
  return <div className="adm-team-workspace"><div className="adm-team-sheet" inert={Boolean(selection)}>
    <div className="adm-toolbar"><div className="adm-search"><Icon name="search" size={18}/><input aria-label="チームを検索" value={q} disabled={bulkSaving} placeholder="チーム名・ゲームで検索" onChange={event => filter(() => setQ(event.target.value))}/>{q && <button className="adm-icon-button" disabled={bulkSaving} aria-label="チームの検索をクリア" onClick={() => filter(() => setQ(''))}><Icon name="close" size={15}/></button>}</div><div className="adm-toolbar-filters"><select className="adm-filter-select" aria-label="チームをゲームで絞り込む" value={gameId} disabled={bulkSaving} onChange={event => filter(() => setGameId(event.target.value))}><option value="">すべてのゲーム</option>{games.map(game => <option key={game.id} value={game.id}>{game.name}</option>)}</select><select className="adm-filter-select" aria-label="チームの並び順" value={sortColumns.length ? "columns" : sort} disabled={bulkSaving || sorting} onChange={event => { setSortColumns([]); setSortEdits({}); filter(() => setSort(event.target.value)); }}>{sortColumns.length > 0 && <option value="columns">列の並び替え</option>}<option value="default">ゲーム順</option><option value="name">名前順</option></select>{(q || gameId) && <button className="adm-icon-button active" disabled={bulkSaving} aria-label="チームの絞り込みを解除" onClick={() => filter(() => { setQ(''); setGameId(''); })}><Icon name="close" size={17}/></button>}{bulkMode ? <div className="adm-batch-actions"><span className="adm-batch-count" role="status">変更 {changedIds.length}件</span><button type="button" className="adm-button" disabled={bulkSaving} onClick={stopBulk}>キャンセル</button><button type="button" className="adm-button primary" disabled={(!changedIds.length && !liveEditing) || saving || bulkSaving} onClick={() => void saveBulk()}>{bulkSaving ? '保存中…' : 'まとめて保存'}</button></div> : <><button ref={bulkButton} type="button" className="adm-button" disabled={saving || !ordered.length} onClick={startBulk}>一括編集</button><button type="button" className="adm-button primary" disabled={saving || !games.length} onClick={() => select({ id: crypto.randomUUID(), event_id: gameId || games[0]?.id || '', display_name: '', rank_value: null, rank_note: null, final_score: null }, true)}><Icon name="plus" size={16}/>チームを追加</button></>}</div></div>
    <div className="adm-grid-root"><DataGrid ref={grid} key={`${q}:${gameId}:${sort}`} className="rdg-light" aria-label="チームのシート" aria-busy={loading || sorting} columns={columns} sortColumns={sortColumns} onSortColumnsChange={next => void changeSortColumns(next)} rows={gridRows} rowKeyGetter={row => row.id} rowHeight={ROW_HEIGHT} headerRowHeight={42} defaultColumnOptions={{ resizable: true, minWidth: 80 }} onRowsChange={rowsChanged} onScroll={event => { const next = Math.max(0, Math.floor(event.currentTarget.scrollTop / ROW_HEIGHT / 50) * 50); setViewport(old => old === next ? old : next); }} onSelectedCellChange={({ rowIdx }) => { if (rowIdx >= 0) setViewport(Math.floor(rowIdx / 50) * 50); }} onCellClick={(args, event) => { if (bulkMode && args.column.editable && !(event.target as HTMLElement).closest('button')) args.selectCell(true); }} rowClass={row => row.id === selection?.team.id ? 'adm-history-selected' : undefined} renderers={{ noRowsFallback: <div className="adm-empty"><Icon name="teams" size={28}/><h2>該当するチームがありません</h2><p>検索や絞り込みの条件を変えてください。</p></div> }}/></div>
    <div className="adm-entry-footer">列名を押すと昇順・降順を切り替えられます。</div>{error && <div className="adm-table-error" role="alert">{error}<button onClick={() => setReload(old => old + 1)}>再読み込み</button></div>}{bulkError && <div className="adm-table-error" role="alert">{bulkError}</div>}
  </div>{editor && (editorHost ? createPortal(editor, editorHost) : editor)}{pending && <PendingDialog onCancel={() => setPending(null)} onConfirm={() => { const action = pending; setPending(null); setDirty(false); setLiveEditing(false); updateEdits({}); setSortEdits({}); action(); }}/>}</div>;
}

import { useCallback, useMemo, useState } from 'react';
import { DataGrid, type Column, type SortColumn } from 'react-data-grid';
import { normaliseSearch } from '../model';
import { mergeRows, sheetInfo, type Directory, type PreviewStore } from './model';
import { type HistoryTarget, type WorkHold } from './history';
import Icon from './Icon';
import { compareSheetText, recordSortKind, sortSheetRows } from './sorting';

const sheets = { ...sheetInfo, teams: { name: 'チーム' } };
const formatDate = (value: string) => new Date(value).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
export type PendingRecord = WorkHold & { name: string; gameId: string | null; gameName: string; exists: boolean };

export function listPendingRecords(directory: Directory, store: PreviewStore): PendingRecord[] {
  const games = mergeRows(directory.games, store.games), names = new Map(games.map(game => [game.id, game.name]));
  const maps = {
    cards: new Map(mergeRows(directory.cards, store.cards).map(row => [row.id, row])),
    people: new Map(mergeRows(directory.people, store.people).map(row => [row.id, row])),
    games: new Map(games.map(row => [row.id, row])),
    teams: new Map(mergeRows(directory.teams ?? [], store.teams).map(row => [row.id, row])),
  };
  return Object.values(store.holds).map(hold => {
    const row = maps[hold.sheet].get(hold.recordId);
    const gameId = row && 'event_id' in row ? row.event_id : hold.sheet === 'games' ? hold.recordId : null;
    return { ...hold, name: row ? 'display_name' in row ? row.display_name : row.name : hold.recordId, gameId, gameName: gameId ? names.get(gameId) ?? 'ゲーム未登録' : '', exists: Boolean(row) };
  }).sort((a, b) => b.at.localeCompare(a.at) || a.sheet.localeCompare(b.sheet) || a.recordId.localeCompare(b.recordId));
}
type Props = { directory: Directory; store: PreviewStore; loading: boolean; error: string; onRetry: () => void; onOpen: (sheet: HistoryTarget, id: string) => void; onRelease: (sheet: HistoryTarget, id: string) => void; saving?: boolean };

export default function PendingSheet({ directory, store, loading, error, onRetry, onOpen, onRelease, saving = false }: Props) {
  const [q, setQ] = useState(''), [sheet, setSheet] = useState(''), [gameId, setGameId] = useState('');
  const [sortColumns, setSortColumns] = useState<readonly SortColumn[]>([]);
  const records = useMemo(() => listPendingRecords(directory, store), [directory, store.cards, store.people, store.games, store.teams, store.holds]);
  const games = useMemo(() => mergeRows(directory.games, store.games), [directory.games, store.games]);
  const matches = useMemo(() => sortSheetRows(records.filter(row => (!sheet || row.sheet === sheet) && (!gameId || row.gameId === gameId) && normaliseSearch(`${row.name} ${row.gameName} ${sheets[row.sheet].name}`).includes(normaliseSearch(q))), sortColumns, (row, key) => key === 'sheet' ? sheets[row.sheet].name : key === 'at' ? row.at : key === 'gameName' ? row.sheet === 'games' ? '' : row.gameName : row.name, recordSortKind, (a, b) => b.at.localeCompare(a.at) || compareSheetText(`${a.sheet}:${a.recordId}`, `${b.sheet}:${b.recordId}`)), [records, q, sheet, gameId, sortColumns]);
  const open = useCallback((row: PendingRecord) => { if (row.exists && !saving) onOpen(row.sheet, row.recordId); }, [onOpen, saving]);
  const columns = useMemo<Column<PendingRecord>[]>(() => [
    { key: '_number', name: '#', sortable: false, width: 48, minWidth: 48, frozen: true, resizable: false, renderCell: ({ rowIdx }) => <span className="adm-muted">{rowIdx + 1}</span> },
    { key: 'name', name: '記録', width: 'minmax(260px, 1fr)', minWidth: 260, frozen: true, renderCell: ({ row, tabIndex }) => <div><button className="adm-row-title" tabIndex={tabIndex} disabled={!row.exists || saving} onClick={() => open(row)}>{row.name}</button>{!row.exists && <span className="adm-secondary-name">現在の一覧にない記録</span>}</div> },
    { key: 'sheet', name: 'シート', width: 108, renderCell: ({ row }) => <span className="adm-history-sheet"><Icon name={row.sheet} size={15}/>{sheets[row.sheet].name}</span> },
    { key: 'gameName', name: '所属ゲーム', width: 'minmax(240px, 2fr)', minWidth: 240, renderCell: ({ row }) => <span className="adm-period">{row.sheet === 'games' ? '—' : row.gameName || '—'}</span> },
    { key: 'at', name: '保留した日時', sortDescendingFirst: true, width: 182, renderCell: ({ row }) => <time className="adm-period" dateTime={row.at}>{formatDate(row.at)}</time> },
    { key: '_release', name: 'ステータス', sortable: false, width: 150, renderCell: ({ row, tabIndex }) => <button type="button" className="adm-button" tabIndex={tabIndex} disabled={saving} aria-label={`${row.name}の保留を解除`} onClick={() => onRelease(row.sheet, row.recordId)}>保留を解除</button> },
    { key: '_open', name: '開く', sortable: false, width: 60, minWidth: 60, resizable: false, renderCell: ({ row, tabIndex }) => <button className="adm-icon-button" tabIndex={tabIndex} aria-label={`${row.name}の記録を開く`} disabled={!row.exists || saving} onClick={() => open(row)}><Icon name="chevron" size={16}/></button> },
  ], [open, onRelease, saving]);
  if (loading) return <div className="adm-loading" role="status"><span className="adm-spinner"/>保留した記録を読み込んでいます…</div>;
  if (error) return <div className="adm-empty" role="alert"><h2>データを読み込めませんでした</h2><p>{error}</p><button className="adm-button" onClick={onRetry}>再読み込み</button></div>;
  return <>
    <div className="adm-toolbar"><div className="adm-search"><Icon name="search" size={18}/><input aria-label="保留した記録を検索" placeholder="記録名・ゲームで検索" value={q} onChange={event => setQ(event.target.value)}/>{q && <button className="adm-icon-button" aria-label="保留の検索をクリア" onClick={() => setQ('')}><Icon name="close" size={15}/></button>}</div>
      <div className="adm-toolbar-filters"><select className="adm-filter-select" aria-label="保留したシートで絞り込む" value={sheet} onChange={event => setSheet(event.target.value)}><option value="">すべてのシート</option>{(['cards', 'people', 'games', 'teams'] as const).map(value => <option key={value} value={value}>{sheets[value].name}</option>)}</select><select className="adm-filter-select" aria-label="保留したゲームで絞り込む" value={gameId} onChange={event => setGameId(event.target.value)}><option value="">すべてのゲーム</option>{games.map(game => <option key={game.id} value={game.id}>{game.name}</option>)}</select>{(q || sheet || gameId) && <button className="adm-icon-button active" aria-label="保留の絞り込みを解除" onClick={() => { setQ(''); setSheet(''); setGameId(''); }}><Icon name="close" size={17}/></button>}</div>
    </div>
    <div className="adm-entry-footer">列名を押すと昇順・降順を切り替えられます。</div><span className="adm-sr-only" id="adm-pending-description">保留は作業上の目印で、変更を反映する対象に含まれます。</span>
    <div className="adm-grid-root"><DataGrid key={`${q}:${sheet}:${gameId}`} className="rdg-light" aria-label="保留のシート" aria-describedby="adm-pending-description" columns={columns} sortColumns={sortColumns} onSortColumnsChange={setSortColumns} rows={matches} rowKeyGetter={row => `${row.sheet}:${row.recordId}`} rowHeight={54} headerRowHeight={42} defaultColumnOptions={{ resizable: true, minWidth: 80, sortable: true }} renderers={{ noRowsFallback: <div className="adm-empty"><Icon name="pending" size={26}/><h2>{records.length ? '該当する保留がありません' : '保留した記録はありません'}</h2><p>{records.length ? '検索や絞り込みを変更してください。' : '各シートで保留にした記録がここに集まります。'}</p></div> }}/></div>
  </>;
}

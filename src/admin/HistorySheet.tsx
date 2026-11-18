import { useCallback, useMemo, useState } from 'react';
import { DataGrid, type Column, type SortColumn } from 'react-data-grid';
import { normaliseSearch } from '../model';
import { sheetInfo } from './model';
import { historyStatus, unappliedHistory, type ChangeEntry, type HistoryStatus, type HistoryTarget } from './history';
import Icon from './Icon';
import { compareSheetText, recordSortKind, sortSheetRows } from './sorting';

const historySheets = { ...sheetInfo, teams: { name: 'チーム' } };
const actions = { create: '追加', update: '編集', reset: '下書き解除', hold: '保留', release: '保留解除' };
const states: Record<HistoryStatus, string> = { unapplied: '未反映', applied: '反映済', discarded: '取り消し' };
const formatDate = (value: string) => new Date(value).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
type Props = { loading: boolean; error: string; onRetry: () => void; entries: ChangeEntry[]; onOpen: (sheet: HistoryTarget, id: string) => void; onApply?: () => void; applying?: boolean; applyAvailable?: boolean; applyHint?: string; applyCount?: number; hasMore?: boolean; onMore?: () => void; moreLoading?: boolean; cloudError?: string; onCloudRetry?: () => void; resumePending?: boolean };

export default function HistorySheet({ entries, onOpen, loading, error, onRetry, onApply, applying = false, applyAvailable = false, applyHint = '', applyCount, hasMore = false, onMore, moreLoading = false, cloudError = '', onCloudRetry, resumePending = false }: Props) {
  const [q, setQ] = useState(''), [filter, setFilter] = useState(''), [status, setStatus] = useState<HistoryStatus | ''>(''), [selectedId, setSelectedId] = useState<string | null>(null);
  const [sortColumns, setSortColumns] = useState<readonly SortColumn[]>([]);
  const selected = entries.find(entry => entry.id === selectedId);
  const pendingCount = useMemo(() => unappliedHistory(entries).length, [entries]);
  const count = applyCount ?? pendingCount;
  const matches = useMemo(() => sortSheetRows([...entries].reverse().filter(entry => (!filter || entry.sheet === filter) && (!status || historyStatus(entry) === status) && normaliseSearch(`${entry.recordName} ${entry.changes.map(change => `${change.label} ${change.before} ${change.after}`).join(' ')}`).includes(normaliseSearch(q))), sortColumns, (entry, key) => key === '_status' ? states[historyStatus(entry)] : key === 'sheet' ? entry.sheet === 'all' ? 'すべて' : historySheets[entry.sheet].name : key === 'action' ? actions[entry.action] : key === 'changes' ? entry.changes.map(change => change.label).join(' ; ') : key === 'at' ? entry.at : entry.recordName, recordSortKind, (a, b) => b.at.localeCompare(a.at) || compareSheetText(a.id, b.id)), [entries, filter, q, status, sortColumns]);
  const openRecord = useCallback((entry: ChangeEntry) => { if (entry.sheet !== 'all' && entry.recordId) onOpen(entry.sheet, entry.recordId); }, [onOpen]);
  const columns = useMemo<Column<ChangeEntry>[]>(() => [
    { key: '_number', name: '#', sortable: false, width: 48, minWidth: 48, frozen: true, resizable: false, renderCell: ({ rowIdx }) => <span className="adm-muted">{rowIdx + 1}</span> },
    { key: 'recordName', name: '記録', width: 'minmax(220px, 1fr)', minWidth: 220, frozen: true, renderCell: ({ row, tabIndex }) => <button className="adm-row-title" tabIndex={tabIndex} onClick={() => setSelectedId(row.id)}>{row.recordName}</button> },
    { key: 'at', name: '日時', sortDescendingFirst: true, width: 182, renderCell: ({ row }) => <time className="adm-period" dateTime={row.at}>{formatDate(row.at)}</time> },
    { key: 'sheet', name: 'シート', width: 108, renderCell: ({ row }) => <span className="adm-history-sheet"><Icon name={row.sheet === 'all' ? 'refresh' : row.sheet} size={15}/>{row.sheet === 'all' ? 'すべて' : historySheets[row.sheet].name}</span> },
    { key: 'action', name: '操作', width: 100, renderCell: ({ row }) => <span className={`adm-history-action ${row.action}`}>{actions[row.action]}</span> },
    { key: 'changes', name: '変更した項目', width: 'minmax(290px, 2fr)', minWidth: 290, renderCell: ({ row, tabIndex }) => <button className="adm-history-summary" tabIndex={tabIndex} onClick={() => setSelectedId(row.id)}>{row.changes.slice(0, 3).map(change => change.label).join(' · ')}{row.changes.length > 3 && ` ＋${row.changes.length - 3}`}</button> },
    { key: '_status', name: '状態', width: 100, renderCell: ({ row }) => <span className={`adm-history-state ${historyStatus(row)}`}>{states[historyStatus(row)]}</span> },
    { key: '_open', name: '開く', sortable: false, width: 60, minWidth: 60, resizable: false, renderCell: ({ row, tabIndex }) => row.sheet !== 'all' && row.recordId ? <button className="adm-icon-button" tabIndex={tabIndex} aria-label={`${row.recordName}の記録を開く`} onClick={() => openRecord(row)}><Icon name="chevron" size={16}/></button> : null },
  ], [openRecord]);
  if (loading) return <div className="adm-loading" role="status"><span className="adm-spinner"/>履歴を読み込んでいます…</div>;
  if (error) return <div className="adm-empty" role="alert"><h2>データを読み込めませんでした</h2><p>{error}</p><button className="adm-button" onClick={onRetry}>再読み込み</button></div>;
  return <>
    <div className="adm-toolbar">
      <div className="adm-search"><Icon name="search" size={18}/><input aria-label="変更履歴を検索" placeholder="記録名・変更した項目で検索" value={q} onChange={event => setQ(event.target.value)}/>{q && <button className="adm-icon-button" aria-label="履歴の検索をクリア" onClick={() => setQ('')}><Icon name="close" size={15}/></button>}</div>
      <div className="adm-toolbar-filters">
        <select className="adm-filter-select" aria-label="変更したシートで絞り込む" value={filter} onChange={event => setFilter(event.target.value)}><option value="">すべてのシート</option>{(['cards', 'people', 'games', 'teams'] as const).map(sheet => <option key={sheet} value={sheet}>{historySheets[sheet].name}</option>)}</select>
        <select className="adm-filter-select" aria-label="反映状態で絞り込む" value={status} onChange={event => setStatus(event.target.value as HistoryStatus | '')}><option value="">すべての状態</option>{Object.entries(states).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        {onApply && <div className="adm-apply-actions"><span className="adm-batch-count" role="status">未反映 {count.toLocaleString('ja-JP')}件</span><button type="button" className="adm-button primary" disabled={(!count && !resumePending) || applying || !applyAvailable} aria-describedby={applyHint ? 'adm-apply-note' : undefined} onClick={onApply}>{applying ? <><span className="adm-spinner"/>反映中…</> : <><Icon name="check" size={16}/>{resumePending ? '前回の反映を確認' : '変更を反映'}</>}</button></div>}
      </div>
    </div>
    {onApply && applyHint && <p id="adm-apply-note" className="adm-apply-note">{applyHint}</p>}
    {cloudError && <div className="adm-cloud-error" role="alert"><span>{cloudError}</span><button className="adm-button" disabled={moreLoading} onClick={onCloudRetry}>再試行</button></div>}
    <div className="adm-entry-footer">読み込んだ履歴は列名を押して並び替えられます。</div><div className="adm-history-layout">
      <div className="adm-grid-root adm-history-grid"><DataGrid key={`${q}:${filter}:${status}`} className="rdg-light" aria-label="変更履歴のシート" columns={columns} sortColumns={sortColumns} onSortColumnsChange={setSortColumns} rows={matches} rowKeyGetter={row => row.id} rowHeight={54} headerRowHeight={42} defaultColumnOptions={{ resizable: true, minWidth: 80, sortable: true }} onScroll={event => { const grid = event.currentTarget; if (hasMore && !moreLoading && !cloudError && grid.scrollHeight - grid.scrollTop - grid.clientHeight < 300) onMore?.(); }} rowClass={row => row.id === selectedId ? 'adm-history-selected' : undefined} renderers={{ noRowsFallback: <div className="adm-empty"><Icon name="history" size={26}/><h2>{entries.length ? '該当する履歴がありません' : '変更履歴はまだありません'}</h2><p>{entries.length ? '検索や絞り込みを変更してください。' : '保存した変更がここに記録されます。'}</p></div> }}/></div>
      {selected && <aside className="adm-history-detail" aria-label="変更の詳細"><header><div><small>{actions[selected.action]} · {formatDate(selected.at)}</small><h2>{selected.recordName}</h2></div><button className="adm-icon-button" aria-label="履歴の詳細を閉じる" onClick={() => setSelectedId(null)}><Icon name="close" size={18}/></button></header>
        <div className="adm-history-meta"><span>状態<strong className={`adm-history-state ${historyStatus(selected)}`}>{states[historyStatus(selected)]}</strong></span><span>保存先<strong>{historyStatus(selected) === 'applied' ? 'Supabase' : historyStatus(selected) === 'discarded' ? '取り消した下書き' : 'ローカル下書き'}</strong></span><span>操作元<strong>{selected.actor}</strong></span></div>
        {selected.appliedAt && <div className="adm-history-meta"><span>反映日時<strong><time dateTime={selected.appliedAt}>{formatDate(selected.appliedAt)}</time></strong></span></div>}
        <div className="adm-history-diffs">{selected.changes.map((change, index) => <section key={index}><h3>{change.label}</h3><div><span>変更前</span><p>{change.before}</p></div><div className="after"><span>変更後</span><p>{change.after}</p></div></section>)}</div>
        {selected.sheet !== 'all' && selected.recordId && <footer><button className="adm-button" onClick={() => openRecord(selected)}>記録を開く<Icon name="arrow" size={13}/></button></footer>}
      </aside>}
    </div>
    {(hasMore || moreLoading) && <div className="adm-history-more"><button className="adm-button" disabled={moreLoading} onClick={onMore}>{moreLoading ? '履歴を読み込んでいます…' : '以前の履歴を読み込む'}</button></div>}
  </>;
}

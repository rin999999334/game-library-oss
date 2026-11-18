import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { orderGames } from '../model';
import { loadGameArtwork } from '../artwork';
import { clearCardCache, loadDirectory, readPreview, savePreview } from './data';
import { changedCount, emptyStore, mergeRows, sheetInfo, type Directory, type PreviewStore, type Sheet } from './model';
import HistorySheet from './HistorySheet';
import PendingSheet from './PendingSheet';
import RecordSheet from './RecordSheet';
import ApplyDialog from './ApplyDialog';
import AccountDialog from './AccountDialog';
import DraftBackupDialog from './DraftBackupDialog';
import { adminClient, fetchAdminHolds, fetchAdminHistoryPage, type ApplyPlan, type ApplyReceipt } from './apply';
import { mergeRemoteHolds } from './hold-sync';
import { makeHoldChangeEntry, mergeAuditHistory, unappliedHistory, type ChangeEntry, type HistoryTarget } from './history';
import { resetDraftStore } from './reset-drafts';
import { reconcileApplied } from './apply-local';
import { readApplyJournal } from './apply-journal';
import Editor, { type Selection } from './Editor';
import Icon from './Icon';
import RailTooltip from './RailTooltip';
import TeamSheet from './TeamSheet';
import './admin.css';

type AdminTab = Sheet | 'pending' | 'history';
type GamePanel = 'games' | 'teams';
const tabInfo = { ...sheetInfo, pending: { name: '保留', singular: '保留' }, history: { name: '変更履歴', singular: '履歴' } };
const sheets: AdminTab[] = ['cards', 'people', 'games', 'pending', 'history'];
type GameIconMapping = Record<string, { src: string }>;
let gameIconRequest: Promise<GameIconMapping> | undefined;
function loadGameIcons() {
  return gameIconRequest ??= fetch('/game-icons.json').then(response => {
    if (!response.ok) throw new Error('ゲーム画像を読み込めませんでした。');
    return response.json() as Promise<GameIconMapping>;
  }).catch(cause => { gameIconRequest = undefined; throw cause; });
}
function initialSheet(): AdminTab { const hash = location.hash.slice(1); return hash === 'teams' ? 'games' : sheets.includes(hash as AdminTab) ? hash as AdminTab : 'cards'; }
function useBlobUrls(images: Record<string, Blob>) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useLayoutEffect(() => { const next = Object.fromEntries(Object.entries(images).map(([key, blob]) => [key, URL.createObjectURL(blob)])); setUrls(next); return () => { Object.values(next).forEach(URL.revokeObjectURL); }; }, [images]);
  return urls;
}
function PreviewDialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog className="adm-dialog" ref={ref} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}><header><h2>{title}</h2><button className="adm-icon-button" aria-label="ダイアログを閉じる" onClick={onClose}><Icon name="close"/></button></header>{children}</dialog>;
}
function GameSheetTabs({ value, onChange, disabled }: { value: GamePanel; onChange: (next: GamePanel, focus?: boolean) => void; disabled: boolean }) {
  return <div className="adm-subtabs" role="tablist" aria-label="ゲームの管理" onKeyDown={event => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); onChange(event.key === 'Home' ? 'games' : event.key === 'End' ? 'teams' : value === 'games' ? 'teams' : 'games', true); }
  }}>{(['games', 'teams'] as const).map(item => <button type="button" role="tab" id={`game-tab-${item}`} aria-controls={`game-panel-${item}`} aria-selected={value === item} tabIndex={value === item ? 0 : -1} disabled={disabled} key={item} onClick={() => onChange(item)}><Icon name={item} size={16}/>{item === 'games' ? 'ゲーム' : 'チーム'}</button>)}</div>;
}
export default function AdminApp() {
  const [directory, setDirectory] = useState<Directory | null>(null), [store, setStore] = useState<PreviewStore>(emptyStore), [sheet, setSheet] = useState<AdminTab>(initialSheet);
  const [iconMapping, setIconMapping] = useState<GameIconMapping>({});
  const [gamePanel, setGamePanel] = useState<GamePanel>(() => location.hash === '#teams' ? 'teams' : 'games');
  const [teamEditing, setTeamEditing] = useState(false), [openTeamId, setOpenTeamId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null), [editorKey, setEditorKey] = useState(0), [dirty, setDirty] = useState(false);
  const [sheetContext, setSheetContext] = useState({ key: 0, gameId: '' });
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [refresh, setRefresh] = useState(0);
  const [toast, setToast] = useState(''), [toastError, setToastError] = useState(false), [saving, setSaving] = useState(false), [applying, setApplying] = useState(false), [applyOpen, setApplyOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [resumePending, setResumePending] = useState(false);
  const [cloudEntries, setCloudEntries] = useState<ChangeEntry[]>([]), [cloudCursor, setCloudCursor] = useState<{ at: string; id: string } | null>(null);
  const [cloudLoading, setCloudLoading] = useState(false), [cloudError, setCloudError] = useState('');
  const cloudGeneration = useRef(0), cloudBusy = useRef(false);
  const historyEntries = useMemo(() => mergeAuditHistory(store.history, cloudEntries), [store.history, cloudEntries]);
  useEffect(() => {
    const generation = ++cloudGeneration.current; cloudBusy.current = true; setCloudLoading(true); setCloudError('');
    void readApplyJournal().then(journal => { if (generation === cloudGeneration.current) setResumePending(Boolean(journal)); }).catch(cause => { if (generation === cloudGeneration.current) { setResumePending(true); setToastError(true); setToast(cause instanceof Error ? cause.message : '前回の反映記録を確認できませんでした。'); } });
    void fetchAdminHistoryPage().then(page => { if (generation === cloudGeneration.current) { setCloudEntries(current => mergeAuditHistory(current, page.entries)); setCloudCursor(page.nextCursor); } }).catch(cause => { if (generation === cloudGeneration.current) setCloudError(cause instanceof Error ? cause.message : '反映済みの履歴を読み込めませんでした。'); }).finally(() => { if (generation === cloudGeneration.current) { cloudBusy.current = false; setCloudLoading(false); } });
    return () => { ++cloudGeneration.current; };
  }, [refresh]);
  async function loadMoreHistory() {
    if (!cloudCursor || cloudBusy.current) return;
    const generation = cloudGeneration.current; cloudBusy.current = true; setCloudLoading(true); setCloudError('');
    try { const page = await fetchAdminHistoryPage(cloudCursor); if (generation === cloudGeneration.current) { setCloudEntries(current => mergeAuditHistory(current, page.entries)); setCloudCursor(page.nextCursor); } }
    catch (cause) { if (generation === cloudGeneration.current) setCloudError(cause instanceof Error ? cause.message : '履歴を読み込めませんでした。'); }
    finally { if (generation === cloudGeneration.current) { cloudBusy.current = false; setCloudLoading(false); } }
  }
  const savingRef = useRef(false), applyingRef = useRef(false), storeRef = useRef(store); storeRef.current = store;
  const [pending, setPending] = useState<(() => void) | null>(null), [resetDialog, setResetDialog] = useState(false), [zoom, setZoom] = useState<{ src: string; name: string } | null>(null);
  const [editorOverlay, setEditorOverlay] = useState(() => window.matchMedia('(max-width:1120px)').matches);
  const imageUrls = useBlobUrls(store.images);
  const games = useMemo(() => directory ? orderGames(mergeRows(directory.games, store.games)) : [], [directory, store.games]);
  const gameArtwork = useMemo(() => Object.fromEntries(Object.entries(iconMapping).map(([id, entry]) => [id, entry.src])), [iconMapping]);
  const previewImages = useMemo(() => ({ ...Object.fromEntries(Object.entries(gameArtwork).map(([id, src]) => [`games:${id}`, src])), ...Object.fromEntries(Object.entries(store.gameImageUrls).map(([id, src]) => [`games:${id}`, src])), ...imageUrls }), [gameArtwork, store.gameImageUrls, imageUrls]);
  const busy = saving || applying;
  useEffect(() => { let cancelled = false; void Promise.all([loadGameIcons().catch(() => ({} as GameIconMapping)), loadGameArtwork(refresh > 0).catch(() => ({} as Record<string, string>))]).then(([icons, artwork]) => { if (!cancelled) setIconMapping({ ...icons, ...Object.fromEntries(Object.entries(artwork).map(([id, src]) => [id, { src }])) }); }); return () => { cancelled = true; }; }, [refresh]);
  useEffect(() => { const media = window.matchMedia('(max-width:1120px)'); const update = () => setEditorOverlay(media.matches); update(); media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);
  useEffect(() => { const prevent = (event: BeforeUnloadEvent) => { if (savingRef.current || applyingRef.current || dirty) event.preventDefault(); }; window.addEventListener('beforeunload', prevent); return () => window.removeEventListener('beforeunload', prevent); }, [dirty]);
  useEffect(() => { const title = document.title; document.title = 'かくれんぼ · 管理'; document.body.classList.add('admin-mode'); return () => { document.title = title; document.body.classList.remove('admin-mode'); }; }, []);
  useEffect(() => {
    let cancelled = false; setLoading(true); setError('');
    void Promise.all([loadDirectory(refresh > 0), readPreview()]).then(([data, saved]) => {
      if (cancelled) return; setDirectory(data); setStore(saved); setLoading(false);
      // Authenticated work markers hydrate independently, so table entry does
      // not wait for the optional administration schema or token refresh.
      void adminClient.auth.getSession().then(async session => {
        if (!session.data.session || cancelled) return;
        const remote = await fetchAdminHolds(); if (!cancelled) setStore(current => mergeRemoteHolds(current, remote));
      }).catch(() => {});
    }).catch(cause => { if (!cancelled) { setError(cause instanceof Error ? cause.message : 'データを読み込めませんでした。'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [refresh]);
  useEffect(() => { if (!toast || toastError) return; const timer = window.setTimeout(() => setToast(''), 3500); return () => window.clearTimeout(timer); }, [toast, toastError]);
  const guard = useCallback((action: () => void) => { if (savingRef.current || applyingRef.current) return; if (dirty) setPending(() => () => { setSheetContext(old => ({ ...old, key: old.key + 1 })); setEditorKey(value => value + 1); setSelection(null); setTeamEditing(false); action(); }); else action(); }, [dirty]);
  const changeSheet = (next: AdminTab, focusTab = false) => {
    if (next === sheet) { if (focusTab) document.getElementById(`tab-${next}`)?.focus(); return; }
    guard(() => { setDirty(false); setSelection(null); setTeamEditing(false); setSheet(next); setSheetContext(old => ({ key: old.key + 1, gameId: '' })); history.replaceState(null, '', `#${next === 'games' && gamePanel === 'teams' ? 'teams' : next}`); if (focusTab) queueMicrotask(() => document.getElementById(`tab-${next}`)?.focus()); });
  };
  function tabKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    const current = (event.target as HTMLElement).closest<HTMLElement>('[role=tab]'); if (!current) return;
    const index = sheets.findIndex(item => current.id === `tab-${item}`);
    const next = event.key === 'ArrowDown' ? (index + 1) % sheets.length : event.key === 'ArrowUp' ? (index + sheets.length - 1) % sheets.length : event.key === 'Home' ? 0 : event.key === 'End' ? sheets.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); changeSheet(sheets[next], true); }
  }
  const changeGamePanel = (next: GamePanel, focusTab = false) => {
    if (next === gamePanel) { if (focusTab) document.getElementById(`game-tab-${next}`)?.focus(); return; }
    guard(() => { setSelection(null); setTeamEditing(false); setDirty(false); setGamePanel(next); setSheetContext(old => ({ key: old.key + 1, gameId: '' })); history.replaceState(null, '', `#${next}`); if (focusTab) queueMicrotask(() => document.getElementById(`game-tab-${next}`)?.focus()); });
  };
  const openRecord = (target: Sheet, id: string) => guard(() => { setSelection({ sheet: target, id }); setDirty(false); setEditorKey(value => value + 1); setSheetContext(old => ({ ...old, key: old.key + 1 })); });
  const closeEditor = () => guard(() => { setSelection(null); setDirty(false); });
  function showGameSheet(target: 'cards' | 'people', gameId: string) { guard(() => { setTeamEditing(false); setSheet(target); history.replaceState(null, '', `#${target}`); setSheetContext(old => ({ key: old.key + 1, gameId })); setSelection(null); setDirty(false); }); }
  function navigateTo(target: Sheet, id: string) { guard(() => { if (target === 'games') setGamePanel('games'); setTeamEditing(false); setSheet(target); history.replaceState(null, '', `#${target}`); setSheetContext(old => ({ key: old.key + 1, gameId: '' })); setSelection({ sheet: target, id }); setDirty(false); setEditorKey(value => value + 1); }); }
  function openHistoryRecord(target: HistoryTarget, id: string) {
    if (!directory) return;
    const exists = target === 'cards' ? mergeRows(directory.cards, store.cards).some(row => row.id === id) : target === 'people' ? mergeRows(directory.people, store.people).some(row => row.id === id) : target === 'games' ? mergeRows(directory.games, store.games).some(row => row.id === id) : mergeRows(directory.teams ?? [], store.teams).some(row => row.id === id);
    if (!exists) { setToastError(false); setToast('この記録は現在の一覧にありません。変更前後は履歴で確認できます。'); return; }
    if (target === 'teams') guard(() => { setSelection(null); setDirty(false); setSheet('games'); setGamePanel('teams'); setOpenTeamId(id); history.replaceState(null, '', '#teams'); });
    else navigateTo(target, id);
  }
  async function persist(next: PreviewStore) {
    if (savingRef.current) throw new Error('保存中です。完了してから操作してください。');
    savingRef.current = true; setSaving(true);
    try { const saved = await savePreview(next); storeRef.current = saved; setStore(saved); setToastError(false); setToast('下書きを保存しました'); }
    finally { savingRef.current = false; setSaving(false); }
  }
  function toggleHold(target: HistoryTarget, id: string) {
    if (savingRef.current || applyingRef.current || !directory) return;
    const current = storeRef.current, key = `${target}:${id}`, held = !current.holds[key];
    const row = target === 'cards' ? current.cards[id] ?? directory.cards.find(item => item.id === id) : target === 'people' ? current.people[id] ?? directory.people.find(item => item.id === id) : target === 'games' ? current.games[id] ?? directory.games.find(item => item.id === id) : current.teams[id] ?? directory.teams?.find(item => item.id === id);
    if (!row && held) return;
    const name = row ? 'display_name' in row ? row.display_name : row.name : id;
    const holds = { ...current.holds }; if (held) holds[key] = { sheet: target, recordId: id, at: new Date().toISOString() }; else delete holds[key];
    void persist({ ...current, holds, history: [...current.history, makeHoldChangeEntry(target, id, name, held)], savedAt: new Date().toISOString() }).catch(cause => { setToastError(true); setToast(cause instanceof Error ? cause.message : '保留を保存できませんでした。'); });
  }
  async function resetPreview() {
    try { if (!directory) return; await persist(resetDraftStore(storeRef.current, directory)); setSelection(null); setTeamEditing(false); setEditorKey(value => value + 1); setSheetContext(old => ({ key: old.key + 1, gameId: '' })); setDirty(false); setResetDialog(false); setToast('下書きを解除しました'); }
    catch (cause) { setToastError(true); setToast(cause instanceof Error ? cause.message : '下書きを解除できませんでした'); }
  }
  async function finishApply(receipt: ApplyReceipt, plan: ApplyPlan) {
    const current = await readPreview();
    const next = await reconcileApplied(current, plan, receipt);
    await persist(next);
    clearCardCache(); setSelection(null); setDirty(false); setRefresh(value => value + 1); setToast('変更をSupabaseに反映しました');
  }
  const applyAvailable = resumePending || changedCount(store) > 0 || store.history.some(entry => (entry.action === 'hold' || entry.action === 'release') && !entry.appliedAt && !entry.discardedAt);
  const unavailable = loading || error || !directory;
  return <div className="admin-app">
    <div className="adm-mobile-note"><img src="/app-icon-v2-180.png" alt=""/><h1>かくれんぼ 管理</h1><p>編集画面はPCで開いてください。</p><a className="adm-button" href="/">アプリへ戻る</a></div>
    <aside className="adm-sidebar" aria-label="管理ナビゲーション" inert={Boolean((selection || teamEditing) && editorOverlay)}>
      <RailTooltip label="かくれんぼ"><a className="adm-brand" href="/admin/#cards" onClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); changeSheet('cards'); } }} aria-label="かくれんぼ"><img src="/app-icon-v2-180.png" alt=""/></a></RailTooltip>
      <nav role="tablist" aria-label="管理シート" aria-orientation="vertical" onKeyDown={tabKeyDown}>{sheets.map(item => <RailTooltip key={item} label={tabInfo[item].name}><button type="button" role="tab" aria-label={tabInfo[item].name} tabIndex={sheet === item ? 0 : -1} disabled={busy} aria-selected={sheet === item} aria-controls={`sheet-${item}`} id={`tab-${item}`} onClick={() => changeSheet(item)}><Icon name={item}/></button></RailTooltip>)}</nav>
      <div className="adm-sidebar-bottom"><RailTooltip label="管理者アカウント"><button className="adm-sidebar-action" disabled={busy} aria-label="管理者アカウント" onClick={() => guard(() => setAccountOpen(true))}><Icon name="people"/></button></RailTooltip><RailTooltip label="下書きのバックアップ"><button className="adm-sidebar-action" disabled={busy} aria-label="下書きのバックアップ" onClick={() => guard(() => setBackupOpen(true))}><Icon name="backup"/></button></RailTooltip>{changedCount(store) > 0 && <RailTooltip label="下書きをすべて解除"><button type="button" className="adm-sidebar-action" disabled={busy} aria-label="下書きをすべて解除" onClick={() => guard(() => setResetDialog(true))}><Icon name="refresh"/></button></RailTooltip>}<RailTooltip label="公開画面を開く"><a href="/" target="_blank" rel="noreferrer" className="adm-sidebar-action" aria-label="公開画面を開く"><Icon name="arrow"/></a></RailTooltip></div>
    </aside>
    <main className="adm-main" inert={Boolean((selection || teamEditing) && editorOverlay)}>
      <header className="adm-topbar"><div><span>ワークスペース</span><span className="adm-breadcrumb-slash">/</span><strong>{tabInfo[sheet].name}</strong></div><div className="adm-top-actions"><span className="adm-draft-count">{busy ? applying ? '反映中…' : '保存中…' : changedCount(store) ? `下書き ${changedCount(store)}件` : ''}</span>{sheet !== 'history' && <button className="adm-button primary" disabled={Boolean(unavailable) || busy || !applyAvailable} onClick={() => guard(() => { setSelection(null); setApplyOpen(true); })}>{resumePending ? '前回の反映を確認' : '変更を反映'}</button>}</div></header>
      <section className="adm-workspace" role="tabpanel" id={`sheet-${sheet}`} aria-labelledby={`tab-${sheet}`}>
        {sheet === 'history' ? <HistorySheet loading={loading} error={error} onRetry={() => setRefresh(value => value + 1)} entries={historyEntries} onOpen={openHistoryRecord} hasMore={Boolean(cloudCursor)} onMore={loadMoreHistory} moreLoading={cloudLoading} cloudError={cloudError} onCloudRetry={() => cloudCursor ? void loadMoreHistory() : setRefresh(value => value + 1)} resumePending={resumePending} onApply={() => guard(() => setApplyOpen(true))} applying={busy} applyAvailable={applyAvailable && !unavailable} applyCount={unappliedHistory(store.history).length || changedCount(store)}/>
        : sheet === 'pending' ? <PendingSheet directory={directory ?? { cards: [], people: [], games: [], masters: [], teams: [] }} store={store} loading={loading} error={error} onRetry={() => setRefresh(value => value + 1)} onOpen={openHistoryRecord} onRelease={toggleHold} saving={busy}/>
        : <>{sheet === 'games' && <GameSheetTabs value={gamePanel} onChange={changeGamePanel} disabled={busy}/>}<div className="adm-sheet-content" inert={Boolean(selection)} role={sheet === 'games' ? 'tabpanel' : undefined} id={sheet === 'games' ? `game-panel-${gamePanel}` : undefined} aria-labelledby={sheet === 'games' ? `game-tab-${gamePanel}` : undefined}>
          {loading ? <div className="adm-loading" role="status"><span className="adm-spinner"/>シートを読み込んでいます…</div> : error || !directory ? <div className="adm-empty" role="alert"><h2>データを読み込めませんでした</h2><p>{error}</p><button className="adm-button" onClick={() => setRefresh(value => value + 1)}>再試行</button></div>
          : sheet === 'games' && gamePanel === 'teams' ? <TeamSheet key={`${refresh}:${editorKey}`} directory={directory} store={store} games={games} modal={editorOverlay} onEditing={setTeamEditing} onSave={persist} onDirty={setDirty} onGame={id => navigateTo('games', id)} saving={busy} openTeamId={openTeamId} onOpened={() => setOpenTeamId(null)} onHold={toggleHold}/>
          : <RecordSheet key={`${sheet}:${refresh}:${sheetContext.key}`} sheet={sheet} directory={directory} store={store} games={games} initialGameId={sheetContext.gameId} gameArtwork={gameArtwork} imageUrls={previewImages} saving={busy} onSave={persist} onDirty={setDirty} onOpen={openRecord} onNavigate={navigateTo} onHold={toggleHold} onReload={() => guard(() => { setSelection(null); clearCardCache(); setRefresh(value => value + 1); })}/>}
        </div></>}
      </section>
    </main>
    <div id="adm-team-editor-host"/>
    {selection && directory && <Editor key={editorKey} modal={editorOverlay} selection={selection} directory={directory} store={store} imageUrls={previewImages} onSave={persist} onClose={closeEditor} onNavigate={navigateTo} onDirty={setDirty} onRelated={showGameSheet} onZoom={(src, name) => setZoom({ src, name })}/>}
    {applyOpen && directory && <ApplyDialog store={store} directory={directory} onClose={() => { setApplyOpen(false); void readApplyJournal().then(journal => setResumePending(Boolean(journal))).catch(() => setResumePending(true)); }} onApplied={finishApply} onBusy={value => { applyingRef.current = value; setApplying(value); }}/>}
    {accountOpen && <AccountDialog onClose={() => setAccountOpen(false)} onChanged={() => { clearCardCache(); setRefresh(value => value + 1); }}/>}
    {backupOpen && <DraftBackupDialog store={store} onSave={async next => { await persist(next); setSelection(null); setSheetContext(old => ({ key: old.key + 1, gameId: '' })); setEditorKey(value => value + 1); setDirty(false); }} onClose={() => setBackupOpen(false)}/>}
    {toast && <div className="adm-toast" role={toastError ? 'alert' : 'status'}><Icon name={toastError ? 'refresh' : 'check'} size={17}/>{toast}{toastError && <button className="adm-icon-button" aria-label="通知を閉じる" onClick={() => setToast('')}><Icon name="close" size={15}/></button>}</div>}
    {pending && <PreviewDialog title="未保存の変更があります" onClose={() => setPending(null)}><p>入力内容を戻して移動しますか？ 保存する場合は編集を続けてください。</p><footer><button className="adm-button" onClick={() => setPending(null)}>編集を続ける</button><button className="adm-button primary" onClick={() => { const action = pending; setPending(null); setDirty(false); action(); }}>変更を戻して移動</button></footer></PreviewDialog>}
    {resetDialog && <PreviewDialog title="下書きをすべて解除しますか？" onClose={() => setResetDialog(false)}><p>保存した編集・画像を解除します。履歴と既存記録の保留は残ります。新規下書きの保留は、その記録と一緒に解除します。</p><footer><button className="adm-button" disabled={busy} onClick={() => setResetDialog(false)}>キャンセル</button><button className="adm-button primary" disabled={busy} onClick={() => void resetPreview()}>下書きを解除</button></footer></PreviewDialog>}
    {zoom && <PreviewDialog title={zoom.name} onClose={() => setZoom(null)}><img className="adm-full-image" src={zoom.src} alt={zoom.name}/></PreviewDialog>}
  </div>;
}

import { useEffect, useRef, useState } from 'react';
import type { PreviewStore } from './model';
import { backupCounts, exportDraftBackup, readDraftBackup } from './draft-backup';
import { loadCards, loadDirectory, loadGameRelations, loadPeopleDetails } from './data';
import Icon from './Icon';
type Props = { store: PreviewStore; onSave: (next: PreviewStore) => Promise<void>; onClose: () => void };
const labels = { cards: 'カード', people: '人', games: 'ゲーム', teams: 'チーム', images: '画像', history: '変更履歴', holds: '保留' };
export default function DraftBackupDialog({ store, onSave, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null), lock = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [incoming, setIncoming] = useState<PreviewStore | null>(null), [fileName, setFileName] = useState(''), [confirmed, setConfirmed] = useState(false);
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  useEffect(() => { const listener = (event: BeforeUnloadEvent) => { if (lock.current) event.preventDefault(); }; window.addEventListener('beforeunload', listener); return () => window.removeEventListener('beforeunload', listener); }, []);
  const counts = backupCounts(incoming ?? store);
  async function download() {
    if (lock.current) return; lock.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const backup = await exportDraftBackup(store, async (table, ids) => {
        if (table === 'cards') return loadCards(ids);
        if (table === 'people' || table === 'games' || table === 'teams') { const directory = await loadDirectory(); return directory[table] ?? []; }
        const people = [...new Set(ids.map(id => store[table][id]?.person_id).filter((id): id is string => typeof id === 'string' && Boolean(id)))];
        const details = people.length ? await loadPeopleDetails(people) : { links: [], relations: [] };
        if (table === 'links') return details.links;
        const results = [...details.relations], known = new Set(results.map(row => row.id));
        const games = [...new Set(ids.filter(id => !known.has(id)).map(id => store.relations[id]?.event_id).filter((id): id is string => typeof id === 'string' && Boolean(id)))];
        for (let offset = 0; offset < games.length; offset += 3) results.push(...(await Promise.all(games.slice(offset, offset + 3).map(loadGameRelations))).flat());
        return results;
      }), url = URL.createObjectURL(backup), anchor = document.createElement('a');
      anchor.href = url; anchor.download = `かくれんぼ-下書き-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setMessage('画像を含めた下書きを書き出しました。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '書き出しに失敗しました。'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function inspect(file: File) {
    if (lock.current) return; lock.current = true; setBusy(true); setError(''); setMessage(''); setIncoming(null); setConfirmed(false); setFileName('');
    try { const restored = await readDraftBackup(file, store.revision); setIncoming(restored); setFileName(file.name); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'バックアップを読み込めませんでした。'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function restore() {
    if (lock.current || !incoming || !confirmed) return; lock.current = true; setBusy(true); setError('');
    try { await onSave(incoming); setIncoming(null); setFileName(''); setConfirmed(false); setMessage('このブラウザの下書きを取り込みました。DBへの反映は「変更を反映」から行えます。'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '取り込みに失敗しました。現在の下書きは保持されています。'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} className="adm-dialog adm-backup-dialog" aria-labelledby="adm-backup-title" onCancel={event => { event.preventDefault(); if (!lock.current) onClose(); }}><header><h2 id="adm-backup-title">下書きのバックアップ</h2><button className="adm-icon-button" aria-label="バックアップを閉じる" disabled={busy} onClick={onClose}><Icon name="close"/></button></header>
    <p>保存済みの下書きと画像を、別のブラウザや公開URLへ移せます。</p>
    <div className="adm-apply-counts">{(Object.keys(labels) as (keyof typeof labels)[]).map(key => <span key={key}>{labels[key]}<strong>{counts[key].toLocaleString('ja-JP')}</strong></span>)}</div>
    <div className="adm-backup-actions"><button className="adm-button" disabled={busy} onClick={() => void download()}>現在の下書きを書き出す</button><label className="adm-button adm-upload">バックアップを選択<input type="file" accept=".json,application/json" disabled={busy} aria-label="下書きのバックアップを選択" onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ''; if (file) void inspect(file); }}/></label></div>
    {incoming && <div className="adm-backup-confirm"><strong>{fileName}</strong><p>現在の下書きは、上の件数の下書きに置き換わります。</p><label><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)}/>現在の下書きを置き換える</label></div>}
    {message && <p role="status">{message}</p>}{error && <div className="adm-form-error" role="alert">{error}</div>}
    <footer><button className="adm-button" disabled={busy} onClick={onClose}>閉じる</button>{incoming && <button className="adm-button primary" disabled={busy || !confirmed} onClick={() => void restore()}>{busy ? '取り込み中…' : '下書きを取り込む'}</button>}</footer>
  </dialog>;
}

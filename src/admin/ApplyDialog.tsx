import { useEffect, useMemo, useRef, useState } from 'react';
import type { Directory, PreviewStore } from './model';
import { adminClient, adminProjectUrl, applyReviewedPlan, buildApplyPlan, cancelApplyAttempt, checkAdmin, fetchApplyReceipt, reviewApplyPlan, type ApplyPlan, type ApplyReceipt, type ReviewedApplyPlan } from './apply';
import { readApplyJournal, removeApplyJournal, saveApplyJournal, type ApplyJournal } from './apply-journal';
import { readPreview } from './data';
import Icon from './Icon';

type Props = { store: PreviewStore; directory: Directory; onClose: () => void; onApplied: (receipt: ApplyReceipt, plan: ApplyPlan) => Promise<void>; onBusy?: (busy: boolean) => void };
const tableNames: Record<string, string> = { cards: 'カード', people: '人', events: 'ゲーム', teams: 'チーム', card_images: 'カード画像', game_artwork: 'ゲーム画像', participations: '参加ゲーム・マスター', resource_links: '外部リンク', admin_record_flags: '保留' };
const labels: Record<string, string> = { name: '名前', display_name: '名前', code_name: 'コードネーム', event_id: '所属ゲーム', person_id: '人', team_id: 'チーム', source_card_id: 'ID', rank: 'ランク', card_type: 'タイプ', effect_text: '効果', flavor_text: 'フレーバー', joined_year: '入学年', fiscal_year: '開催年', start_date: '開始日', end_date: '終了日', schedule_note: '期間の補足', rank_value: '順位', rank_note: '順位補足', final_score: '最終得点', name_at_event: '参加時の名前', kind: '区分', status: '参加状態', url: 'URL', label: '表示名', on_hold: '保留', external_url: '画像URL', storage_path: '画像', publication_status: '公開状態' };
const display = (value: unknown) => value === undefined || value === null || value === '' ? '未設定' : value === true ? '保留' : value === false ? '解除' : String(value);
export default function ApplyDialog({ store, directory, onClose, onApplied, onBusy }: Props) {
  const [initial] = useState(() => {
    try { return { plan: buildApplyPlan(store, directory), initialError: '' }; }
    catch (cause) { return { plan: null, initialError: cause instanceof Error ? cause.message : '変更内容を確認できませんでした。' }; }
  });
  const [plan, setPlan] = useState(initial.plan), [journal, setJournal] = useState<ApplyJournal | null>(null), [recovering, setRecovering] = useState(false);
  const [review, setReview] = useState<ReviewedApplyPlan | null>(null), [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [step, setStep] = useState<'checking' | 'login' | 'review' | 'error'>('checking'), [busy, setBusy] = useState(false), [error, setError] = useState(initial.initialError), [progress, setProgress] = useState(''), [visible, setVisible] = useState(50);
  const dialog = useRef<HTMLDialogElement>(null), lock = useRef(false), receipt = useRef<ApplyReceipt | null>(null);
  const operations = useMemo(() => new Map((review?.operations ?? []).map(op => [`${op.table}:${op.id}`, op])), [review]);
  const names = new Map([...directory.cards.map(row => [row.id, row.name] as const), ...directory.people.map(row => [row.id, row.display_name] as const), ...directory.games.map(row => [row.id, row.name] as const), ...(directory.teams ?? []).map(row => [row.id, row.display_name] as const), ...Object.values(store.cards).map(row => [row.id, row.name] as const), ...Object.values(store.people).map(row => [row.id, row.display_name] as const), ...Object.values(store.games).map(row => [row.id, row.name] as const), ...Object.values(store.teams).map(row => [row.id, row.display_name] as const)]);
  useEffect(() => { dialog.current?.showModal(); return () => { dialog.current?.close(); }; }, []);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([adminClient.auth.getSession(), readApplyJournal()]).then(async ([result, prior]) => {
      if (cancelled) return;
      if (prior) { setJournal(prior); setPlan(prior.plan); setRecovering(true); setError(''); }
      if (!prior && !initial.plan) { setStep('error'); return; }
      if (!result.data.session) { setStep('login'); return; }
      try {
        const account = await checkAdmin();
        if (prior && account.id !== prior.actorId) throw new Error(`前回の反映を開始した ${prior.actorEmail || '管理者'} でログインし直してください。`);
        const confirmed = prior ? await fetchApplyReceipt(prior.plan) : null;
        const next = prior?.plan ?? await reviewApplyPlan(initial.plan!);
        if (!cancelled) { receipt.current = confirmed; setReview(next); setStep('review'); }
      }
      catch (cause) { if (!cancelled) { setError(cause instanceof Error ? cause.message : '管理者の確認ができませんでした。'); setStep('login'); } }
    }).catch(cause => { if (!cancelled) { setError(cause instanceof Error ? cause.message : '接続できませんでした。下書きは保持されています。'); setStep('error'); } });
    return () => { cancelled = true; };
  }, [initial]);
  useEffect(() => { const beforeUnload = (event: BeforeUnloadEvent) => { if (lock.current) event.preventDefault(); }; window.addEventListener('beforeunload', beforeUnload); return () => window.removeEventListener('beforeunload', beforeUnload); }, []);
  async function signIn() {
    if (lock.current || !plan) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await adminClient.auth.signInWithPassword({ email: email.trim(), password });
      setPassword('');
      if (result.error) throw new Error('メールアドレスとパスワードを確認してください。');
      const account = await checkAdmin(), prior = await readApplyJournal();
      if (prior && account.id !== prior.actorId) throw new Error(`前回の反映を開始した ${prior.actorEmail || '管理者'} でログインし直してください。`);
      if (prior) { setJournal(prior); setPlan(prior.plan); setRecovering(true); receipt.current = await fetchApplyReceipt(prior.plan); setReview(prior.plan); }
      else setReview(await reviewApplyPlan(plan));
      setStep('review');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'ログインできませんでした。'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function apply() {
    if (!review || !plan || lock.current) return;
    lock.current = true; setBusy(true); onBusy?.(true); setError('');
    try {
      if (!receipt.current && !recovering && (await readPreview()).revision !== plan.storeRevision) throw new Error('別の画面で下書きが更新されました。この確認を閉じ、最新の下書きを読み込んでから反映してください。');
      const account = await checkAdmin();
      if (journal && journal.actorId !== account.id) throw new Error('前回の反映を開始した管理者でログインしてください。');
      const nextJournal: ApplyJournal = { version: 1, projectUrl: adminProjectUrl, actorId: account.id, actorEmail: account.email, startedAt: journal?.startedAt ?? new Date().toISOString(), plan: review, receipt: receipt.current };
      await saveApplyJournal(nextJournal); setJournal(nextJournal); setRecovering(true);
      receipt.current ??= await applyReviewedPlan(review, setProgress);
      await saveApplyJournal({ ...nextJournal, receipt: receipt.current });
      setProgress('反映済みの履歴を保存しています…');
      await onApplied(receipt.current, plan);
      await removeApplyJournal(plan.batchId);
      onClose();
    } catch (cause) { setError(receipt.current ? 'DBへの反映は完了しましたが、このブラウザの履歴を保存できませんでした。「履歴を保存」で再試行してください。' : cause instanceof Error ? cause.message : '変更を反映できませんでした。下書きは保持されています。'); }
    finally { lock.current = false; setBusy(false); onBusy?.(false); setProgress(''); }
  }
  async function refreshReview() {
    if (lock.current || receipt.current || !plan) return;
    lock.current = true; setBusy(true); setError('');
    try {
      // Receipt lookup waits for an earlier in-flight transaction with this ID.
      const confirmed = recovering ? await fetchApplyReceipt(plan) : null;
      if (confirmed) { receipt.current = confirmed; setReview(journal?.plan ?? review); }
      else { const latest = await reviewApplyPlan(plan); if (journal) { const updated = { ...journal, plan: latest }; await saveApplyJournal(updated); setJournal(updated); } setReview(latest); }
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : '変更内容を確認できませんでした。'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function cancelAttempt() {
    if (lock.current || receipt.current || !plan || !journal) return;
    lock.current = true; setBusy(true); onBusy?.(true); setError('');
    let closeAfter = false;
    try {
      const account = await checkAdmin();
      if (account.id !== journal.actorId) throw new Error('前回の反映を開始した管理者でログインしてください。');
      const confirmed = await cancelApplyAttempt(plan);
      if (confirmed) {
        receipt.current = confirmed;
        await saveApplyJournal({ ...journal, receipt: confirmed });
        setError('DBへの反映は完了していました。履歴を保存してください。');
      } else {
        await removeApplyJournal(plan.batchId);
        closeAfter = true;
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '反映の中止を確認できませんでした。下書きは保持されています。'); }
    finally { lock.current = false; setBusy(false); onBusy?.(false); if (closeAfter) onClose(); }
  }
  return <dialog className="adm-dialog adm-apply-dialog" ref={dialog} aria-labelledby="adm-apply-title" onCancel={event => { event.preventDefault(); if (!lock.current && !receipt.current) onClose(); }}>
    <header><h2 id="adm-apply-title">変更を反映</h2><button type="button" className="adm-icon-button" aria-label="反映の確認を閉じる" disabled={busy || Boolean(receipt.current)} onClick={onClose}><Icon name="close"/></button></header>
    <div className="adm-apply-content">
      {step === 'checking' && <p role="status">管理者と変更内容を確認しています…</p>}
      {recovering && step === 'review' && <p className="adm-apply-note">前回の反映を再開します。{receipt.current ? 'DBへの反映は完了しています。履歴を保存してください。' : '確認した変更を同じ反映として再試行できます。入力を直す場合は、この反映を中止してください。下書きは保持されます。'}</p>}
      {step === 'login' && <form onSubmit={event => { event.preventDefault(); void signIn(); }}><p>変更の反映には、管理者のログインが必要です。</p><fieldset disabled={busy}><label className="adm-field"><span className="adm-field-label">メールアドレス</span><input autoComplete="username" type="email" required value={email} onChange={event => setEmail(event.target.value)}/></label><label className="adm-field"><span className="adm-field-label">パスワード</span><input autoComplete="current-password" type="password" required value={password} onChange={event => setPassword(event.target.value)}/></label><button className="adm-button primary" type="submit">{busy ? '確認中…' : 'ログインして確認'}</button></fieldset></form>}
      {step === 'review' && review && plan && <><p>未反映の変更をまとめて保存します。保留の記録も含まれます。</p><div className="adm-apply-counts">{(['cards', 'people', 'games', 'teams', 'images', 'relations', 'links', 'holds'] as const).filter(key => plan.counts[key]).map(key => <span key={key}>{({ cards: 'カード', people: '人', games: 'ゲーム', teams: 'チーム', images: '画像', relations: '参加履歴', links: 'リンク', holds: '保留' })[key]} <strong>{plan.counts[key]}</strong></span>)}</div><p className="adm-apply-note">DBの最新情報との差分です。新規カードも公開画面に反映されます。</p><div className="adm-apply-diffs">{review.diffs.slice(0, visible).map(diff => {
        const changed = diff.after ? Object.keys(diff.after).filter(key => key in (operations.get(`${diff.table}:${diff.id}`)?.data ?? {}) && JSON.stringify(diff.before?.[key]) !== JSON.stringify(diff.after?.[key])) : [];
        return <details key={`${diff.table}:${diff.id}`}><summary><span>{tableNames[diff.table]}</span><strong>{names.get(diff.id) ?? (typeof diff.after?.card_id === 'string' ? names.get(diff.after.card_id) : undefined) ?? (typeof diff.after?.record_id === 'string' ? names.get(diff.after.record_id) : undefined) ?? '関連する情報'}</strong><small>{!diff.after ? '解除' : diff.before ? changed.length ? `${changed.length}項目` : '変更なし' : '追加'}</small></summary>{diff.after ? changed.map(key => <div className="adm-apply-diff" key={key}><strong>{labels[key] ?? key}</strong><span>{['event_id', 'person_id', 'team_id'].includes(key) ? names.get(String(diff.before?.[key])) ?? display(diff.before?.[key]) : key === 'storage_path' ? diff.before?.[key] ? '変更前の画像' : '未設定' : display(diff.before?.[key])}</span><span>{['event_id', 'person_id', 'team_id'].includes(key) ? names.get(String(diff.after?.[key])) ?? display(diff.after?.[key]) : key === 'storage_path' ? diff.after?.[key] ? '選択した画像' : '未設定' : display(diff.after?.[key])}</span></div>) : <p>この関連付けを解除します。</p>}</details>;
      })}{review.diffs.length > visible && <button className="adm-button" onClick={() => setVisible(count => count + 50)}>続きを確認</button>}</div></>}
      {error && <div className="adm-form-error" role="alert">{error}</div>}{progress && <p role="status">{progress}</p>}
    </div>
    {step === 'review' && <footer>{recovering && journal && !receipt.current && <button className="adm-button" disabled={busy} onClick={() => void cancelAttempt()}>この反映を中止</button>}<button className="adm-button" disabled={busy || Boolean(receipt.current)} onClick={() => void refreshReview()}>最新の差分を確認</button><button className="adm-button primary" disabled={busy || !review} onClick={() => void apply()}>{busy ? '反映中…' : receipt.current ? '履歴を保存' : recovering ? '反映を再開' : '変更を反映'}</button></footer>}
  </dialog>;
}

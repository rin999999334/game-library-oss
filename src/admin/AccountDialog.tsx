import { useEffect, useRef, useState } from 'react';
import { adminClient, checkAdmin } from './apply';
import Icon from './Icon';

export default function AccountDialog({ onClose, onChanged, variant = 'dialog' }: { onClose: () => void; onChanged: () => void; variant?: 'dialog' | 'page' }) {
  const dialog = useRef<HTMLDialogElement>(null), lock = useRef(false);
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [account, setAccount] = useState<string | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { const element = dialog.current; element?.showModal(); let active = true;
    void adminClient.auth.getSession().then(async result => { if (result.data.session) { const user = await checkAdmin(); if (active) { setAccount(user.email); setEmail(user.email); } } }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'アカウントを確認できませんでした。'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; element?.close(); };
  }, [variant]);
  async function signIn() {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    try { const result = await adminClient.auth.signInWithPassword({ email: email.trim(), password }); setPassword(''); if (result.error) throw new Error('メールアドレスとパスワードを確認してください。'); await checkAdmin(); onChanged(); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'ログインできませんでした。'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function signOut() {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    try { const result = await adminClient.auth.signOut(); if (result.error) throw new Error('ログアウトできませんでした。'); onChanged(); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'ログアウトできませんでした。'); }
    finally { lock.current = false; setBusy(false); }
  }
  const content = <><header><h2 id="adm-account-title">{variant === 'page' ? 'かくれんぼ 管理' : '管理者アカウント'}</h2>{variant === 'dialog' && <button className="adm-icon-button" disabled={busy} aria-label="アカウントを閉じる" onClick={onClose}><Icon name="close"/></button>}</header>
    {loading ? <p role="status">アカウントを確認しています…</p> : account ? <><p>{account}</p><footer><button className="adm-button" disabled={busy} onClick={() => void signOut()}>ログアウト</button><button className="adm-button primary" disabled={busy} onClick={variant === 'page' ? onChanged : onClose}>{variant === 'page' ? '管理画面へ' : '閉じる'}</button></footer></> : <form onSubmit={event => { event.preventDefault(); void signIn(); }}><fieldset disabled={busy}><label className="adm-field"><span className="adm-field-label">メールアドレス</span><input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)}/></label><label className="adm-field"><span className="adm-field-label">パスワード</span><input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)}/></label><footer><button className="adm-button primary" type="submit">{busy ? '確認中…' : 'ログイン'}</button></footer></fieldset></form>}
    {error && <div className="adm-form-error" role="alert">{error}</div>}
  </>;
  return variant === 'page' ? <section className="adm-dialog adm-account-dialog adm-login-card" aria-labelledby="adm-account-title">{content}</section> : <dialog className="adm-dialog adm-account-dialog" ref={dialog} aria-labelledby="adm-account-title" onCancel={event => { event.preventDefault(); if (!lock.current) onClose(); }}>{content}</dialog>;
}

import { demoMode } from '../supabase';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import AccountDialog from './AccountDialog';
import { adminClient, checkAdmin } from './apply';
import { clearCardCache } from './data';

export default function AdminAccess({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'checking' | 'login' | 'authorized'>('checking');
  const [error, setError] = useState('');
  const generation = useRef(0);
  const verify = useCallback(async () => {
    if (demoMode) return;
    const current = ++generation.current; setError('');
    try {
      const result = await adminClient.auth.getSession();
      if (result.error) throw result.error;
      if (!result.data.session) { if (current === generation.current) setState('login'); return; }
      await checkAdmin();
      if (current === generation.current) { clearCardCache(); setState('authorized'); }
    } catch (cause) {
      if (current === generation.current) { setState('login'); setError(cause instanceof Error ? cause.message : '管理者を確認できませんでした。'); }
    }
  }, []);
  useEffect(() => {
    if (demoMode) return;
    void verify();
    const { data } = adminClient.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') { generation.current++; clearCardCache(); setState('login'); }
      else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') queueMicrotask(() => { void verify(); });
    });
    return () => { generation.current++; data.subscription.unsubscribe(); };
  }, [verify]);
  if (demoMode) return <main className="adm-login-page"><p>デモでは管理画面を利用しません。</p><a href="/">閲覧画面へ戻る</a></main>;
  if (state === 'authorized') return children;
  return <main className="adm-login-page"><img src="/app-icon-v2-180.png" alt=""/>{state === 'checking' ? <p role="status">管理者を確認しています…</p> : <><AccountDialog variant="page" onClose={() => {}} onChanged={() => { void verify(); }}/>{error && <p className="adm-form-error" role="alert">{error}</p>}<a className="adm-text-button" href="/">アプリへ戻る</a></>}</main>;
}

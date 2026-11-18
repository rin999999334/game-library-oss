// Browser bundles may contain only publishable / legacy anon keys.
// Throw without including the supplied value in error messages.
export function assertPublicKey(key: string | undefined) {
  if (!key) return;
  if (key !== key.trim()) throw new Error('Supabaseキーの前後に空白を含めることはできません。');
  if (key.startsWith('sb_secret_')) throw new Error('ブラウザに秘密のSupabaseキーは設定できません。公開用キーを使用してください。');
  const parts = key.split('.');
  if (parts.length !== 3) return;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.role !== 'anon') throw new Error('unsafe-role');
  } catch {
    throw new Error('ブラウザ用のSupabase JWTはanonロールである必要があります。');
  }
}

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { EventRow, ParticipationRow, TeamRow } from '../database';
import { loadGameRelations, loadTeamRelations } from './data';
import { visibleFocusTargets } from './focus';
import { mergeRows, type Directory, type PreviewStore } from './model';
import { makeTeamChangeEntry, teamMembers, validateTeam } from './team-model';
import { planTeamMemberEdits, teamAssignmentCandidates } from './team-members';
import Picker from './Picker';
import Icon from './Icon';

type Props = { team: TeamRow; isNew: boolean; originElement: HTMLElement | null; directory: Directory; store: PreviewStore; games: EventRow[]; modal: boolean; onSave: (next: PreviewStore) => Promise<void>; onDirty: (dirty: boolean) => void; onClose: () => void; onGame: (id: string) => void };
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="adm-field"><span className="adm-field-label">{label}</span>{children}</label>; }

export default function TeamEditor({ team, isNew, originElement, directory, store, games, modal, onSave, onDirty, onClose, onGame }: Props) {
  const [row, setRow] = useState(team), [members, setMembers] = useState<ParticipationRow[]>([]), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState(false);
  const [memberEdits, setMemberEdits] = useState<Record<string, ParticipationRow>>({}), [reload, setReload] = useState(0);
  const [numbers, setNumbers] = useState({ rank_value: String(team.rank_value ?? ''), final_score: String(team.final_score ?? '') });
  const memberBefore = useRef(new Map<string, ParticipationRow>());
  const [dirty, setDirty] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const baseline = useRef(team), saveLock = useRef(false), restoreSaveFocus = useRef(false), panel = useRef<HTMLElement>(null), nameInput = useRef<HTMLInputElement>(null), titleId = useId();
  const origin = useRef(originElement);
  const existing = Boolean(directory.teams?.some(item => item.id === team.id));
  const people = useMemo(() => new Map(mergeRows(directory.people, store.people).map(person => [person.id, person])), [directory.people, store.people]);
  const teams = useMemo(() => mergeRows(directory.teams ?? [], { ...store.teams, [row.id]: row }), [directory.teams, store.teams, row]);
  const originalRelations = useMemo(() => mergeRows(members, store.relations, store.removedRelations).filter(member => member.event_id === row.event_id || member.team_id === row.id), [members, store.relations, store.removedRelations, row.event_id, row.id]);
  const workingRelations = useMemo(() => mergeRows(originalRelations, memberEdits), [originalRelations, memberEdits]);
  const assignedMembers = workingRelations.filter(member => member.team_id === row.id);
  const teamNames = new Map(teams.map(item => [item.id, item.display_name]));
  const memberChoices = teamAssignmentCandidates(workingRelations, row.event_id, row.id).map(member => ({ id: `rel:${member.id}`, label: people.get(member.person_id)?.display_name || member.name_at_event || '人物未登録', subtitle: `${member.team_id ? teamNames.get(member.team_id) || 'チーム未登録' : 'チーム未所属'} · ${member.kind === 'participant' ? '参加者' : member.kind || '区分未設定'}${member.name_at_event ? ` · ${member.name_at_event}` : ''}` }));
  const participatingPeople = new Set(workingRelations.filter(member => member.event_id === row.event_id).map(member => member.person_id));
  for (const person of people.values()) if (!participatingPeople.has(person.id)) memberChoices.push({ id: `new:${person.id}`, label: person.display_name, subtitle: 'このゲームに参加履歴を追加' });
  memberChoices.sort((a, b) => a.label.localeCompare(b.label, 'ja'));
  useEffect(() => {
    let cancelled = false; setLoading(true); setLoadError(false); setError('');
    const gameExists = directory.games.some(game => game.id === row.event_id);
    void Promise.all([existing ? loadTeamRelations([team.id]) : Promise.resolve([]), gameExists ? loadGameRelations(row.event_id) : Promise.resolve([])]).then(([own, gameRows]) => { if (!cancelled) { setMembers(mergeRows(own, Object.fromEntries(gameRows.map(member => [member.id, member])))); setLoading(false); } }).catch(cause => { if (!cancelled) { setError(cause instanceof Error ? cause.message : '参加者を読み込めませんでした。'); setLoadError(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [team.id, existing, row.event_id, directory.games, reload]);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => { const prevent = (event: BeforeUnloadEvent) => { if (dirty || saveLock.current) event.preventDefault(); }; window.addEventListener('beforeunload', prevent); return () => window.removeEventListener('beforeunload', prevent); }, [dirty]);
  useEffect(() => { nameInput.current?.focus({ preventScroll: true }); }, []);
  useLayoutEffect(() => {
    if (!saving && restoreSaveFocus.current) { restoreSaveFocus.current = false; if (document.activeElement === document.body) nameInput.current?.focus({ preventScroll: true }); }
  }, [saving]);
  useLayoutEffect(() => {
    const element = panel.current;
    return () => {
      const restore = () => {
        if (element?.isConnected) return;
        const focused = document.activeElement;
        if ((focused === document.body || element?.contains(focused)) && origin.current?.isConnected && !origin.current.closest('[inert]')) origin.current.focus({ preventScroll: true });
      };
      queueMicrotask(() => { restore(); if (document.activeElement === document.body) requestAnimationFrame(restore); });
    };
  }, []);
  function update<K extends keyof TeamRow>(key: K, value: TeamRow[K]) { if (saveLock.current) return; setRow(old => ({ ...old, [key]: value })); setDirty(true); if (!loadError) setError(''); }
  function updateNumber(key: 'rank_value' | 'final_score', value: string) { if (saveLock.current) return; setNumbers(old => ({ ...old, [key]: value })); setDirty(true); if (!loadError) setError(''); }
  function stageMember(member: ParticipationRow, teamId: string | null) {
    if (saveLock.current || loading || loadError || member.team_id === teamId || (teamId && member.kind === 'master')) return;
    const original = originalRelations.find(item => item.id === member.id);
    if (original && !memberBefore.current.has(member.id)) memberBefore.current.set(member.id, original);
    setMemberEdits(old => { const next = { ...old }; if (!teamId && !original) delete next[member.id]; else next[member.id] = { ...member, team_id: teamId }; return next; });
    setDirty(true); setError('');
  }
  function addMember(value: string) {
    if (saveLock.current || loading || loadError) return;
    if (value.startsWith('rel:')) { const member = workingRelations.find(item => item.id === value.slice(4)); if (member) stageMember(member, row.id); }
    else if (value.startsWith('new:')) {
      const person = people.get(value.slice(4)); if (!person || participatingPeople.has(person.id)) return;
      const member: ParticipationRow = { id: crypto.randomUUID(), person_id: person.id, event_id: row.event_id, team_id: row.id, role_id: null, kind: 'participant', name_at_event: person.display_name, status: 'attended' };
      setMemberEdits(old => ({ ...old, [member.id]: member })); setDirty(true); setError('');
    }
  }
  function discard() { if (saveLock.current) return; setRow(baseline.current); setNumbers({ rank_value: String(baseline.current.rank_value ?? ''), final_score: String(baseline.current.final_score ?? '') }); setMemberEdits({}); memberBefore.current.clear(); setDirty(false); if (!loadError) setError(''); }
  async function save() {
    if (saveLock.current || loading || loadError) return;
    const candidate = { ...row, rank_value: numbers.rank_value.trim() ? Number(numbers.rank_value) : null, final_score: numbers.final_score.trim() ? Number(numbers.final_score) : null };
    const invalid = validateTeam(candidate, games, teamMembers(members, store, row.id), isNew && !store.teams[row.id] ? undefined : baseline.current);
    if (invalid) { setError(invalid); return; }
    saveLock.current = true; setSaving(true); setError('');
    try {
      const entry = makeTeamChangeEntry(baseline.current, candidate, Boolean(isNew && !store.teams[row.id]), games);
      const memberPlan = planTeamMemberEdits(store, memberBefore.current, memberEdits, candidate, { ...directory, games });
      if (entry || memberPlan) {
        const next = memberPlan?.next ?? store;
        await onSave({ ...next, teams: { ...next.teams, [row.id]: candidate }, history: [...store.history, ...(entry ? [entry] : []), ...(memberPlan ? [memberPlan.entry] : [])], savedAt: new Date().toISOString() });
      }
      baseline.current = candidate; setRow(candidate); setNumbers({ rank_value: String(candidate.rank_value ?? ''), final_score: String(candidate.final_score ?? '') }); setMemberEdits({}); memberBefore.current.clear(); setDirty(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '下書きを保存できませんでした。'); }
    finally { saveLock.current = false; restoreSaveFocus.current = true; setSaving(false); }
  }
  function keyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented) return;
    if (event.key === 'Escape') { event.preventDefault(); if (!saveLock.current) onClose(); return; }
    if (!modal || event.key !== 'Tab') return;
    const controls = panel.current ? visibleFocusTargets(panel.current) : [];
    if (!controls.length) { event.preventDefault(); panel.current?.focus(); return; }
    const first = controls[0], last = controls[controls.length - 1], focused = document.activeElement;
    if (event.shiftKey && (focused === first || focused === panel.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (focused === last || focused === panel.current)) { event.preventDefault(); first.focus(); }
  }
  return <aside className="adm-editor adm-team-editor" ref={panel} role={modal ? 'dialog' : undefined} aria-modal={modal || undefined} aria-labelledby={titleId} aria-busy={saving} tabIndex={-1} onKeyDown={keyDown}>
    <header className="adm-editor-header"><div><span className="adm-eyebrow">{isNew && !store.teams[row.id] ? '新しい記録' : '記録を編集'}</span><h2 id={titleId}>{row.display_name || 'チームを追加'}</h2></div><button type="button" className="adm-icon-button" aria-label="チーム編集パネルを閉じる" disabled={saving} onClick={onClose}><Icon name="close"/></button></header>
    <fieldset className="adm-editor-content" disabled={saving} style={{ border: 0, margin: 0, minInlineSize: 0 }}>
      <section className="adm-editor-section"><h3>基本情報</h3><Field label="チーム名"><input ref={nameInput} aria-label="チーム名" value={row.display_name} placeholder="チーム名" onChange={event => update('display_name', event.target.value)}/></Field><div className="adm-field"><span className="adm-field-label">所属ゲーム</span><div className="adm-linked-field"><Picker label="チームの所属ゲーム" options={games.map(game => ({ id: game.id, label: game.name }))} value={row.event_id} disabled={loading || originalRelations.some(member => member.team_id === row.id) || Object.keys(memberEdits).length > 0} onChange={value => update('event_id', value)}/><button type="button" className="adm-icon-button" aria-label="チームの所属ゲームを開く" disabled={!row.event_id} onClick={() => onGame(row.event_id)}><Icon name="arrow" size={17}/></button></div></div></section>
      <section className="adm-editor-section"><h3>順位と得点</h3><div className="adm-field-grid"><Field label="順位"><input aria-label="チームの順位" inputMode="numeric" value={numbers.rank_value} onChange={event => updateNumber('rank_value', event.target.value)}/></Field><Field label="最終得点"><input aria-label="チームの最終得点" inputMode="decimal" value={numbers.final_score} onChange={event => updateNumber('final_score', event.target.value)}/></Field></div><Field label="順位補足"><input aria-label="順位補足" value={row.rank_note ?? ''} placeholder="最下位など" onChange={event => update('rank_note', event.target.value.trim() ? event.target.value : null)}/></Field></section>
      <section className="adm-editor-section"><h3>参加者{!loading && ` · ${new Set(assignedMembers.map(member => member.person_id)).size}人`}</h3>{loading ? <p className="adm-empty-inline" role="status">参加者を読み込んでいます…</p> : <>{assignedMembers.map(member => <div className="adm-relation" key={member.id}><div className="adm-relation-heading"><span className="adm-relation-name">{member.name_at_event || people.get(member.person_id)?.display_name || '人物未登録'}</span><button className="adm-icon-button" type="button" aria-label={`${member.name_at_event || people.get(member.person_id)?.display_name || '参加者'}をチームから外す`} onClick={() => stageMember(member, null)}><Icon name="close" size={15}/></button></div><small>{people.get(member.person_id)?.display_name || '人物未登録'} · {member.kind === 'master' ? 'マスター' : member.kind === 'participant' ? '参加者' : member.kind || '区分未設定'}{member.status !== 'attended' ? ` · ${member.status}` : ''}</small><Picker label={`${member.name_at_event || '参加者'}の所属チーム`} options={teams.filter(item => item.event_id === member.event_id).map(item => ({ id: item.id, label: item.display_name }))} value={member.team_id ?? ''} disabled={loadError || member.kind === 'master'} onChange={value => stageMember(member, value)} placeholder="所属チームを選択"/></div>)}{!assignedMembers.length && !loadError && <p className="adm-empty-inline">参加者は未登録です。</p>}{!loadError && <Picker label="参加者を追加" options={memberChoices} value="" onChange={addMember} placeholder="＋ 参加者を追加" disabled={loading || !row.event_id}/>}<small className="adm-relation-note">チームから外しても、ゲームの参加履歴は保持されます。マスターのチーム割当は解除のみ可能です。</small></>}{loadError && <button className="adm-text-button" type="button" onClick={() => setReload(value => value + 1)}>参加者を再読み込み</button>}</section>
      <details className="adm-record-details"><summary>詳細情報</summary><Field label="記録の識別子"><input aria-label="チームの識別子" value={row.id} readOnly/></Field></details>{error && <div className="adm-form-error" role="alert">{error}</div>}
    </fieldset>
    <footer className="adm-editor-footer"><small>{dirty ? '未保存の変更あり' : 'ブラウザ内の下書き'}</small><div><button type="button" className="adm-button" disabled={!dirty || saving} onClick={discard}>変更を戻す</button><button type="button" className="adm-button primary" disabled={loading || loadError || saving || (!dirty && !(isNew && !store.teams[row.id]))} onClick={() => void save()}>{saving ? '保存中…' : '下書きを保存'}</button></div></footer>
  </aside>;
}

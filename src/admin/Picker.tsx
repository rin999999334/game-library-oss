import { useEffect, useRef, useState } from 'react';
import { normaliseSearch } from '../model';
import Icon from './Icon';
export type Choice = { id: string; label: string; subtitle?: string };
export default function Picker({ label, options, value, onChange, placeholder = '選択してください', disabled = false }: { label: string; options: Choice[]; value: string; onChange: (id: string) => void; placeholder?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false), [q, setQ] = useState('');
  const search = useRef<HTMLInputElement>(null), trigger = useRef<HTMLButtonElement>(null), root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  const matches = options.filter(option => normaliseSearch(option.label).includes(normaliseSearch(q)));
  return <div className="adm-picker" ref={root} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); trigger.current?.focus(); } }}>
    <button type="button" className="adm-picker-trigger" ref={trigger} aria-label={label} aria-expanded={open} disabled={disabled} onClick={() => { setQ(''); setOpen(!open); }}><span>{options.find(option => option.id === value)?.label ?? placeholder}</span><Icon name="chevron" size={14}/></button>
    {open && <div className="adm-picker-popover"><div className="adm-picker-search"><Icon name="search" size={16}/><input aria-label={`${label}を検索`} ref={search} value={q} placeholder="名前で検索" onChange={event => setQ(event.target.value)}/></div><div className="adm-picker-options" role="listbox" aria-label={`${label}の候補`}>{matches.slice(0, 40).map(option => <button role="option" aria-selected={value === option.id} type="button" key={option.id} onClick={() => { onChange(option.id); setOpen(false); trigger.current?.focus(); }}><span>{option.label}{option.subtitle && <small>{option.subtitle}</small>}</span>{value === option.id && <Icon name="check" size={16}/>}</button>)}{!matches.length && <p>該当する項目がありません。</p>}</div>{matches.length > 40 && <small className="adm-picker-hint">名前を入力すると候補を絞り込めます</small>}</div>}
  </div>;
}

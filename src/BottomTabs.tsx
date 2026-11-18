import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { Tab } from './navigation';
import { Icon } from './ui';
import './bottom-tabs.css';

const items = [
  { tab: 'home', icon: 'home', label: 'ホーム' },
  { tab: 'cards', icon: 'folder', label: 'カード' },
  { tab: 'search', icon: 'search', label: '検索' },
] as const;
type Drag = { id: number; x: number; y: number; step: number; origin: number; offset: number; moved: boolean };

export function BottomTabs({ active, onChange }: { active: Tab; onChange: (tab: Tab) => void }) {
  const [selection,setSelection]=useState(active);
  useEffect(()=>setSelection(active),[active]);
  const choose=(tab:Tab)=>{setSelection(tab);onChange(tab);};
  const drag = useRef<Drag | null>(null), suppressClick = useRef(false);
  const reset = (element: HTMLElement) => {
    drag.current = null;
    delete element.dataset.dragging;
    element.style.removeProperty('--tab-drag-x');
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.id) return;
    const dx = event.clientX-current.x, dy = event.clientY-current.y;
    if (!current.moved) {
      if (Math.abs(dy)>8 && Math.abs(dy)>Math.abs(dx)) { reset(event.currentTarget); return; }
      if (Math.abs(dx)<8) return;
      current.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.dataset.dragging = 'true';
    }
    current.offset = Math.max(0, Math.min(current.step*2, current.origin+dx));
    event.currentTarget.style.setProperty('--tab-drag-x', `${current.offset}px`);
  };
  const end = (event: PointerEvent<HTMLElement>, cancelled = false) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.id) return;
    const selected = items[Math.round(current.offset/current.step)].tab;
    suppressClick.current = current.moved;
    reset(event.currentTarget);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (current.moved && !cancelled) choose(selected);
  };
  return (
    <nav className={'tabs bottom-tabs bottom-tabs--' + selection} aria-label="メインナビゲーション"
      onPointerDown={event => {
        if (!event.isPrimary || event.button!==0) return;
        suppressClick.current=false;
        const step=(event.currentTarget.clientWidth-8)/3;
        const origin=items.findIndex(item=>item.tab===selection)*step;
        drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,step,origin,offset:origin,moved:false};
      }}
      onPointerMove={move} onPointerUp={event=>end(event)}
      onPointerCancel={event=>end(event,true)} onLostPointerCapture={event=>end(event,true)}
      onClickCapture={event=>{if(suppressClick.current && event.detail!==0){event.preventDefault();event.stopPropagation();suppressClick.current=false;}}}>
      <span className="bottom-tabs-selection" aria-hidden="true" />
      {items.map(item => (
        <button type="button" key={item.tab} className={'tab ' + (selection === item.tab ? 'active' : '')}
          aria-current={selection === item.tab ? 'page' : undefined} onClick={() => choose(item.tab)}>
          <span className="bottom-tabs-icon" aria-hidden="true"><Icon name={item.icon} /></span>
          <span className="bottom-tabs-label">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

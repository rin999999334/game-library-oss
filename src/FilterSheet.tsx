import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Icon } from './ui';
import './filter-motion.css';

type SheetPhase = 'closed' | 'opening' | 'open' | 'dragging' | 'snapping' | 'closing';
type SheetDrag = {
  pointerId: number; target: HTMLElement; startX: number; startY: number;
  baseOffset: number; offset: number; height: number; locked: boolean;
  lastY: number; lastTime: number; velocity: number;
};
const ENTER_MS = 360, EXIT_MS = 240, SNAP_MS = 340;
const motionProperties = ['--sheet-drag-y', '--sheet-drag-backdrop-opacity', '--sheet-exit-transform', '--sheet-exit-opacity', '--sheet-exit-backdrop-opacity', '--sheet-exit-duration'];

export function FilterSheet({ label, active, onOpen, onClear, onReset, resetDisabled, onApply, children }: {
  label: string; active: boolean; onOpen: () => void; onClear: () => void;
  onReset: () => void; resetDisabled: boolean; onApply: () => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null), id = useId();
  const [phase, setPhase] = useState<SheetPhase>('closed');
  const phaseRef = useRef<SheetPhase>('closed'), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const drag = useRef<SheetDrag | null>(null);
  const clearTimer = () => { clearTimeout(timer.current); timer.current = undefined; };
  const changePhase = (next: SheetPhase) => { phaseRef.current = next; setPhase(next); };
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clearMotionStyles = () => { for (const property of motionProperties) dialog.current?.style.removeProperty(property); };
  const releaseCapture = () => {
    const current = drag.current; drag.current = null;
    if (!current) return;
    try { if (current.target.hasPointerCapture(current.pointerId)) current.target.releasePointerCapture(current.pointerId); } catch { /* The browser may have released a cancelled pointer. */ }
  };
  const finishSnap = () => {
    if (phaseRef.current !== 'snapping') return;
    clearTimer(); changePhase('open'); clearMotionStyles();
  };
  const snapBack = () => {
    if (phaseRef.current !== 'dragging') return;
    const offset = drag.current?.offset ?? 0;
    clearTimer(); releaseCapture();
    if (offset === 0 || reducedMotion()) { changePhase('open'); clearMotionStyles(); }
    else { changePhase('snapping'); timer.current = setTimeout(finishSnap, SNAP_MS + 80); }
  };
  const finishClose = () => {
    if (phaseRef.current !== 'closing') return;
    clearTimer();
    // Keep the native modal's focus trap and inert background until exit finishes.
    dialog.current?.close();
  };
  const close = (velocity = 0) => {
    if (phaseRef.current === 'closed' || phaseRef.current === 'closing') return;
    const element = dialog.current;
    if (!element) return;
    const current = getComputedStyle(element), backdrop = getComputedStyle(element, '::backdrop');
    // Exit starts from the live drag/animation position, so a quick dismissal never jumps up.
    element.style.setProperty('--sheet-exit-transform', phaseRef.current === 'dragging' ? `translateY(${drag.current?.offset ?? 0}px)` : current.transform === 'none' ? 'translateY(0)' : current.transform);
    element.style.setProperty('--sheet-exit-opacity', current.opacity);
    element.style.setProperty('--sheet-exit-backdrop-opacity', backdrop.opacity);
    const remaining = Math.max(0, element.offsetHeight - (drag.current?.offset ?? 0));
    const duration = velocity > .1 ? Math.max(120, Math.min(EXIT_MS, remaining / velocity)) : EXIT_MS;
    element.style.setProperty('--sheet-exit-duration', `${duration}ms`);
    clearTimer(); releaseCapture(); changePhase('closing');
    if (reducedMotion()) finishClose();
    else timer.current = setTimeout(finishClose, duration + 80);
  };
  const show = () => {
    if (phaseRef.current !== 'closed' || !dialog.current) return;
    clearTimer(); releaseCapture(); clearMotionStyles(); onOpen(); dialog.current.showModal();
    if (reducedMotion()) changePhase('open');
    else {
      changePhase('opening');
      timer.current = setTimeout(() => {
        if (phaseRef.current === 'opening') changePhase('open');
      }, ENTER_MS + 80);
    }
  };
  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!event.isPrimary || event.button !== 0 || drag.current || !['opening', 'open', 'snapping'].includes(phaseRef.current)) return;
    if (event.target instanceof Element && event.target.closest('button, a, input, select, textarea, [role="button"]')) return;
    const element = dialog.current;
    if (!element) return;
    const transform = getComputedStyle(element).transform;
    const baseOffset = transform === 'none' ? 0 : Math.max(0, new DOMMatrixReadOnly(transform).m42);
    clearTimer();
    drag.current = { pointerId: event.pointerId, target: event.currentTarget, startX: event.clientX, startY: event.clientY,
      baseOffset, offset: baseOffset, height: element.offsetHeight, locked: false, lastY: event.clientY, lastTime: event.timeStamp, velocity: 0 };
    element.style.setProperty('--sheet-drag-y', `${baseOffset}px`);
    element.style.setProperty('--sheet-drag-backdrop-opacity', String(Math.max(.25, 1 - baseOffset / Math.max(1, element.offsetHeight))));
    changePhase('dragging');
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { snapBack(); }
  };
  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId || phaseRef.current !== 'dragging') return;
    const dx = event.clientX - current.startX, dy = event.clientY - current.startY;
    if (!current.locked) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.2) { snapBack(); return; }
      if (Math.abs(dy) < 6) return;
      current.locked = true;
    }
    event.preventDefault();
    const elapsed = Math.max(1, event.timeStamp - current.lastTime);
    current.velocity = current.velocity * .35 + ((event.clientY - current.lastY) / elapsed) * .65;
    current.lastY = event.clientY; current.lastTime = event.timeStamp;
    current.offset = Math.min(current.height * 1.2, Math.max(0, current.baseOffset + dy));
    // Pointer movement only updates refs and CSS variables; React renders once per phase.
    dialog.current?.style.setProperty('--sheet-drag-y', `${current.offset}px`);
    dialog.current?.style.setProperty('--sheet-drag-backdrop-opacity', String(Math.max(.25, 1 - current.offset / Math.max(1, current.height))));
  };
  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (event.clientY !== current.lastY) moveDrag(event);
    if (drag.current !== current) return;
    const velocity = event.timeStamp - current.lastTime > 120 ? 0 : current.velocity;
    const threshold = Math.min(120, current.height * .25);
    if (current.locked && (current.offset >= threshold || (current.offset >= 40 && velocity >= .5))) close(velocity);
    else snapBack();
  };
  const cancelDrag = (event: ReactPointerEvent<HTMLElement>) => { if (drag.current?.pointerId === event.pointerId) snapBack(); };
  const dragHandlers = { onPointerDown: startDrag, onPointerMove: moveDrag, onPointerUp: endDrag, onPointerCancel: cancelDrag, onLostPointerCapture: cancelDrag };
  useEffect(() => () => { clearTimeout(timer.current); releaseCapture(); clearMotionStyles(); }, []);
  return <div className="card-filter-actions">
    <button ref={trigger} className={'icon-button card-filter-trigger' + (active ? ' is-filtered' : '')}
      aria-label={label} aria-haspopup="dialog" aria-expanded={phase !== 'closed'} aria-controls={id}
      onClick={show}><Icon name="filter"/></button>
    {active ? <button className="icon-button card-filter-clear" aria-label={label.startsWith('ホーム') ? 'ホームの絞り込みを解除' : 'カードの絞り込みを解除'}
      onClick={() => { onClear(); trigger.current?.focus({ preventScroll: true }); }}><Icon name="clear"/></button> : null}
    <dialog ref={dialog} id={id} className="card-filter-dialog" data-motion={phase} aria-labelledby={id + '-title'}
      onClose={() => { clearTimer(); releaseCapture(); clearMotionStyles(); changePhase('closed'); trigger.current?.focus({ preventScroll: true }); }}
      onCancel={event => { event.preventDefault(); close(); }}
      onAnimationEnd={event => {
        if (event.target !== event.currentTarget) return;
        if (event.animationName === 'filter-sheet-exit' && phaseRef.current === 'closing') finishClose();
        else if (event.animationName === 'filter-sheet-snap' && phaseRef.current === 'snapping') finishSnap();
        else if (event.animationName === 'filter-sheet-enter' && phaseRef.current === 'opening') {
          clearTimer(); changePhase('open');
        }
      }}
      onClick={event => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
      }}>
      <div className="filter-sheet-grab" aria-hidden="true" {...dragHandlers}><div className="filter-sheet-handle"/></div>
      <header className="filter-sheet-header" {...dragHandlers}>
        <button className="icon-button" aria-label="絞り込みを閉じる" autoFocus onClick={() => close()}><Icon name="clear"/></button>
        <h2 id={id + '-title'}>絞り込み</h2>
        <button className="filter-reset" disabled={resetDisabled || phase === 'closing'} onClick={onReset}>解除</button>
      </header>
      <div className="filter-sheet-body">{children}</div>
      <footer className="filter-sheet-footer"><button className="filter-apply" disabled={phase === 'closing'} onClick={() => {
        if (phaseRef.current === 'closing' || phaseRef.current === 'closed') return;
        onApply(); close();
      }}>適用</button></footer>
    </dialog>
  </div>;
}

import { cloneElement, useId, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';

type TriggerProps = { 'aria-describedby'?: string; title?: string };
type Props = { label: string; children: ReactElement<TriggerProps> };

export default function RailTooltip({ label, children }: Props) {
  const id = useId(), trigger = useRef<HTMLSpanElement>(null), tooltip = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false), [dismissed, setDismissed] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const open = !dismissed && (hovered || focused);
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      if (!trigger.current || !tooltip.current) return;
      const anchor = (trigger.current.firstElementChild ?? trigger.current).getBoundingClientRect(), box = tooltip.current.getBoundingClientRect();
      setPosition({
        left: Math.max(8, Math.min(anchor.right + 10, window.innerWidth - box.width - 8)),
        top: Math.max(8, Math.min(anchor.top + anchor.height / 2 - box.height / 2, window.innerHeight - box.height - 8)),
      });
    }
    place(); window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, label]);
  const description = [children.props['aria-describedby'], open ? id : null].filter(Boolean).join(' ') || undefined;
  return <span className="adm-rail-trigger" ref={trigger} onMouseEnter={() => { setHovered(true); setDismissed(false); }} onMouseLeave={() => { setHovered(false); if (!focused) setDismissed(false); }} onFocus={() => { setFocused(true); setDismissed(false); }} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) { setFocused(false); if (!hovered) setDismissed(false); }
  }} onKeyDown={event => { if (event.key === 'Escape' && open) { setDismissed(true); event.stopPropagation(); } }} onClick={() => setDismissed(true)}>
    {cloneElement(children, { 'aria-describedby': description, title: undefined })}
    {open && createPortal(<span ref={tooltip} className="adm-rail-tooltip" role="tooltip" id={id} style={{ top: position?.top ?? 0, left: position?.left ?? 0, visibility: position ? 'visible' : 'hidden' }}>{label}</span>, document.body)}
  </span>;
}

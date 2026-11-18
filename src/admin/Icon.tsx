export type IconName = 'pending' | 'history' | 'cards' | 'people' | 'games' | 'teams' | 'search' | 'plus' | 'close' | 'arrow' | 'chevron' | 'refresh' | 'image' | 'link' | 'check' | 'panel' | 'x' | 'blog' | 'filter' | 'backup';
const paths: Record<IconName, React.ReactNode> = {
  backup: <><path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5"/></>,
  pending: <><circle cx="12" cy="12" r="9"/><path d="M9 8v8M15 8v8"/></>,
  history: <><path d="M3 11a9 9 0 1 1 2 7M3 5v6h6"/><path d="M12 7v5l3 2"/></>,
  cards: <><rect x="5" y="3" width="14" height="18" rx="3"/><path d="m9 13 3-5 3 5-3 4-3-4Z"/></>,
  people: <><circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></>,
  teams: <><circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 4v2"/></>,
  games: <><rect x="3" y="4" width="7" height="7" rx="2"/><rect x="14" y="4" width="7" height="7" rx="2"/><rect x="3" y="15" width="7" height="7" rx="2"/><rect x="14" y="15" width="7" height="7" rx="2"/></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></>, plus: <path d="M12 5v14M5 12h14"/>, close: <path d="m6 6 12 12M6 18 18 6"/>,
  arrow: <path d="M6 18 18 6M7 6h11v11"/>, chevron: <path d="m9 5 7 7-7 7"/>, refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 8A7 7 0 0 1 18 6l2 3M4 15l2 3a7 7 0 0 0 12.4-2"/></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 3-3 6 6"/></>,
  link: <><path d="m10 14 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 0) scale(.9)"/></>,
  check: <path d="m5 12 4 4 10-10"/>, panel: <><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M15 4v16"/></>,
  x: <path d="m4 3 16 18h-5L4 3h5l11 18M20 3 4 21"/>, blog: <><path d="M8 3h8l4 4v14H4V3h4ZM16 3v5h4M8 12h8M8 16h6"/></>, filter: <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="currentColor"/><circle cx="15" cy="17" r="2" fill="currentColor"/></>,
};
export default function AdminIcon({ name, size = 20 }: { name: IconName; size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>; }

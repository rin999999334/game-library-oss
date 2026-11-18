import { memo, useCallback, useEffect, useLayoutEffect, useId, useRef, useState, type ReactNode } from 'react';
import { eventTag, safeExternalUrl, type Card, type ResultItem } from './model';
import type { LinkRow } from './database';
import gameIcons from '../public/game-icons.json';
import { externalLinkIcon } from './external-link';
import { loadGameArtwork } from './artwork';
import { blogFaviconKey, loadBlogFavicons, loadGameFavicons } from './blog-favicon';
import { loadCard } from './api';
import { imageSize, rememberCardPreview, rememberImageSize } from './card-preview';
import './external-links.css';

const gameIconSources:Record<string,{src:string}>=gameIcons;
export function GameIcon({eventId,name}:{eventId:string;name:string}) {
  const [sources,setSources]=useState<{artwork:Record<string,string>;favicons:Record<string,{src:string}>}>({artwork:{},favicons:{}});
  useEffect(()=>{let cancelled=false;void Promise.all([loadGameArtwork().catch(()=>({})),loadGameFavicons()]).then(([artwork,favicons])=>{if(!cancelled)setSources({artwork,favicons});});return()=>{cancelled=true;};},[]);
  const [failed,setFailed]=useState<string[]>([]);
  const src=[sources.artwork[eventId],sources.favicons[eventId]?.src,gameIconSources[eventId]?.src].find(value=>value&&!failed.includes(value));
  return src ? <img className="game-icon-art" src={src} alt="" aria-hidden="true" loading="lazy" decoding="async" onError={()=>setFailed(previous=>[...previous,src])}/> : eventTag(name);
}

export function Icon({name}:{name:string}) {
  const paths:Record<string,ReactNode>={
    home:<path d="m3 10 9-7 9 7v11h-7v-7h-4v7H3z"/>,folder:<path d="M3 5h6l2 3h10v13H3z"/>,
    search:<><circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/></>,blog:<path d="M7 4h10v16H7zM10 8h4m-4 4h4m-4 4h4"/>,
    board:<path d="M4 5h16v12H9l-5 4zM8 9h8m-8 4h5"/>,sort:<path d="m3 9 4-4 4 4M7 5v14M21 15l-4 4-4-4M17 19V5"/>,
    check:<path d="m5 12 5 5L20 7"/>,filter:<><path d="M3 6h5m4 0h9M3 12h11m4 0h3M3 18h3m4 0h11"/><circle cx="10" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/></>,tag:<><path d="M12 2H2v10l10 10 10-10L12 2Z"/><circle cx="7" cy="7" r="1.5"/></>,
    bell:<><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,back:<path d="M15 5l-7 7 7 7"/>,arrow:<path d="m9 5 7 7-7 7"/>,down:<path d="m6 9 6 6 6-6"/>,
    expand:<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>,external:<path d="M14 3h7v7M21 3l-9 9M10 3H3v18h18v-7"/>,clear:<path d="M18 6L6 18M6 6l12 12"/>,
  };
  return <svg className="icon" aria-hidden="true" viewBox="0 0 24 24">{paths[name] ?? paths.arrow}</svg>;
}
export function Status({loading,error,retry,empty,children}:{loading?:boolean;error?:string;retry?:()=>void;empty?:string;children?:ReactNode}) {
  if(error)return <div className="empty-state" role="alert"><p className="empty-title">読み込めませんでした</p><p className="empty-desc">接続を確認して、もう一度お試しください。</p><button className="pager-btn" onClick={retry}>再読み込み</button></div>;
  if(loading)return <div className="loading-state" role="status"><span className="loading-dot"/><span>読み込み中…</span></div>;
  if(empty)return <div className="empty-state"><p className="empty-title">{empty}</p></div>;
  return children;
}
export function SortMenu<T extends string>({labels,value,onChange}:{labels:Record<T,string>;value:T;onChange:(value:T)=>void}) {
  const [open,setOpen]=useState(false),id=useId(),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    if(!open)return;
    const close=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};
    const escape=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){setOpen(false);trigger.current?.focus();}
      if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)&&root.current?.contains(event.target as Node)){
        event.preventDefault();const buttons=[...root.current.querySelectorAll<HTMLButtonElement>('.popover-item')],index=buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next=event.key==='Home' ? 0 : event.key==='End' ? buttons.length-1 : (index+(event.key==='ArrowUp' ? -1 : 1)+buttons.length)%buttons.length;buttons[next]?.focus();
      }
    };
    const scroll=()=>setOpen(false);document.addEventListener('pointerdown',close);document.addEventListener('keydown',escape);document.querySelector('.scroll')?.addEventListener('scroll',scroll,{passive:true});
    return ()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',escape);document.querySelector('.scroll')?.removeEventListener('scroll',scroll);};
  },[open]);
  return <div ref={root} className="sort-wrap"><button ref={trigger} className="gui-sort-btn" aria-label={'並び替え：'+labels[value]} aria-expanded={open} aria-controls={id} onClick={()=>setOpen(!open)}><Icon name="sort"/><span>{labels[value]}</span><span className="icon-caret"><Icon name="down"/></span></button>{open ? <div id={id} className="gui-popover open" role="group" aria-label="並び替え"><span className="popover-header">並び替え</span>{Object.entries<string>(labels).map(([key,label])=><button className={'popover-item '+(value===key ? 'selected' : '')} key={key} aria-pressed={value===key} onClick={()=>{onChange(key as T);setOpen(false);trigger.current?.focus();}}><span>{label}</span>{value===key ? <Icon name="check"/> : null}</button>)}</div> : null}</div>;
}
export function CardImage({url,name,className='',eager=false,sizingKey=url,fallbackUrl=''}:{url:string;name:string;className?:string;eager?:boolean;sizingKey?:string;fallbackUrl?:string}) {
  const [failed,setFailed]=useState(false),[ready,setReady]=useState('');
  const [decoded,setDecoded]=useState('');
  // Retain the already decoded thumbnail until the larger image is ready.
  const displayedUrl=fallbackUrl&&fallbackUrl!==url&&decoded!==url ? fallbackUrl : url;
  const image=useRef<HTMLImageElement>(null);
  const size=imageSize(sizingKey);
  const loaded=()=>{const current=image.current;if(current?.naturalWidth){rememberImageSize(sizingKey,current.naturalWidth,current.naturalHeight);if(sizingKey!==displayedUrl)rememberImageSize(displayedUrl,current.naturalWidth,current.naturalHeight);setReady(displayedUrl);}};
  useLayoutEffect(()=>{if(image.current?.complete&&image.current.naturalWidth>0)loaded();},[displayedUrl,sizingKey]);
  useEffect(()=>setFailed(false),[displayedUrl]);
  useEffect(()=>{
    if(!fallbackUrl||fallbackUrl===url||!url)return;
    let active=true;const full=new Image();full.decoding='async';full.src=url;
    void full.decode().then(()=>{if(active)setDecoded(url);}).catch(()=>{});
    return()=>{active=false;};
  },[url,fallbackUrl]);
  return displayedUrl&&!failed ? <img ref={image} width={size?.width} height={size?.height} data-ready={ready===displayedUrl||decoded===displayedUrl} onLoad={loaded} className={'card-image '+className} src={displayedUrl} alt={name} loading={eager ? 'eager' : 'lazy'} decoding="async" onError={()=>setFailed(true)}/> : <span className={'image-missing '+className} aria-label={name+'：画像未登録'}>{name.slice(0,8)}</span>;
}
const GalleryTile=memo(function GalleryTile({card,onOpen}:{card:Card;onOpen:(card:Card)=>void}) {
  const prepare=()=>{rememberCardPreview(card);void loadCard(card.id).catch(()=>{});};
  return <button className="card-item" onPointerEnter={event=>{if(event.pointerType==='mouse')prepare();}} onFocus={prepare} onClick={()=>{rememberCardPreview(card);onOpen(card);}} aria-label={card.name+'の詳細'}><span className="card-art"><CardImage url={card.imageUrl} sizingKey={card.originalImageUrl||card.imageUrl} name={card.name}/></span></button>;
});
export function Gallery({cards,onOpen}:{cards:Card[];onOpen:(card:Card)=>void}) {
  const latest=useRef(onOpen);latest.current=onOpen;
  const open=useCallback((card:Card)=>latest.current(card),[]);
  return <div className="cards-grid">{cards.map(card=><GalleryTile key={card.id} card={card} onOpen={open}/>)}</div>;
}
export function ListRow({title,sub,onClick}:{title:string;sub?:string;onClick:()=>void}) {return <button className="list-row" onClick={onClick}><span>{title}{sub ? <small>{sub}</small> : null}</span><Icon name="arrow"/></button>;}
export function ResultRow({item,onClick}:{item:ResultItem;onClick:()=>void}) {return <button className="result-row" onClick={onClick}><span className={'thumb-'+item.kind} aria-hidden="true">{item.kind==='card' ? <CardImage url={item.image ?? ''} sizingKey={item.originalImageUrl||item.image||''} name={item.title}/> : item.kind==='game' ? eventTag(item.title) : item.title.slice(0,1)}</span><span className="result-info"><span className="result-title">{item.title}</span><span className="result-sub">{item.subtitle}</span></span><span className="icon-arrow"><Icon name="arrow"/></span></button>;}
function SiteLinkIcon({ url, icon }: { url: string; icon: 'blog' | 'board' }) {
  const [image, setImage] = useState({ key: '', src: '' }), [failed, setFailed] = useState('');
  const key = blogFaviconKey(url);
  const src = image.key === key ? image.src : '';
  useEffect(() => {
    let cancelled = false;
    void loadBlogFavicons().then(icons => { if (!cancelled) setImage({ key, src: icons[key]?.src ?? '' }); });
    return () => { cancelled = true; };
  }, [key]);
  return src && failed !== src
    ? <img className="shortcut-site-brand" src={src} alt="" aria-hidden="true" decoding="async" loading="lazy" onError={() => setFailed(src)}/>
    : icon === 'blog' ? <span className="shortcut-text-icon" aria-hidden="true">ブログ</span> : <Icon name="board"/>;
}
export function ExternalLinks({links}:{links:LinkRow[]}) {
  const visible=links.flatMap(link=>{const url=safeExternalUrl(link.url);return url ? [{...link,url,icon:externalLinkIcon(link.kind,link.label,url,Boolean(link.event_id))}] : [];});
  if(!visible.length)return null;
  return <nav className="shortcuts" aria-label="外部リンク">{visible.map(link=><a className="shortcut" key={link.id} href={link.url} target="_blank" rel="noopener noreferrer" aria-label={link.label+'を外部サイトで開く（新しいタブ）'}><span className={'shortcut-tile shortcut-tile--'+link.icon}>{link.icon==='x' ? <img className="shortcut-brand" src="/external-icons/x.png" alt="" aria-hidden="true" decoding="async"/> : link.icon==='blog' || link.icon==='board' ? <SiteLinkIcon url={link.url} icon={link.icon}/> : <Icon name={link.icon}/>}<span className="shortcut-external"><Icon name="external"/></span></span><span className="label">{link.label}</span></a>)}</nav>;
}

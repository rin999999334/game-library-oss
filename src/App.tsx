import { Analytics } from '@vercel/analytics/react';
import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { Home, Cards, Game, CardDetail, Person, Search, SearchResults, type CardView, type HomeSort } from './pages';
import { useSessionState } from './session';
import { useNavigation, tabRoots } from './navigation';
import { Icon, ListRow } from './ui';
import type { ResultItem } from './model';
import { peek } from './cache';
import type { EventRow } from './database';
import { configured, demoMode } from './supabase';
import { CardMenu } from './CardMenu';
import { HomeMenu } from './HomeMenu';
import { BottomTabs } from './BottomTabs';
import './app-motion.css';
import { Notifications } from './Notifications';

function loadRecent():ResultItem[] {
  try { const data:unknown=JSON.parse(localStorage.getItem('game-library:recent:v1') ?? '[]');return Array.isArray(data) ? data.filter((item):item is ResultItem=>item && typeof item.id==='string' && typeof item.title==='string' && ['game','card','person'].includes(item.kind)).slice(0,5) : []; } catch {return [];}
}
export default function App() {
  const nav=useNavigation(),[homeSort,setHomeSort]=useSessionState<HomeSort>('home-sort','year-desc'),[homeYear,setHomeYear]=useSessionState('home-year',''),[views,setViews]=useSessionState<Record<string,CardView>>('card-views',{}),[query,setQuery]=useSessionState('search-query',''),[pages,setPages]=useSessionState<Record<string,number>>('search-pages',{}),[recent,setRecent]=useState(loadRecent),[online,setOnline]=useState(navigator.onLine);
  const heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{const update=()=>setOnline(navigator.onLine);window.addEventListener('online',update);window.addEventListener('offline',update);return ()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};},[]);
  useEffect(()=>{try{localStorage.setItem('game-library:recent:v1',JSON.stringify(recent));}catch{/* Browsing works when storage is unavailable. */}},[recent]);
  useEffect(()=>{heading.current?.focus({preventScroll:true});},[nav.path]);
  const open=(item:ResultItem,sequence?:string[])=>{
    setRecent(current=>[item,...current.filter(value=>value.kind!==item.kind||value.id!==item.id)].slice(0,5));
    nav.go((item.kind==='game' ? 'game' : item.kind)+'/'+item.id,{sequence});
  };
  const [kind,id]=nav.path.split('/'),root=tabRoots.includes(nav.path as typeof tabRoots[number]);
  const cardsScreen=nav.path==='cards'||kind==='game-cards';
  const view=views[nav.path] ?? {sort:'game',page:0};
  const selectedGame=view.game ?? (kind==='game-cards' ? id : '') ?? '';
  const changeHome=(year:string,sort:HomeSort)=>{if(year===homeYear&&sort===homeSort)return;setHomeYear(year);setHomeSort(sort);document.querySelector('.scroll')?.scrollTo({top:0});};
  const changeCards=(game:string,sort:CardView['sort'])=>{if(game===selectedGame&&sort===view.sort)return;setView({game,sort,page:0});document.querySelector('.scroll')?.scrollTo({top:0});};
  const setView=(next:CardView|((current:CardView)=>CardView))=>setViews(current=>{const previous=current[nav.path] ?? {sort:'game' as const,page:0};return {...current,[nav.path]:typeof next==='function' ? next(previous) : next};});
  let title='',content:ReactNode;
  if(!configured){title='ゲームライブラリ';content=<div className="empty-state"><p className="empty-title">接続設定が必要です</p><p className="empty-desc">公開データの接続情報を設定してから再起動してください。</p></div>;}
  else if(nav.path==='notifications'){title='通知';content=<Notifications/>;}
  else if(nav.path==='home'){title='ホーム';content=<Home sort={homeSort} year={homeYear} open={open}/>;}
  else if(nav.path==='cards'||kind==='game-cards'){title=nav.path==='cards' ? 'カード' : 'ゲームのカード';content=<Cards eventId={id} view={view} setView={setView} open={open}/>;}
  else if(kind==='game'&&id){title=peek<EventRow[]>('events')?.find(event=>event.id===id)?.name ?? 'ゲーム詳細';content=<Game id={id} nav={nav} open={open}/>;}
  else if((kind==='card'||kind==='image')&&id){title=kind==='card' ? 'カード詳細' : 'カード画像';content=<CardDetail id={id} nav={nav} imageOnly={kind==='image'}/>;}
  else if(kind==='person'&&id){title='参加者詳細';content=<Person id={id} open={open}/>;}
  else if(nav.path==='search'){title='検索';content=<Search query={query} setQuery={value=>{setQuery(value);setPages({});}} nav={nav} open={open} recent={recent} clearRecent={()=>setRecent([])}/>;}
  else if(kind==='search-results'&&['game','card','person'].includes(id)){title=({game:'ゲーム',card:'カード',person:'参加者'}[id as ResultItem['kind']])+'の検索結果';content=<SearchResults kind={id as ResultItem['kind']} query={query.trim()} page={pages[id] ?? 0} setPage={page=>setPages(current=>({...current,[id]:page}))} open={open}/>;}
  else{title='ページが見つかりません';content=<ListRow title="ホームへ" onClick={()=>nav.go('home')}/>;}
  return <main className="phone app-shell"><section className={'screen '+(nav.path==='home' ? 'home-screen' : '')}><header className={'nav '+(nav.path==='home' ? 'home-header' : cardsScreen ? 'cards-header' : '')}><div className="nav-leading">{root ? null : <button className="icon-button" aria-label="戻る" onClick={nav.back}><Icon name="back"/></button>}</div><h1 key={nav.path} className="nav-title" data-navigation-motion={nav.motion} ref={heading} tabIndex={-1}>{title}</h1><div className="nav-actions">{cardsScreen ? <CardMenu key={nav.path} gameId={selectedGame} sort={view.sort} onChange={changeCards}/> : nav.path==='home' ? <><button className="icon-button" aria-label="通知設定" onClick={()=>nav.go('notifications')}><Icon name="bell"/></button><HomeMenu year={homeYear} sort={homeSort} onChange={changeHome}/></> : null}</div></header><div className="scroll"><div className={'content '+(kind==='card' ? 'card-detail-content' : '')}>{demoMode ? <p className="connection-banner" role="status">デモ：架空のデータを表示しています。変更は保存されません。</p> : null}{!online ? <p className="connection-banner" role="status">オフラインです。読み込み済みの画面を表示できます。</p> : null}<UpdateBanner/><PageBoundary key={nav.path}><div className="page-content" key={nav.path} data-navigation-motion={nav.motion} data-page-kind={kind}>{content}</div></PageBoundary></div></div></section><BottomTabs active={nav.nav.tab} onChange={nav.switchTab}/>{import.meta.env.PROD && !demoMode ? <Analytics mode="production" route={root ? '/'+nav.path : '/'+kind+'/[id]'} path={'/'+nav.path}/> : null}</main>;
}
function UpdateBanner() {
  const [waiting,setWaiting]=useState<ServiceWorker|null>(null);
  useEffect(()=>{
    if(!('serviceWorker' in navigator)||!import.meta.env.PROD)return;
    let active=true;
    navigator.serviceWorker.register('/sw.js').then(registration=>{
      if(active&&registration.waiting)setWaiting(registration.waiting);
      registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker?.addEventListener('statechange',()=>{if(active&&worker.state==='installed'&&navigator.serviceWorker.controller)setWaiting(worker);});});
    }).catch(()=>{/* The online app works without offline installation. */});
    return ()=>{active=false;};
  },[]);
  if(!waiting)return null;
  return <div className="connection-banner"><span>新しいバージョンがあります。</span><button className="search-text-btn" onClick={()=>{navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload(),{once:true});waiting.postMessage('ACTIVATE_UPDATE');}}>更新</button></div>;
}
class PageBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed ? <div className="empty-state" role="alert"><p className="empty-title">画面を表示できませんでした</p><button className="pager-btn" onClick={()=>location.reload()}>再読み込み</button></div> : this.props.children;}
}

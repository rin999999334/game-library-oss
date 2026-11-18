import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRouteMotion } from './route-motion';
import { readSession, writeSession } from './session';
export type Tab = 'home' | 'cards' | 'search';
export type NavigationMotion = 'none' | 'tab' | 'forward' | 'back';
export type NavState = { app: 'game-library'; tab: Tab; depth: number; sequence?: string[] };
export const tabRoots: Tab[] = ['home','cards','search'];
export function getPath() { return window.location.hash.slice(1) || 'home'; }
export function readNav(): NavState {
  const saved=history.state as NavState | null;
  if(saved?.app==='game-library' && tabRoots.includes(saved.tab)) return saved;
  const root=getPath(); return {app:'game-library',tab:tabRoots.includes(root as Tab) ? root as Tab : /^(card|image)\//.test(root) ? 'cards' : 'home',depth:0};
}
const positions=new Map<string,number>(readSession<[string,number][]>('positions',[]));
function rememberPosition(key:string,value:number){
  positions.delete(key);positions.set(key,value);while(positions.size>80)positions.delete(positions.keys().next().value!);
  writeSession('positions',[...positions]);
}
export function useNavigation() {
  const [route,setRoute]=useState(()=>({path:getPath(),nav:readNav(),motion:'none' as NavigationMotion}));
  const intended=useRef(route), rendered=useRef(route); rendered.current=route;
  const [motionRunner]=useState(()=>{
    document.documentElement.dataset.motionEngine=typeof document.startViewTransition === 'function' ? 'native' : 'css';
    return createRouteMotion({
    start: typeof document.startViewTransition === 'function' ? update=>document.startViewTransition(update) : undefined,
    reduced: ()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    setKind: kind=>{if(kind)document.documentElement.dataset.routeMotion=kind;else delete document.documentElement.dataset.routeMotion;},
  });});
  const commit=(next:typeof route)=>{
    intended.current=next;
    motionRunner.run(next.motion,()=>flushSync(()=>setRoute(next)));
  };
  const save=()=>{const current=rendered.current,el=document.querySelector('.scroll');rememberPosition(current.nav.tab+':'+current.path,el?.scrollTop ?? 0);};
  useEffect(()=>()=>motionRunner.dispose(),[motionRunner]);
  useEffect(()=>{
    history.replaceState(readNav(),'',location.href);
    const update=()=>{
      const path=getPath(),nav=readNav(),previous=intended.current;
      if(previous.path===path&&previous.nav.tab===nav.tab&&previous.nav.depth===nav.depth)return;
      save();
      const motion:NavigationMotion=previous.nav.tab!==nav.tab ? 'tab' : nav.depth<previous.nav.depth ? 'back' : 'forward';
      commit({path,nav,motion});
    };
    window.addEventListener('popstate',update);window.addEventListener('hashchange',update);
    return ()=>{window.removeEventListener('popstate',update);window.removeEventListener('hashchange',update);};
  },[]);
  useLayoutEffect(()=>{
    const scroll=document.querySelector<HTMLElement>('.scroll');
    const target=positions.get(route.nav.tab+':'+route.path) ?? 0;
    if(!scroll)return;
    scroll.scrollTop=0;
    let restored=false;
    const restore=()=>{if(!restored && scroll.scrollHeight-scroll.clientHeight>=target){scroll.scrollTop=target;restored=true;}};
    restore();
    const observer=new ResizeObserver(restore);const content=scroll.firstElementChild;if(content)observer.observe(content);
    const cancel=()=>{restored=true;};scroll.addEventListener('touchstart',cancel,{passive:true});scroll.addEventListener('wheel',cancel,{passive:true});
    let timer:ReturnType<typeof setTimeout>|undefined;
    const remember=()=>{if(!restored)return;clearTimeout(timer);timer=setTimeout(()=>rememberPosition(route.nav.tab+':'+route.path,scroll.scrollTop),120);};
    const persist=()=>{if(restored)rememberPosition(route.nav.tab+':'+route.path,scroll.scrollTop);};
    scroll.addEventListener('scroll',remember,{passive:true});window.addEventListener('pagehide',persist);window.addEventListener('beforeunload',persist);
    return ()=>{clearTimeout(timer);observer.disconnect();scroll.removeEventListener('touchstart',cancel);scroll.removeEventListener('wheel',cancel);scroll.removeEventListener('scroll',remember);window.removeEventListener('pagehide',persist);window.removeEventListener('beforeunload',persist);};
  },[route.path,route.nav.tab]);
  const go=(path:string,options:{tab?:Tab;replace?:boolean;sequence?:string[];motion?:NavigationMotion}={})=>{
    save();const previous=intended.current,nav:NavState={app:'game-library',tab:options.tab ?? previous.nav.tab,depth:options.replace ? previous.nav.depth : previous.nav.depth+1,sequence:options.sequence ?? previous.nav.sequence};
    history[options.replace ? 'replaceState' : 'pushState'](nav,'','#'+path);commit({path,nav,motion:options.motion ?? (nav.tab!==previous.nav.tab ? 'tab' : 'forward')});
  };
  const back=()=>{save();if(intended.current.nav.depth>0)history.back();else go(intended.current.nav.tab,{replace:true,motion:'back'});};
  return {...route,go,back,switchTab:(tab:Tab)=>{if(intended.current.nav.tab!==tab||intended.current.path!==tab)go(tab,{tab,motion:'tab'});}};
}
export type Navigation = ReturnType<typeof useNavigation>;

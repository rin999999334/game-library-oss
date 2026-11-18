import { useEffect, useRef, useState } from 'react';
import { cached, forget, peek } from './cache';
export function useResource<T>(key: string, fetcher: () => Promise<T>) {
  const request = useRef(fetcher); request.current = fetcher;
  const [attempt,setAttempt]=useState(0);
  const [state,setState]=useState<{key:string;data?:T;error?:string;loading:boolean}>(()=>({key,data:peek<T>(key),loading:peek<T>(key)===undefined}));
  useEffect(()=>{
    let active=true;
    const hit=peek<T>(key);
    setState(previous=>previous.key===key&&previous.data===hit&&previous.loading===(hit===undefined)&&!previous.error ? previous : {key,data:hit,loading:hit===undefined});
    cached(key,()=>request.current()).then(data=>{if(active)setState({key,data,loading:false});}).catch(error=>{if(active)setState({key,error:error instanceof Error ? error.message : '読み込みに失敗しました。',loading:false});});
    return ()=>{active=false;};
  },[key,attempt]);
  const current=state.key===key ? state : {key,data:peek<T>(key),loading:peek<T>(key)===undefined};
  return {...current,retry:()=>{forget(key);setAttempt(value=>value+1);}};
}
export function useDebounced(value: string, delay = 240) {
  const [settled,setSettled]=useState(value);
  useEffect(()=>{const timer=setTimeout(()=>setSettled(value),delay);return ()=>clearTimeout(timer);},[value,delay]);
  return settled;
}

export function useAutoPage(enabled: boolean, loaded: number, loadMore: () => void) {
  const sentinel=useRef<HTMLDivElement>(null),request=useRef(loadMore);request.current=loadMore;
  useEffect(()=>{
    if(!enabled||!sentinel.current||!('IntersectionObserver' in window))return;
    let requested=false,active=true;
    const observer=new IntersectionObserver(entries=>{
      if(active&&!requested&&entries.some(entry=>entry.isIntersecting)){requested=true;request.current();}
    },{root:document.querySelector('.scroll'),rootMargin:'480px 0px',threshold:0});
    observer.observe(sentinel.current);return ()=>{active=false;observer.disconnect();};
  },[enabled,loaded]);
  return sentinel;
}

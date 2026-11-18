import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
const prefix='game-library:session:v1:';
export function readSession<T>(key:string,fallback:T,validate?:(value:unknown)=>value is T):T {
  try {const raw=sessionStorage.getItem(prefix+key);if(!raw)return fallback;const value:unknown=JSON.parse(raw);return !validate||validate(value) ? value as T : fallback;}catch{return fallback;}
}
export function writeSession(key:string,value:unknown) {try{sessionStorage.setItem(prefix+key,JSON.stringify(value));}catch{/* Session persistence is optional. */}}
export function useSessionState<T>(key:string,fallback:T,validate?:(value:unknown)=>value is T):[T,Dispatch<SetStateAction<T>>] {
  const [value,setValue]=useState<T>(()=>readSession(key,fallback,validate));
  useEffect(()=>writeSession(key,value),[key,value]);return [value,setValue];
}

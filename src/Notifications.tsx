import { demoMode } from './supabase';
import { useEffect, useState } from 'react';
import './notifications.css';
const supported=()=>typeof Notification!=='undefined'&&'serviceWorker' in navigator&&'PushManager' in window;
const installNeeded=()=>/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
function applicationKey(value:string){return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));}
async function requestConfig(){const response=await fetch('/api/push',{signal:AbortSignal.timeout(15000)});const data=await response.json();if(!response.ok)throw Error(data.error||'通知を準備できませんでした。');return data.publicKey as string;}
export function Notifications(){
  const [key,setKey]=useState(''),[subscription,setSubscription]=useState<PushSubscription|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  const [permission,setPermission]=useState(()=>supported()?Notification.permission:'default');
  const standalone=window.matchMedia('(display-mode: standalone)').matches||(navigator as Navigator & {standalone?:boolean}).standalone;
  const needsInstall=installNeeded()&&!standalone;
  const load=()=>{setError('');requestConfig().then(setKey).catch(()=>setError('通知を準備できませんでした。接続を確認して再試行してください。'));};
  useEffect(()=>{
    if(demoMode||!supported()||needsInstall)return;
    load();navigator.serviceWorker.ready.then(registration=>registration.pushManager.getSubscription()).then(setSubscription).catch(()=>{});
  },[]);
  const enable=async()=>{
    setBusy(true);setError('');setMessage('');
    try {
      // Request permission directly from the tap, before any network await (iOS).
      const granted=await Notification.requestPermission();setPermission(granted);
      if(granted!=='granted'){setMessage(granted==='denied'?'通知が許可されていません。端末の設定から許可してください。':'通知の許可をキャンセルしました。');return;}
      const registration=await navigator.serviceWorker.ready;
      await registration.update();
      const next=registration.installing??registration.waiting;
      if(next&&next.state!=='activated')await new Promise<void>((resolve,reject)=>{
        const timer=setTimeout(()=>{next.removeEventListener('statechange',check);reject(Error('アプリの更新に時間がかかっています。再度お試しください。'));},15000);
        const check=()=>{
          if(next.state==='installed')next.postMessage('ACTIVATE_UPDATE');
          if(next.state==='activated'||next.state==='redundant'){clearTimeout(timer);next.removeEventListener('statechange',check);next.state==='activated'?resolve():reject(Error('アプリを更新してからお試しください。'));}
        };next.addEventListener('statechange',check);check();
      });
      if(!registration.active?.scriptURL.endsWith('/sw.js'))throw Error('アプリを更新してからお試しください。');
      const sub=await registration.pushManager.getSubscription()??await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:applicationKey(key)});
      setSubscription(sub);setMessage('この端末の通知をオンにしました。');
    }catch(e){setError(e instanceof Error?e.message:'通知を有効にできませんでした。');}finally{setBusy(false);}
  };
  const disable=async()=>{if(!subscription)return;setBusy(true);setError('');try{if(!await subscription.unsubscribe())throw Error('停止できませんでした。もう一度お試しください。');setSubscription(null);setMessage('この端末の通知を停止しました。');}catch(e){setError(e instanceof Error?e.message:'停止できませんでした。');}finally{setBusy(false);}};
  if(demoMode)return <section className="notification-settings"><p>デモではプッシュ通知を利用しません。</p></section>;
  return <section className="notification-settings">
    {needsInstall?<p>Safariの共有メニューから「ホーム画面に追加」し、追加した「かくれんぼ」を開いてください。そこで通知を有効にできます。</p>:!supported()?<p>このブラウザはプッシュ通知に対応していません。対応するブラウザ、またはホーム画面に追加したアプリで開いてください。</p>:<>
      {permission==='denied'?<p>通知がブロックされています。端末またはブラウザの設定で「かくれんぼ」の通知を許可し、この画面を開き直してください。</p>:<button className="notification-toggle" role="switch" aria-checked={Boolean(subscription)} aria-label="プッシュ通知" disabled={busy||!key} onClick={subscription?disable:enable}><span>プッシュ通知</span><span className="notification-toggle-track" aria-hidden="true"><span/></span></button>}
      {!key&&error?<button className="search-text-btn" onClick={load}>再試行</button>:null}
    </>}
    {message?<p role="status">{message}</p>:null}{error?<p className="notification-error" role="alert">{error}</p>:null}
  </section>;
}

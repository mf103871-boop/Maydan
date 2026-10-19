import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {accountStore} from '../shared/account/store.js';
import {request} from '../shared/account/api.js';
import {PlatformApp} from '../platform/PlatformApp.jsx';
function OwnerGamePreview(){
  const [status,setStatus]=useState('loading');
  useEffect(()=>{let live=true;const token=accountStore.readSession();
    if(!token){setStatus('login');return undefined;}
    request('/api/design/me',{token,onSession:next=>{if(live && accountStore.readSession()===token)accountStore.writeSession(next);}})
      .then(value=>{if(live)setStatus(value.allowed?'allowed':'denied');})
      .catch(()=>{if(live)setStatus('login');});
    return()=>{live=false;};
  },[]);
  if(status==='allowed')return <PlatformApp/>;
  return <main dir="rtl" style={{maxWidth:540,margin:'15vh auto',padding:24,fontFamily:'system-ui',lineHeight:1.9}}><h1>تجربة تصميم ميدان</h1><p>{status==='loading'?'جارٍ التحقق من حساب الاستوديو…':status==='denied'?'هذه الصفحة خاصة بحساب مالك الاستوديو.':'سجّل دخولك إلى ميدان بحساب الاستوديو، ثم افتح رابط التجربة مجددًا.'}</p>{status!=='loading' && <><a href="/#/settings">تسجيل الدخول إلى ميدان</a><p><a href="/api/studio/">العودة للاستوديو</a></p></>}</main>;
}
createRoot(document.getElementById('root')).render(<OwnerGamePreview/>);

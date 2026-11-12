import React, { useEffect, useRef, useState } from 'react';
import { NULL_ACCOUNT, useAccount } from '../account/context.js';
import { request, resolveAccountServer } from '../account/api.js';
import { useI18n } from '../i18n/react.jsx';
import { navigate } from '../../platform/router.js';
import { usePlatform } from '../../platform/context.js';
import { TermsConsent } from './TermsConsent.jsx';
import { TERMS_VERSION, isCurrentTermsAcceptance } from './terms.js';
import { readLocalTermsAcceptance, saveLocalTermsAcceptance, getGuestTermsReceipt, saveGuestTermsReceipt, localTermsAcceptPayload } from './acceptance.js';

// Management and safety remain reachable without accepting service terms.
const MANAGEMENT = new Set(['terms','privacy','settings','about','auth','moderation','friends','friend-group','profile']);
export function TermsBoundary({ route, children }) {
  const account = useAccount();
  const {ready,signedIn,requestAuthenticated}=account;
  const isolated=account===NULL_ACCOUNT;
  const { locale } = useI18n();
  const platform=usePlatform();
  const owner = account.signedIn ? account.user?.id || 'auth-pending' : 'guest';
  const ownerRef = useRef(owner); ownerRef.current = owner;
  const requestId = useRef(0);
  const [local, setLocal] = useState(readLocalTermsAcceptance);
  const [state, setState] = useState({owner:null,loading:false,accepted:false,error:null});
  const [attempt, setAttempt] = useState(0);
  const base = resolveAccountServer();
  const online = ['online','room'].includes(route.name) || route.name === 'play' && ['ersomha','mafia'].includes(route.params?.id);
  const management = MANAGEMENT.has(route.name);
  const cached = account.me?.legal;
  const verifiedCached = cached?.required === false && isCurrentTermsAcceptance(cached?.acceptance);
  useEffect(() => {
    const current = ++requestId.current;
    if (isolated || !ready || owner === 'auth-pending') return undefined;
    let disposed = false;
    const owns = () => !disposed && current === requestId.current && ownerRef.current === owner;
    if (!signedIn) {
      if (!online || !local || getGuestTermsReceipt(base)) {
        setState({owner,loading:false,accepted:!!local,error:null}); return undefined;
      }
      setState({owner,loading:true,accepted:false,error:null});
      request('/api/legal/accept',{method:'POST',body:localTermsAcceptPayload(local),server:base})
        .then(result => { if(owns()) { saveGuestTermsReceipt(base,result); setState({owner,loading:false,accepted:!!getGuestTermsReceipt(base),error:null}); } })
        .catch(error => { if(owns()) setState({owner,loading:false,accepted:false,error:error.code||'network'}); });
      return () => { disposed=true; };
    }
    if (verifiedCached) { setState({owner,loading:false,accepted:true,error:null}); return undefined; }
    setState({owner,loading:true,accepted:false,error:null});
    requestAuthenticated('/api/legal/status')
      .then(result => { if(owns()) setState({owner,loading:false,accepted:result?.required===false && isCurrentTermsAcceptance(result?.acceptance),error:null}); })
      .catch(() => { if(owns()) setState({owner,loading:false,accepted:false,error:'network'}); });
    return () => { disposed=true; };
  },[ready,signedIn,requestAuthenticated,owner,verifiedCached,online,local,base,attempt,isolated]);
  const accept = async payload => {
    if (payload.termsVersion !== TERMS_VERSION || !isCurrentTermsAcceptance(payload) || payload.accepted !== true) return;
    const claimedOwner = owner;
    const current = ++requestId.current;
    setState({owner,loading:true,accepted:false,error:null});
    try {
      if (account.signedIn) {
        const result = await account.requestAuthenticated('/api/legal/accept',{method:'POST',body:payload});
        if (ownerRef.current!==claimedOwner || requestId.current!==current) return;
        if (result?.required !== false || !isCurrentTermsAcceptance(result?.acceptance)) throw new Error('Acceptance was not confirmed');
        setState({owner,loading:false,accepted:true,error:null});
        account.refresh().catch(() => {});
      } else {
        // A deliberate device choice allows offline local play; online admission
        // additionally needs the audience-bound server receipt.
        const persisted = saveLocalTermsAcceptance(payload);
        const saved = persisted || {...payload,acceptedAtClient:Date.now()};
        if (online) {
          const result = await request('/api/legal/accept',{method:'POST',body:payload,server:base});
          if (ownerRef.current!==claimedOwner || requestId.current!==current) return;
          saveGuestTermsReceipt(base,result);
          if (!getGuestTermsReceipt(base)) throw new Error('Guest receipt missing');
        }
        setLocal(saved);
        if (!persisted) platform?.toast?.(locale==='en'?'Your choice is saved for this session only because device storage is unavailable.':'الموافقة محفوظة لهذه الجلسة فقط لأن تخزين الجهاز غير متاح.');
        setState({owner,loading:false,accepted:true,error:null});
      }
    } catch (error) {
      if (ownerRef.current===claimedOwner && requestId.current===current) setState({owner,loading:false,accepted:false,error:error.code||'network'});
    }
  };
  if (account===NULL_ACCOUNT || management) return children;
  if (state.owner===owner && state.accepted && (!online || account.signedIn || getGuestTermsReceipt(base))) return children;
  const en=locale==='en';
  return <><TermsConsent key={owner} locale={locale} pending={!account.ready || state.loading || owner==='auth-pending'}
    error={state.error ? state.error==='TERMS_VERSION_CHANGED' ? en ? 'The terms have changed. Update Maydan and review the current version before playing.' : 'تغيّرت الشروط. حدّث ميدان واقرأ النسخة الحالية قبل اللعب.' : en ? 'Could not confirm acceptance. Check your connection and try again.' : 'تعذّر تأكيد الموافقة. تحقق من الاتصال وأعد المحاولة.' : null}
    onAccept={accept} onBack={() => navigate('/settings')} onReadTerms={() => navigate('/terms')} onReadPrivacy={() => navigate('/privacy')} />
    {state.error && <div style={{padding:20,textAlign:'center'}}><button className="btn" type="button" onClick={() => setAttempt(n=>n+1)}>{en?'Retry connection':'إعادة الاتصال'}</button></div>}</>;
}

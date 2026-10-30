import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccount } from '../shared/account/context.js';
import { resolveAccountServer } from '../shared/account/api.js';

// A response belongs to both the account and the server that requested it.
// Never let an old account's in-flight response repopulate the new account.
export function usePlusResource(path, enabled = true) {
  const account = useAccount();
  const owner = account.signedIn && account.user?.id ? `${resolveAccountServer()}:${account.user.id}` : null;
  const current = useRef({ owner, account }); current.current = { owner, account };
  const generation = useRef(0);
  const alive = useRef(true);
  const loadVersion = useRef(0);
  const [state, setState] = useState({ owner: null, data: null, loading: false, error: null });
  const request = useCallback(async (requestPath, options) => {
    const expectedOwner = current.current.owner;
    const expectedGeneration = generation.current;
    if (!expectedOwner) throw Object.assign(new Error('AUTH_REQUIRED'), { code: 'AUTH_REQUIRED' });
    const result = await current.current.account.requestAuthenticated(requestPath, options);
    if (!alive.current || current.current.owner !== expectedOwner || generation.current !== expectedGeneration) {
      throw Object.assign(new Error('STALE_ACCOUNT'), { code: 'STALE_ACCOUNT' });
    }
    return result;
  }, []);
  const reload = useCallback(async () => {
    const expectedOwner = current.current.owner;
    if (!expectedOwner) return null;
    const version = ++loadVersion.current;
    setState(value => ({ ...value, owner: expectedOwner, loading: true, error: null }));
    try {
      const data = await request(path);
      if (version !== loadVersion.current) return null;
      setState({ owner: expectedOwner, data, loading: false, error: null });
      return data;
    } catch (error) {
      if (alive.current && version === loadVersion.current && current.current.owner === expectedOwner && error.code !== 'STALE_ACCOUNT') {
        setState(value => ({ ...value, owner: expectedOwner, loading: false, error }));
      }
      return null;
    }
  }, [path, request]);
  useEffect(() => {
    alive.current = true; generation.current++;
    setState({ owner, data: null, loading: Boolean(owner && enabled), error: null });
    if (owner && enabled) reload();
    return () => { alive.current = false; };
  }, [owner, enabled, reload, account.premium]);
  const safe = state.owner === owner ? state : { data: null, loading: Boolean(owner && enabled), error: null };
  return { ...safe, owner, account, request, reload };
}

export function plusError(error) {
  if (error?.code === 'MAFIA_SOCIAL_LOCKED') return 'يمكنك تغيير مظهرك بعد انتهاء مباراة مافيا.';
  if (error?.code === 'CONFLICT') return 'تغيّرت الإعدادات على جهاز آخر. أعد التحميل ثم حاول مجددًا.';
  if (error?.code === 'PLUS_REQUIRED') return 'هذه اللمسة تحتاج ميدان بلس. كل الألعاب مجانية.';
  if (error?.code === 'LIMIT' || error?.code === 'PRESET_LIMIT') return 'وصلت إلى عشر جلسات. احذف جلسة قديمة لإضافة غيرها.';
  if (error?.code === 'AUTH_REQUIRED' || error?.code === 'AUTH_EXPIRED') return 'سجّل الدخول إلى حسابك أولًا.';
  if (error?.code === 'STALE_ACCOUNT') return '';
  return 'تعذّر حفظ التعديل. تحقق من الاتصال وحاول مجددًا.';
}

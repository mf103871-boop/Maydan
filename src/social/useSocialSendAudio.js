import {useLayoutEffect,useRef} from 'react';
import {usePlatform} from '../platform/context.js';
import {createSocialSendAudio} from './audio-feedback.js';

export function useSocialSendAudio(owner,scope,id) {
  const platform=usePlatform(),ref=useRef(null);
  if(!ref.current)ref.current=createSocialSendAudio();
  const feedback=ref.current;feedback.bind(owner,scope,id,platform?.sound);
  useLayoutEffect(()=>{feedback.mount();return()=>feedback.dispose();},[feedback]);
  return feedback;
}

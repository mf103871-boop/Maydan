import { useEffect, useRef } from 'react';
import { useLamma } from './LammaProvider.jsx';
import { socialInterruption } from './interruption.js';
import { mafiaCommunicationLocked, emptyMafiaVoice } from './mafia-voice-session.js';

// This bridge follows the room, while LammaProvider keeps the call alive across
// React renders and hands all channel selection to the authoritative server.
export function useMafiaRoomVoice(state) {
  const lamma = useLamma(), current = useRef(lamma); current.current = lamma;
  const locked = mafiaCommunicationLocked(state);
  useEffect(() => { current.current?.configureMafiaRoom(state); }, [state]);
  useEffect(() => {
    if (!locked) return;
    return socialInterruption.lockCommunication('mafia-match');
  }, [locked]);
  useEffect(() => () => { current.current?.configureMafiaRoom(null); }, []);
  return { ...(lamma?.mafiaVoice || emptyMafiaVoice()),
    audioOutputs: lamma?.media?.audioOutputs || [], outputId: lamma?.media?.outputId || 'default',
    onJoin: () => current.current?.joinMafiaVoice(), onLeave: () => current.current?.leaveMafiaVoice(),
    onMute: muted => current.current?.muteMafiaVoice(muted), onSpeaker: id => current.current?.setAudioOutput(id),
    onResume: () => current.current?.resumeCallAudio(), onReturnToCall: () => current.current?.returnFromMafiaVoice() };
}

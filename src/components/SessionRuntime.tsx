import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { createSessionAudio } from '../audio/createSessionAudio';
import { useSessionStore } from '../store/sessionStore';

const audio = createSessionAudio();

function Awake() {
  useKeepAwake('borrowed-eyes-session', { suppressDeactivateWarnings: true });
  return null;
}

/** Exactly one lifecycle owner, independent of route re-renders or transitions. */
export function SessionRuntime() {
  const status = useSessionStore((state) => state.status);
  useEffect(() => useSessionStore.getState().attachAudio(audio), []);
  useEffect(() => {
    const change = AppState.addEventListener('change', (next) => {
      if (next !== 'active') useSessionStore.getState().pauseSession();
    });
    const blur = Platform.OS === 'android'
      ? AppState.addEventListener('blur', () => useSessionStore.getState().pauseSession()) : null;
    return () => { change.remove(); blur?.remove(); };
  }, []);
  useEffect(() => {
    if (status !== 'running') return;
    if (AppState.currentState && AppState.currentState !== 'active') {
      useSessionStore.getState().pauseSession();
      return;
    }
    const timer = setInterval(() => {
      useSessionStore.getState().updateTimer();
      useSessionStore.getState().requestClosing();
    }, 250);
    return () => clearInterval(timer);
  }, [status]);
  return status === 'running' ? <Awake /> : null;
}

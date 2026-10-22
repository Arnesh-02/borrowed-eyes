const { AudioController } = require('../src/audio/AudioController.ts');
const { deferred } = require('./fixtures.cjs');

exports.createAudioRig = () => {
  const events = [];
  let utterance = null;
  let musicSnapshot = { playing: false, error: null };
  let hasTrack = false;
  const listeners = new Set();
  const publish = (playing) => {
    musicSnapshot = { playing, error: null };
    listeners.forEach((listener) => listener(musicSnapshot));
  };
  const speech = {
    speak: (text, options) => {
      events.push(['speech', text]);
      utterance = deferred();
      options?.onStart?.();
      return utterance.promise;
    },
    stop: async () => { events.push(['stopSpeech']); utterance?.resolve(); },
    setVolume: () => {},
  };
  const music = {
    load: async (track) => { hasTrack = !!track; publish(false); },
    play: async () => { events.push(['musicPlay']); publish(hasTrack); },
    pause: async () => { events.push(['musicPause']); publish(false); },
    stop: async () => { events.push(['musicRelease']); hasTrack = false; publish(false); },
    setVolume: (volume) => { events.push(['musicVolume', volume]); },
    getSnapshot: () => musicSnapshot,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  };
  return { audio: new AudioController(speech, music), speech, music, events, finish: () => utterance?.resolve() };
};

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { PrimaryButton } from '../components/PrimaryButton';
import { Screen } from '../components/Screen';
import { SessionTimer } from '../components/SessionTimer';
import { formatDuration } from '../engine/ExperienceEngine';
import { detectiveMissions } from '../data/missions';
import { useSessionStore } from '../store/sessionStore';
import { colors, radii, spacing, styles } from '../theme/theme';

export function ActiveSessionScreen() {
  const state = useSessionStore();
  const [responding, setResponding] = useState(false);
  const [draft, setDraft] = useState('');
  const confirming = useRef(false);
  const mission = detectiveMissions.find((item) => item.id === state.currentMissionId);
  const paused = state.status === 'paused';
  const progress = state.completedMissionIds.length + state.skippedMissionIds.length;
  const quiet = state.quietUntilElapsed !== null;
  const speaking = state.audio.state === 'ai_speaking';
  const preparingSpeech = state.audio.state === 'processing' && !state.plannerPending;
  const voiceActive = state.voice.state !== 'idle' && state.voice.state !== 'error' && state.voice.state !== 'cancelled';
  const voiceLabel = state.voice.state === 'requesting_permission' ? 'Requesting microphone permission'
    : state.voice.state === 'listening' ? 'Listening — tap to finish'
      : state.voice.state === 'transcribing' ? 'Transcribing locally'
        : state.voice.state === 'thinking' ? 'Thinking about your words'
          : state.voice.state === 'speaking' ? 'Speaking'
            : state.voice.state === 'paused' ? 'Voice paused'
              : state.voice.state === 'error' ? 'Voice unavailable' : null;
  const statusLabel = paused ? 'Paused — resume when you are ready'
    : voiceLabel ?? (state.plannerPending ? 'Thinking'
      : speaking ? 'Speaking'
        : preparingSpeech ? 'Preparing speech'
          : quiet ? `Quiet observation · ${formatDuration(Math.max(0, (state.quietUntilElapsed ?? 0) - state.elapsedSeconds))}`
            : state.audio.error ? 'Speech unavailable — text is still here'
              : 'Your world has the floor');

  const confirmEnd = useCallback(() => {
    if (confirming.current) return;
    const current = useSessionStore.getState();
    if (current.status !== 'running' && current.status !== 'paused') return;
    confirming.current = true;
    current.pauseSession();
    Alert.alert('End investigation?', 'The case is paused. Your completed and skipped missions will appear in the summary.', [
      { text: 'Return to case', style: 'cancel', onPress: () => { confirming.current = false; } },
      { text: 'End adventure', style: 'destructive', onPress: () => { confirming.current = false; useSessionStore.getState().endSession(); } },
    ], { cancelable: true, onDismiss: () => { confirming.current = false; } });
  }, []);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { confirmEnd(); return true; });
    return () => subscription.remove();
  }, [confirmEnd]);

  if (!mission || state.status === 'completed') return null;
  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Screen>
        <View style={screen.top}>
          <Text style={styles.eyebrow}>{state.selectedCharacter?.name.toUpperCase()}</Text>
          <SessionTimer seconds={state.remainingSeconds} paused={paused} />
        </View>
        <View style={screen.progressTrack}>
          <View style={[screen.progressFill, { width: `${progress / detectiveMissions.length * 100}%` }]} />
        </View>
        <Text style={screen.progressText}>{progress + 1} of {detectiveMissions.length}</Text>
        <View style={screen.mission}>
          <Text style={screen.type}>CASE {String(progress + 1).padStart(2, '0')} — {mission.type.toUpperCase()}</Text>
          <Text style={screen.instruction}>{mission.instruction}</Text>
          <Text style={screen.caption}>Suggested time {formatDuration(mission.durationSeconds)} · no rush</Text>
          <Text accessibilityLiveRegion="polite" style={screen.status}>{statusLabel}</Text>
          {state.responseText ? <Text style={screen.voice}>{state.responseText}</Text> : null}
          {state.lastCompletionMessage ? <Text style={screen.caption}>{state.lastCompletionMessage}</Text> : null}
          {state.responseSource === 'fallback' && <Text style={screen.caption}>Local companion response{state.aiEnabled ? ' · Gemma unavailable or response not accepted' : ' · Gemma is off'}</Text>}
          {state.plannerNotice ? <Text style={screen.caption}>The local case continues. You can try your next reply later.</Text> : null}
          {state.audio.error ? <Text style={screen.caption}>{state.audio.error}</Text> : null}
          {state.voice.transcript ? <Text style={screen.caption}>You said: “{state.voice.transcript}”</Text> : null}
          {state.voice.error ? <Text style={screen.caption}>{state.voice.error}</Text> : null}
        </View>
        <View style={screen.actions}>
          <PrimaryButton label={paused ? 'Resume Investigation' : 'Complete Mission'} onPress={() => paused ? state.resumeSession() : state.completeMission(mission.id)} />
          {!paused && <PrimaryButton secondary label="Pause investigation" onPress={state.pauseSession} />}
          <PrimaryButton secondary label="Skip this mission" disabled={paused} onPress={() => state.skipMission(mission.id)} />
          <PrimaryButton
            label={state.voice.state === 'listening' ? 'Finish speaking' : state.voice.state === 'transcribing' || state.voice.state === 'thinking' ? 'Cancel voice interaction' : state.voice.state === 'speaking' ? 'Stop Detective' : state.voice.state === 'error' ? 'Retry voice input' : 'Talk to Detective'}
            secondary={state.voice.state !== 'idle' && state.voice.state !== 'error'}
            disabled={paused || state.voice.state === 'requesting_permission'}
            onPress={() => {
              if (state.voice.state === 'listening') state.stopVoiceInteraction();
              else if (state.voice.state === 'transcribing' || state.voice.state === 'thinking') state.cancelVoiceInteraction();
              else if (state.voice.state === 'speaking') state.stopSpeech();
              else state.startVoiceInteraction();
            }}
          />
          {state.voiceModelName === null && <PrimaryButton secondary label="Choose local Whisper model" disabled={paused || voiceActive} onPress={() => { void state.chooseVoiceModel(); }} />}
          {state.plannerPending
            ? <PrimaryButton secondary label="Cancel reply" onPress={state.cancelInteraction} />
            : (speaking || preparingSpeech)
              ? <PrimaryButton secondary label="Stop speech" onPress={state.stopSpeech} />
              : <PrimaryButton secondary label="Replay Detective" disabled={paused || !state.speechEnabled} onPress={state.replayInstruction} />}
          {!responding && <PrimaryButton secondary label="Respond · development text" disabled={paused} onPress={() => { state.cancelInteraction(); setResponding(true); }} />}
          {responding && <View style={screen.inputPanel}>
            <Text style={screen.caption}>Development text input — speech recognition is not installed. Stop somewhere safe before typing.</Text>
            <TextInput
              accessibilityLabel="Your observation, development text input"
              placeholder="What caught your attention?"
              placeholderTextColor={colors.muted}
              style={screen.input}
              value={draft}
              onChangeText={setDraft}
              maxLength={400}
              multiline
              editable={!paused && !state.plannerPending}
            />
            <Text style={screen.caption}>{state.aiEnabled ? 'Sent as text to your configured developer machine with recent session context.' : 'Gemma is off. Your text stays in this session in app memory.'}</Text>
            <PrimaryButton label="Send observation" disabled={paused || state.plannerPending || !draft.trim()} onPress={() => {
              const text = draft.trim();
              setDraft(''); setResponding(false);
              void state.submitResponse(text);
            }} />
            <PrimaryButton secondary label="Cancel text input" onPress={() => { setDraft(''); setResponding(false); }} />
          </View>}
          <PrimaryButton secondary label="End adventure" onPress={confirmEnd} />
          <Text style={screen.prototypeNote}>Local Whisper voice requires a native development build and a selected model. Locking or leaving the app pauses the case. No cloud transcription or background recording.</Text>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const screen = StyleSheet.create({
  top: { gap: spacing.md, marginBottom: spacing.lg },
  progressTrack: { height: 4, backgroundColor: colors.border, borderRadius: 2 },
  progressFill: { height: 4, backgroundColor: colors.accent, borderRadius: 2 },
  progressText: { color: colors.muted, fontSize: 12, marginTop: spacing.sm },
  mission: { gap: spacing.md, paddingVertical: spacing.lg },
  type: { color: colors.accent, fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },
  instruction: { color: colors.text, fontSize: 29, lineHeight: 38, fontWeight: '800' },
  voice: { color: colors.muted, fontSize: 16, lineHeight: 24 },
  caption: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  status: { color: colors.accent, fontSize: 14, fontWeight: '700' },
  actions: { gap: spacing.sm },
  inputPanel: { padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.card, gap: spacing.sm },
  input: { minHeight: 96, color: colors.text, fontSize: 16, lineHeight: 23, padding: spacing.sm, backgroundColor: colors.card, borderRadius: radii.button, textAlignVertical: 'top' },
  prototypeNote: { color: colors.muted, fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: spacing.xs },
});

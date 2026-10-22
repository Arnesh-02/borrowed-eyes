import { Redirect, router } from 'expo-router';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { BackButton } from '../components/BackButton';
import { PrimaryButton } from '../components/PrimaryButton';
import { Screen } from '../components/Screen';
import { getAIConfig } from '../config/ai';
import { useSessionStore } from '../store/sessionStore';
import { colors, radii, spacing, styles } from '../theme/theme';

const durations = [10, 20, 30] as const;
export function SessionSetupScreen() {
  const state = useSessionStore();
  const configured = Boolean(getAIConfig().endpoint);
  if (!state.selectedCharacter) return <Redirect href="/character" />;
  return <Screen>
    <BackButton label="Back to perspective" onPress={() => router.canGoBack() ? router.back() : router.replace('/character')} />
    <View style={screen.header}>
      <Text style={styles.eyebrow}>02 / CASE FILE — {state.selectedCharacter.name.toUpperCase()}</Text>
      <Text style={styles.title}>Tonight, ordinary streets are evidence.</Text>
      <Text style={styles.subtitle}>{state.selectedCharacter.introduction}</Text>
    </View>
    <View style={styles.card}>
      <Text style={screen.label}>INVESTIGATION LENGTH</Text>
      <View style={screen.options}>{durations.map((value) => <Pressable key={value}
        accessibilityRole="radio" accessibilityLabel={`${value} minutes`} accessibilityState={{ selected: state.durationMinutes === value }}
        onPress={() => state.setDuration(value)} style={[screen.option, state.durationMinutes === value && screen.optionSelected]}>
        <Text style={[screen.optionValue, state.durationMinutes === value && screen.optionTextSelected]}>{value}</Text>
        <Text style={[screen.optionUnit, state.durationMinutes === value && screen.optionTextSelected]}>MIN</Text>
      </Pressable>)}</View>
    </View>
    <View style={screen.note}>
      <Text style={screen.noteTitle}>Put your headphones on.</Text>
      <Text style={screen.noteCopy}>Keep the volume low enough to hear your surroundings. You can put your phone away between prompts, but this prototype must remain open and unlocked.</Text>
    </View>
    <View style={[styles.card, screen.settings]}>
      <View style={screen.settingRow}>
        <Text style={screen.settingTitle}>Speak the Detective</Text>
        <Switch accessibilityLabel="Speak the Detective using system text to speech" value={state.speechEnabled} onValueChange={state.setSpeechEnabled} trackColor={{ true: colors.accent }} />
      </View>
      <Text style={screen.noteCopy}>Uses your device’s system voice, not Kokoro. Some voices require a network connection. No recording is made.</Text>
      <View style={screen.settingRow}>
        <Text style={screen.settingTitle}>Use Gemma · development</Text>
        <Switch accessibilityLabel="Send observations to the configured Gemma development endpoint" value={state.aiEnabled} disabled={!configured} onValueChange={state.setAIEnabled} trackColor={{ true: colors.accent }} />
      </View>
      <Text style={screen.noteCopy}>{configured
        ? 'Opt in for this adventure: your typed observations and a few recent turns go to the configured developer machine. They are cleared from app memory when the case ends.'
        : 'No inference endpoint configured. Local missions and system speech still work. See docs/phase-2-development.md to connect Gemma.'}</Text>
      <Text style={screen.noteCopy}>Voice input uses local Whisper in a native development build. Until a model is selected or the native build is available, the clearly labelled development text input remains available. No ambient track is bundled.</Text>
      <Text style={screen.noteCopy}>{state.voiceModelName ? `Whisper model selected: ${state.voiceModelName}` : 'Local voice is ready to configure after you choose a Whisper model file.'}</Text>
      <PrimaryButton secondary label="Choose local Whisper model" onPress={() => { void state.chooseVoiceModel(); }} />
    </View>
    <View style={screen.safety}>
      <Text style={screen.safetyTitle}>Stay aware</Text>
      <Text style={screen.noteCopy}>Choose a familiar, safe place. Stay aware of traffic and your surroundings. Stay in public areas; observe without touching objects or approaching strangers. You may skip anything.</Text>
    </View>
    <PrimaryButton label="Begin Investigation" onPress={state.startSession} />
  </Screen>;
}

const screen = StyleSheet.create({
  header: { gap: spacing.sm, marginBottom: spacing.xl },
  label: { color: colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: 1.5, marginBottom: spacing.md },
  options: { flexDirection: 'row', gap: spacing.sm },
  option: { flex: 1, minHeight: 74, borderWidth: 1, borderColor: colors.border, borderRadius: radii.button, alignItems: 'center', justifyContent: 'center', gap: 2 },
  optionSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  optionValue: { color: colors.text, fontSize: 22, fontWeight: '800' },
  optionUnit: { color: colors.muted, fontSize: 10, fontWeight: '800' },
  optionTextSelected: { color: colors.ink },
  note: { gap: spacing.sm, marginVertical: spacing.lg },
  noteTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  noteCopy: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  settings: { gap: spacing.sm, marginBottom: spacing.lg },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48 },
  settingTitle: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1 },
  safety: { borderLeftWidth: 3, borderLeftColor: colors.accent, padding: spacing.md, marginBottom: spacing.lg, gap: 5 },
  safetyTitle: { color: colors.accent, fontSize: 12, fontWeight: '800' },
});

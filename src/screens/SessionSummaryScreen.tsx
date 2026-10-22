import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '../components/PrimaryButton';
import { Screen } from '../components/Screen';
import { completionRate, formatDuration } from '../engine/ExperienceEngine';
import { detectiveMissions } from '../data/missions';
import { useSessionStore } from '../store/sessionStore';
import { colors, spacing, styles } from '../theme/theme';

export function SessionSummaryScreen() {
  const state = useSessionStore();
  const highlight = detectiveMissions.find((mission) => mission.id === state.completedMissionIds.at(-1));
  return <Screen>
    <View style={screen.header}>
      <Text style={styles.eyebrow}>YOUR ADVENTURE</Text>
      <Text style={styles.title}>Case closed.</Text>
      <Text style={screen.character}>{state.selectedCharacter?.name.toUpperCase()}</Text>
    </View>
    <View style={styles.card}>
      <View style={screen.stats}>
        <View><Text style={screen.value}>{formatDuration(state.elapsedSeconds)}</Text><Text style={screen.statLabel}>ELAPSED TIME</Text></View>
        <View><Text style={screen.value}>{state.completedMissionIds.length}</Text><Text style={screen.statLabel}>COMPLETED</Text></View>
        <View><Text style={screen.value}>{state.skippedMissionIds.length}</Text><Text style={screen.statLabel}>SKIPPED</Text></View>
      </View>
      <View style={screen.rate}>
        <Text style={screen.rateValue}>{completionRate(state.missionHistory)}%</Text>
        <Text style={screen.statLabel}>COMPLETION RATE</Text>
        <Text style={screen.note}>Completed ÷ completed and skipped missions. Paused time is excluded.</Text>
      </View>
    </View>
    {highlight && <View style={screen.thought}>
      <Text style={screen.statLabel}>LAST MISSION YOU COMPLETED</Text>
      <Text style={screen.note}>{highlight.instruction}</Text>
    </View>}
    <View style={screen.thought}>
      <Text style={screen.statLabel}>A FINAL THOUGHT</Text>
      <Text style={screen.thoughtCopy}>{state.selectedCharacter?.closingThought}</Text>
      <Text style={screen.note}>Conversation memory has been cleared from the app. No recording was made.</Text>
    </View>
    <View style={screen.actions}>
      <PrimaryButton label="Start Another Adventure" onPress={() => { state.resetSession(); router.replace('/character'); }} />
      <PrimaryButton label="Back to Home" secondary onPress={() => { state.resetSession(); router.replace('/'); }} />
    </View>
  </Screen>;
}

const screen = StyleSheet.create({
  header: { gap: spacing.sm, marginBottom: spacing.lg },
  character: { color: colors.accent, fontSize: 12, fontWeight: '800', letterSpacing: 2 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, justifyContent: 'space-between', borderBottomColor: colors.border, borderBottomWidth: 1, paddingBottom: spacing.lg },
  value: { color: colors.text, fontSize: 25, fontWeight: '800', marginBottom: 4 },
  statLabel: { color: colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  rate: { paddingTop: spacing.lg, gap: 5 },
  rateValue: { color: colors.accent, fontSize: 32, fontWeight: '800' },
  note: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  thought: { gap: spacing.sm, paddingTop: spacing.lg },
  thoughtCopy: { color: colors.text, fontSize: 19, lineHeight: 28 },
  actions: { gap: spacing.sm, marginTop: spacing.xl },
});

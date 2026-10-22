import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { BackButton } from '../components/BackButton';
import { CharacterCard } from '../components/CharacterCard';
import { PrimaryButton } from '../components/PrimaryButton';
import { Screen } from '../components/Screen';
import { detective } from '../characters/detective';
import { useSessionStore } from '../store/sessionStore';
import { colors, spacing, styles } from '../theme/theme';

export function CharacterSelectScreen() {
  const selected = useSessionStore((state) => state.selectedCharacter);
  const select = useSessionStore((state) => state.selectCharacter);
  return <Screen>
    <BackButton label="Back to home" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} />
    <View style={screen.header}>
      <Text style={styles.eyebrow}>01 / PERSPECTIVE</Text>
      <Text style={styles.title}>Who is looking with you?</Text>
      <Text style={styles.subtitle}>Choose a voice to change the way the world looks back.</Text>
    </View>
    <CharacterCard character={detective} selected={selected?.id === detective.id} onPress={() => select(detective)} />
    <View style={screen.bottom}>
      <Text style={screen.line}>One perspective. Infinite clues.</Text>
      <PrimaryButton label="Continue" disabled={!selected} onPress={() => router.navigate('/setup')} />
    </View>
  </Screen>;
}
const screen = StyleSheet.create({
  header: { gap: spacing.sm, marginBottom: spacing.xl },
  bottom: { marginTop: spacing.xl, gap: spacing.md },
  line: { color: colors.muted, textAlign: 'center', fontSize: 13 },
});

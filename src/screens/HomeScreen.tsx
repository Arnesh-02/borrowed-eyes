import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '../components/PrimaryButton';
import { Screen } from '../components/Screen';
import { colors, spacing, styles } from '../theme/theme';

export function HomeScreen() { return <Screen><View style={home.hero}><View style={home.orbit}><View style={home.dot} /></View><Text style={styles.eyebrow}>BORROWED EYES</Text><Text style={[styles.title, home.title]}>See your ordinary world through extraordinary eyes.</Text><Text style={styles.subtitle}>An audio adventure that helps you notice the world you have been walking past.</Text><PrimaryButton label="Choose Your Perspective" onPress={() => router.push('/character')} /><Text style={home.support}>Less screen. More world.</Text></View></Screen>; }
const home = StyleSheet.create({ hero: { flex: 1, justifyContent: 'center', gap: spacing.lg, paddingVertical: spacing.xxl }, title: { fontSize: 40, lineHeight: 46 }, orbit: { alignSelf: 'flex-start', width: 84, height: 84, borderRadius: 42, borderWidth: 1, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md }, dot: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.accent }, support: { color: colors.muted, textAlign: 'center', fontSize: 13, letterSpacing: 1, marginTop: spacing.sm } });

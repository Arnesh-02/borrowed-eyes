import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, spacing } from '../theme/theme';

export function BackButton({ label, onPress }: { label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={spacing.sm} style={({ pressed }) => [styles.button, pressed && styles.pressed]}><Text style={styles.arrow}>‹</Text><Text style={styles.label}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({ button: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', minHeight: 40, marginBottom: spacing.lg }, pressed: { opacity: 0.7 }, arrow: { color: colors.accent, fontSize: 30, lineHeight: 30, marginRight: 3 }, label: { color: colors.muted, fontSize: 14, fontWeight: '700' } });

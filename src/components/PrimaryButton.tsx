import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, radii, spacing } from '../theme/theme';

export function PrimaryButton({ label, onPress, disabled = false, secondary = false }: { label: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.button, secondary && styles.secondary, disabled && styles.disabled, pressed && !disabled && styles.pressed]}><Text style={[styles.label, secondary && styles.secondaryLabel]}>{label}</Text></Pressable>;
}
const styles = StyleSheet.create({ button: { minHeight: 56, borderRadius: radii.button, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg }, secondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border }, disabled: { opacity: 0.35 }, pressed: { transform: [{ scale: 0.98 }] }, label: { color: colors.ink, fontSize: 16, fontWeight: '800' }, secondaryLabel: { color: colors.text } });

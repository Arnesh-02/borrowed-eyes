import { Platform, StyleSheet } from 'react-native';

export const colors = { background: '#0F172A', accent: '#10B981', text: '#F8FAFC', muted: '#94A3B8', card: '#1E293B', border: '#334155', danger: '#FB7185', ink: '#07111f' } as const;
export const spacing = { xs: 8, sm: 12, md: 18, lg: 24, xl: 36, xxl: 56 } as const;
export const radii = { card: 22, button: 16, pill: 999 } as const;
export const shadow = Platform.select({ ios: { shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } }, android: { elevation: 5 }, default: {} });
export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scroll: { flexGrow: 1, padding: spacing.lg, width: '100%', maxWidth: 680, alignSelf: 'center' },
  eyebrow: { color: colors.accent, fontSize: 12, fontWeight: '800', letterSpacing: 2 },
  title: { color: colors.text, fontSize: 34, lineHeight: 40, fontWeight: '800', letterSpacing: -0.6 },
  subtitle: { color: colors.muted, fontSize: 17, lineHeight: 25 },
  card: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: radii.card, padding: spacing.lg, ...shadow },
});

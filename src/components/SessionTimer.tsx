import { StyleSheet, Text, View } from 'react-native';
import { formatDuration } from '../engine/ExperienceEngine';
import { colors } from '../theme/theme';

export function SessionTimer({ seconds, paused }: { seconds: number; paused: boolean }) { return <View style={styles.wrap}><Text style={styles.time}>{formatDuration(seconds)}</Text><Text style={styles.label}>{paused ? 'SESSION PAUSED' : 'REMAINING'}</Text></View>; }
const styles = StyleSheet.create({ wrap: { alignItems: 'center', gap: 3 }, time: { color: colors.text, fontSize: 58, fontWeight: '800', letterSpacing: 2 }, label: { color: colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: 2 } });

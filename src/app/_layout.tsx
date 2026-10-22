import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from '../theme/theme';
import { SessionRuntime } from '../components/SessionRuntime';
import { useSessionStore } from '../store/sessionStore';

export default function RootLayout() {
  const status = useSessionStore((state) => state.status);
  return (
    <SafeAreaProvider>
      <SessionRuntime />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background }, animation: 'fade' }}>
        <Stack.Protected guard={status === 'idle'}>
          <Stack.Screen name="index" />
          <Stack.Screen name="character" />
          <Stack.Screen name="setup" />
        </Stack.Protected>
        <Stack.Protected guard={status === 'running' || status === 'paused'}>
          <Stack.Screen name="session" options={{ gestureEnabled: false }} />
        </Stack.Protected>
        <Stack.Protected guard={status === 'completed'}>
          <Stack.Screen name="summary" options={{ gestureEnabled: false }} />
        </Stack.Protected>
      </Stack>
    </SafeAreaProvider>
  );
}

import { PropsWithChildren } from 'react';
import { ScrollView, StatusBar, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { styles } from '../theme/theme';

export function Screen({ children, scroll = true }: PropsWithChildren<{ scroll?: boolean }>) {
  return <SafeAreaView style={styles.screen}>
    <StatusBar barStyle="light-content" />
    <View style={styles.screen}>
      {scroll ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>{children}</ScrollView> : children}
    </View>
  </SafeAreaView>;
}

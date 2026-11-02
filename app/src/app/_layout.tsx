import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { UpdatePrompt } from '../components/UpdatePrompt';
import { AuthProvider, useAuth } from '../lib/auth';
import { I18nProvider, useI18n } from '../lib/i18n';
import { colors } from '../lib/theme';

// Keep the branded splash (D on black) up until we know whether someone is signed in,
// then fade it out, so there's no blank frame or spinner at launch.
SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions({ fade: true, duration: 400 });

function Gate() {
  const { user, ready: authReady } = useAuth();
  const { ready: langReady, isRTL } = useI18n();
  const ready = authReady && langReady;
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);
  if (!ready) return <View style={{ flex: 1, backgroundColor: '#000' }} />;
  // Arabic: right-to-left layout without I18nManager.forceRTL (which needs an app restart).
  // Yoga flips rows and start/end below this view; set on each screen's content too.
  const direction = isRTL ? 'rtl' : 'ltr';
  return (
    <View style={{ flex: 1, direction, backgroundColor: '#000' }}>
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg, direction }, animation: 'fade' }}>
      <Stack.Protected guard={!!user}>
        <Stack.Screen name="index" />
        <Stack.Screen name="title/[id]" />
        <Stack.Screen name="category/[slug]" />
        <Stack.Screen name="search" />
        <Stack.Screen name="link" />
        <Stack.Screen name="account" />
        <Stack.Screen name="watch/[fileId]" options={{ animation: 'none', orientation: 'landscape' }} />
      </Stack.Protected>
      <Stack.Protected guard={!user}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
    <UpdatePrompt />
    </View>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <I18nProvider>
        <StatusBar style="light" />
        <Gate />
      </I18nProvider>
    </AuthProvider>
  );
}

import 'react-native-gesture-handler';
import React from 'react';
import { useFonts } from 'expo-font';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppDataProvider } from './src/data/AppDataContext';
import { AuthProvider } from './src/data/AuthContext';
import LicenceKeeper from './src/data/LicenceKeeper';
import SyncKeeper from './src/data/SyncKeeper';
import DeviceGate from './src/components/DeviceGate';
import StorageKeeper from './src/data/StorageKeeper';
import BackupKeeper from './src/data/BackupKeeper';
import OwnerSummaryKeeper from './src/data/OwnerSummaryKeeper';
import { installRefusalHandler } from './src/data/refusal';
import { installCrashReporting } from './src/data/crashReporter';
import CrashContext from './src/components/CrashContext';
import ErrorBoundary from './src/components/ErrorBoundary';
import ThemedStatusBar from './src/components/ThemedStatusBar';

// a refusal nothing caught is shown to the person rather than crashing the app
installRefusalHandler();
// anything else that breaks is reported to the developer console (crashReporter)
installCrashReporting();
import { ToastProvider } from './src/components/Toast';
import RootNavigator from './src/nav/RootNavigator';
import VersionGate from './src/components/VersionGate';

export default function App() {
  const [fontsLoaded] = useFonts({
    // Google Sans with its extreme glyph heights trimmed (scripts/trim-font-metrics.js),
    // so Android does not pad every line to 2.25 em
    Sans_400: require('./assets/fonts/GoogleSans_400Regular.ttf'),
    Sans_500: require('./assets/fonts/GoogleSans_500Medium.ttf'),
    Sans_600: require('./assets/fonts/GoogleSans_600SemiBold.ttf'),
    Sans_700: require('./assets/fonts/GoogleSans_700Bold.ttf'),
  });

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <AppDataProvider>
          <ToastProvider>
            <LicenceKeeper />
            <SyncKeeper />
            <DeviceGate />
            <StorageKeeper />
            <BackupKeeper />
            <OwnerSummaryKeeper />
            <CrashContext />
            <ErrorBoundary>
              <VersionGate>
                <RootNavigator />
              </VersionGate>
            </ErrorBoundary>
            <ThemedStatusBar />
          </ToastProvider>
        </AppDataProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

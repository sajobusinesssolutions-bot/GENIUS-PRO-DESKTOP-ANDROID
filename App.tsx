import 'react-native-gesture-handler';
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold } from '@expo-google-fonts/inter';
import { IBMPlexMono_500Medium, IBMPlexMono_600SemiBold } from '@expo-google-fonts/ibm-plex-mono';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppDataProvider } from './src/data/AppDataContext';
import { AuthProvider } from './src/data/AuthContext';
import LicenceKeeper from './src/data/LicenceKeeper';
import SyncKeeper from './src/data/SyncKeeper';
import StorageKeeper from './src/data/StorageKeeper';
import BackupKeeper from './src/data/BackupKeeper';
import { installRefusalHandler } from './src/data/refusal';

// a refusal nothing caught is shown to the person rather than crashing the app
installRefusalHandler();
import { ToastProvider } from './src/components/Toast';
import RootNavigator from './src/nav/RootNavigator';

export default function App() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold,
    IBMPlexMono_500Medium, IBMPlexMono_600SemiBold,
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
            <StorageKeeper />
            <BackupKeeper />
            <RootNavigator />
            <StatusBar style="auto" />
          </ToastProvider>
        </AppDataProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

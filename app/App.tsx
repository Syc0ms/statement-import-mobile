import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { TEST_TOOLS_ENABLED } from './src/platform/buildFlags';
import { api, controller, settings } from './src/platform/services';
import { DiagnosticsSheet } from './src/ui/DiagnosticsSheet';
import { ImportScreen } from './src/ui/ImportScreen';
import { usePalette } from './src/ui/theme';

export default function App() {
  const palette = usePalette();
  const [diagnostics, setDiagnostics] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // The API host override exists only in test builds.
      if (TEST_TOOLS_ENABLED) await settings.load();
      if (!cancelled) await controller.restore();
    })();
    // Polling and recovery run only while the app is in the foreground.
    const subscription = AppState.addEventListener('change', (state) => controller.setForeground(state === 'active'));
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: palette.canvas }}>
        <StatusBar style={palette.scheme === 'dark' ? 'light' : 'dark'} />
        <ImportScreen controller={controller} onOpenDiagnostics={TEST_TOOLS_ENABLED ? () => setDiagnostics(true) : undefined} />
        {TEST_TOOLS_ENABLED ? (
          <DiagnosticsSheet
            visible={diagnostics}
            onClose={() => setDiagnostics(false)}
            api={api}
            settings={settings}
            controller={controller}
          />
        ) : null}
      </View>
    </SafeAreaProvider>
  );
}

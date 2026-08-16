import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { LogBox } from "react-native";
import * as Font from 'expo-font';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { ToastProvider } from "@/src/toast";


LogBox.ignoreAllLogs(true);

SplashScreen.preventAutoHideAsync();

function usePlayfair() {
  return Font.useFonts({
    PlayfairDisplay: 'https://fonts.gstatic.com/s/playfairdisplay/v37/nuFvD-vYSZviVYUb_rj3ij__anPXJzDwcbmjWBN2PKdFvXDXbtc.ttf',
  });
}

export default function RootLayout() {
  const [iconsLoaded, iconsError] = useIconFonts();
  const [fontsLoaded, fontsError] = usePlayfair();

  useEffect(() => {
    const ready = (iconsLoaded || iconsError) && (fontsLoaded || fontsError);
    if (ready) SplashScreen.hideAsync();
  }, [iconsLoaded, iconsError, fontsLoaded, fontsError]);

  if (!iconsLoaded && !iconsError) return null;
  if (!fontsLoaded && !fontsError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ToastProvider>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#FDFBF7' } }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="review" options={{ presentation: 'card' }} />
            <Stack.Screen name="book/[id]" options={{ presentation: 'card' }} />
          </Stack>
        </ToastProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

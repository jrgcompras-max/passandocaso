import {
  DarkTheme,
  DefaultTheme,
  Stack,
  ThemeProvider,
  useRouter,
  useSegments,
} from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useColorScheme, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AuthProvider, useAuth } from '@/store/AuthContext';

const STATUS_BAR_BG = '#0F2D52';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <RootContent />
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

function RootContent() {
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const { usuario, carregando } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  // Gate de autenticação: redireciona conforme a sessão. Só age após o boot
  // (carregando = false), garantindo que o token já esteja em memória antes de
  // montar as telas autenticadas (que disparam chamadas com Authorization).
  useEffect(() => {
    if (carregando) return;
    const noAuth = segments[0] === '(auth)';
    if (!usuario && !noAuth) router.replace('/login');
    else if (usuario && noAuth) router.replace('/');
  }, [usuario, carregando, segments, router]);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      {/* SDK 56 é edge-to-edge: não há backgroundColor de status bar.
          Desenhamos uma faixa azul escura na altura do inset superior e
          usamos ícones claros (style="light") por cima dela. */}
      <StatusBar style="light" />
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: insets.top,
          backgroundColor: STATUS_BAR_BG,
          zIndex: 100,
        }}
      />
      <AnimatedSplashOverlay />
      {/* Enquanto carrega a sessão, mantém só o fundo — evita montar a home
          (e suas requisições) antes do token estar disponível. */}
      {carregando ? (
        <View style={{ flex: 1, backgroundColor: STATUS_BAR_BG }} />
      ) : (
        <Stack screenOptions={{ headerShown: false }} />
      )}
    </ThemeProvider>
  );
}

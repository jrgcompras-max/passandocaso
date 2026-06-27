import {
  DarkTheme,
  DefaultTheme,
  Stack,
  ThemeProvider,
  useRouter,
  useSegments,
} from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useColorScheme, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { BloqueioBiometrico } from '@/components/BloqueioBiometrico';
import { CropProvider } from '@/components/CropImagem';
import { ClinicalColors } from '@/constants/clinicalTheme';
import { autenticarBiometria, biometriaAtivada, nomeBiometria } from '@/lib/biometria';
import { AuthProvider, useAuth } from '@/store/AuthContext';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <CropProvider>
          <RootContent />
        </CropProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

function RootContent() {
  const colorScheme = useColorScheme();
  const { usuario, carregando, sair } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  // Bloqueio biométrico: na primeira vez que a sessão fica pronta, se o
  // desbloqueio estiver ativado, tranca o app até o Face ID/Touch ID autenticar.
  const [bloqueado, setBloqueado] = useState(false);
  const [nomeBio, setNomeBio] = useState('Face ID');
  const checadoRef = useRef(false);

  // Gate de autenticação: redireciona conforme a sessão. Só age após o boot
  // (carregando = false), garantindo que o token já esteja em memória antes de
  // montar as telas autenticadas (que disparam chamadas com Authorization).
  useEffect(() => {
    if (carregando) return;
    const noAuth = segments[0] === '(auth)';
    if (!usuario && !noAuth) router.replace('/login');
    else if (usuario && noAuth) router.replace('/');
  }, [usuario, carregando, segments, router]);

  useEffect(() => {
    if (carregando) return;
    if (!usuario) {
      // Logout: libera para a próxima sessão checar de novo.
      checadoRef.current = false;
      setBloqueado(false);
      return;
    }
    if (checadoRef.current) return;
    checadoRef.current = true;
    void (async () => {
      if (await biometriaAtivada()) {
        setNomeBio(await nomeBiometria());
        setBloqueado(true);
        if (await autenticarBiometria()) setBloqueado(false);
      }
    })();
  }, [carregando, usuario]);

  const desbloquear = useCallback(async () => {
    if (await autenticarBiometria()) setBloqueado(false);
  }, []);

  const sairDoBloqueio = useCallback(() => {
    setBloqueado(false);
    void sair();
  }, [sair]);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      {/* Status bar clara com ícones escuros — o fundo #F2F2F7 das telas vai até
          o topo (edge-to-edge), sem faixa colorida. */}
      <StatusBar style="dark" />
      <AnimatedSplashOverlay />
      {/* Enquanto carrega a sessão, mantém só o fundo — evita montar a home
          (e suas requisições) antes do token estar disponível. */}
      {carregando ? (
        <View style={{ flex: 1, backgroundColor: ClinicalColors.background }} />
      ) : (
        <Stack screenOptions={{ headerShown: false }} />
      )}
      {bloqueado && (
        <BloqueioBiometrico
          nome={nomeBio}
          onDesbloquear={desbloquear}
          onSair={sairDoBloqueio}
        />
      )}
    </ThemeProvider>
  );
}

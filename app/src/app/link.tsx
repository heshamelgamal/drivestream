// "Link a device": approve a TV's sign-in code by typing it or scanning its QR.
// Approving signs that TV in as you.
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, codeFrom } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button } from '../components/ui';
import { useI18n } from '../lib/i18n';
import { colors, display, isTV, s } from '../lib/theme';

export default function Link() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState('');
  const [device, setDevice] = useState<string | null>(null); // set once the code checks out
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const { t, f, ta, isRTL } = useI18n();
  const h1 = isRTL ? [styles.h1, styles.h1Ar] : styles.h1;
  const text = [styles.text, f('regular'), ta];
  const errStyle = [styles.error, f('regular'), ta];

  async function check(raw = code) {
    const c = codeFrom(raw);
    if (c.length !== 6) return setError(t('link.badCode'));
    setCode(c);
    setError('');
    setBusy(true);
    try {
      const d = await api<{ device: string }>(`/api/device/lookup?code=${c}`);
      setDevice(d.device === 'TV' ? t('link.theTV') : d.device);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    setBusy(true);
    try {
      await api('/api/device/approve', { method: 'POST', body: { code } });
      setDone(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function scan() {
    if (!permission?.granted && !(await requestPermission()).granted) return setError(t('link.camera'));
    setError('');
    setScanning(true);
  }

  if (scanning) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => { setScanning(false); check(data); }} />
        <View style={[styles.scanHint, { paddingBottom: insets.bottom + s(24) }]}>
          <Text style={[styles.scanText, f('medium')]}>{t('link.pointCamera')}</Text>
          <Button label={t('common.cancel')} kind="secondary" onPress={() => setScanning(false)} />
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={[styles.wrap, { paddingTop: insets.top + s(40) }]}>
      <View style={styles.card}>
        {done ? (
          <>
            <Text style={h1}>{t('link.done')}</Text>
            <Text style={text}>{t('link.doneText')}</Text>
            <Button label={t('link.backHome')} onPress={() => router.back()} />
          </>
        ) : device ? (
          <>
            <Text style={h1}>{t('link.confirmTitle')}</Text>
            <Text style={text}>{t('link.confirmA', { device })}<Text style={[{ fontWeight: '800', color: '#fff' }, f('bold')]}>{user?.name}</Text>{t('link.confirmB', { username: user?.username || '' })}</Text>
            {error ? <Text style={errStyle}>{error}</Text> : null}
            <Button label={busy ? t('link.signingIn') : t('link.signInTV')} onPress={approve} />
            <Button label={t('common.cancel')} kind="secondary" onPress={() => { setDevice(null); setCode(''); }} />
          </>
        ) : (
          <>
            <Text style={h1}>{t('link.title')}</Text>
            <Text style={text}>{t('link.help')}</Text>
            <TextInput style={styles.codeInput} value={code} onChangeText={(v) => setCode(v.toUpperCase())} placeholder="ABC-123" placeholderTextColor="#777"
              autoCapitalize="characters" autoCorrect={false} maxLength={7} returnKeyType="go" onSubmitEditing={() => check()} autoFocus={isTV} />
            {error ? <Text style={errStyle}>{error}</Text> : null}
            <Button label={busy ? t('link.checking') : t('common.continue')} onPress={() => check()} />
            {!isTV ? <Button label={t('link.scan')} icon="▣" kind="secondary" onPress={scan} /> : null}
            <Button label={t('common.back')} kind="secondary" onPress={() => router.back()} />
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, alignItems: 'center', padding: s(20) },
  card: { width: '100%', maxWidth: s(420), backgroundColor: 'rgba(30,30,30,0.9)', borderRadius: 8, padding: s(24), gap: s(12) },
  h1: { color: '#fff', fontFamily: display, fontSize: s(36), letterSpacing: 0.5 },
  h1Ar: { fontFamily: 'ThmanyahSans-Bold', fontSize: s(28), letterSpacing: 0 },
  text: { color: '#ccc', fontSize: s(15), lineHeight: s(22) },
  codeInput: { color: '#fff', fontFamily: display, fontSize: s(40), letterSpacing: 6, textAlign: 'center', backgroundColor: '#333', borderRadius: 4, paddingVertical: s(8), borderWidth: 2, borderColor: '#555' },
  error: { backgroundColor: '#e87c03', color: '#fff', padding: s(10), borderRadius: 4, fontSize: s(14) },
  scanHint: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', gap: s(12), paddingTop: s(20), backgroundColor: 'rgba(0,0,0,0.6)' },
  scanText: { color: '#fff', fontSize: s(16), fontWeight: '700' },
});

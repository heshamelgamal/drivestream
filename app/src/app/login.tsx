import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { useAuth } from '../lib/auth';
import { DEFAULT_SERVER, deviceStart, devicePoll, getServer, mediaUrl, type DeviceCode, type User } from '../lib/api';
import { Button, Credit, Focusable, focusInk } from '../components/ui';
import { arabicFontFor, useI18n } from '../lib/i18n';
import { colors, display, isTV, s } from '../lib/theme';

export default function Login() {
  const { signIn, adopt } = useAuth();
  const { t, f, ta, isRTL, lang, setLang } = useI18n();
  // Arabic: headings in Thmanyah (Bebas Neue has no Arabic letters); inputs right-aligned.
  const h1 = isRTL ? [styles.h1, styles.h1Ar] : styles.h1;
  const inputAr = isRTL ? [f('regular'), { textAlign: 'right' as const }] : null;
  const [server, setServer] = useState(getServer() || DEFAULT_SERVER);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [badField, setBadField] = useState<'username' | 'password' | ''>(''); // which box the error is about
  const [busy, setBusy] = useState(false);
  const [showServer, setShowServer] = useState(!server); // no address built in: ask for it
  const [showPass, setShowPass] = useState(false);
  // TVs show the code straight away; on phones it's one tap away.
  const [withCode, setWithCode] = useState(isTV);
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);
  const [focused, setFocused] = useState(''); // which field the TV remote / keyboard is on

  // Language: shown in the other language so it can always be found. Phones: at the top.
  // TV: below the form, so the remote still starts on the username box.
  const langSwitch = (
    <Focusable style={[styles.langBtn, isTV && styles.langBtnTV]} onPress={() => setLang(lang === 'ar' ? 'en' : 'ar')}>
      {(focused) => <Text style={[styles.langText, lang === 'ar' ? null : arabicFontFor('medium'), focused && focusInk]}>{lang === 'ar' ? 'English' : 'العربية'}</Text>}
    </Focusable>
  );

  async function submit() {
    if (busy) return;
    setError('');
    setBadField('');
    setBusy(true);
    try {
      await signIn(server, username.trim(), password);
    } catch (e: any) {
      setError(e?.message?.includes('Network') ? t('login.cantReach') : e?.message || t('login.failed'));
      if (e?.field === 'username' || e?.field === 'password') setBadField(e.field);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#000' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
        {!isTV ? langSwitch : null}
        <Image source={require('../../assets/logo.png')} style={styles.logo} contentFit='contain' accessibilityLabel='DriveStream' />
        <View style={styles.split}>
        {withCode && server.trim() ? <CodeSignIn server={server} onSignedIn={adopt} /> : null}
        <View style={styles.card}>
          <Text style={h1}>{t('login.signIn')}</Text>
          <TextInput style={[styles.input, inputAr, focused === 'u' && styles.inputFocus, badField === 'username' && styles.inputBad]} onFocus={() => setFocused('u')} onBlur={() => setFocused('')} placeholder={t('login.username')} placeholderTextColor="#8c8c8c" autoCapitalize="none" autoCorrect={false}
            autoComplete="username" textContentType="username"
            value={username} onChangeText={(v) => { setUsername(v); if (badField === 'username') setBadField(''); }} returnKeyType="next"
            submitBehavior="submit" onSubmitEditing={() => passwordRef.current?.focus()} />
          <View style={styles.passRow}>
            <TextInput ref={passwordRef} style={[styles.input, styles.passInput, inputAr, focused === 'p' && styles.inputFocus, badField === 'password' && styles.inputBad]} onFocus={() => setFocused('p')} onBlur={() => setFocused('')} placeholder={t('login.password')} placeholderTextColor="#8c8c8c" secureTextEntry={!showPass}
              autoComplete="current-password" textContentType="password" autoCapitalize="none" autoCorrect={false}
              value={password} onChangeText={(v) => { setPassword(v); if (badField === 'password') setBadField(''); }} returnKeyType="go" onSubmitEditing={submit} />
            <Focusable style={styles.showBtn} onPress={() => setShowPass(!showPass)} accessibilityLabel={showPass ? t('login.hidePassword') : t('login.showPassword')}>
              {(focused) => <Text style={[styles.showText, f('medium'), focused && focusInk]}>{showPass ? t('common.hide') : t('common.show')}</Text>}
            </Focusable>
          </View>
          {showServer ? (
            <TextInput style={[styles.input, inputAr, focused === 's' && styles.inputFocus]} onFocus={() => setFocused('s')} onBlur={() => setFocused('')} placeholder={t('login.server')} placeholderTextColor="#8c8c8c" autoCapitalize="none" autoCorrect={false}
              keyboardType="url" value={server} onChangeText={setServer} />
          ) : null}
          {error ? <Text style={[styles.error, f('regular'), ta]}>{error}</Text> : null}
          <Button label={busy ? t('login.signingIn') : t('login.signIn')} onPress={submit} />
          {/* A Focusable (not just tappable text) so a TV remote can reach it */}
          <Focusable style={styles.linkBtn} onPress={() => setShowServer(!showServer)}>
            {(focused) => <Text style={[styles.link, f('medium'), focused && focusInk]}>{showServer ? t('login.hideServer') : t('login.changeServer')}</Text>}
          </Focusable>
          {!isTV ? (
            <Focusable style={styles.linkBtn} onPress={() => setWithCode(!withCode)}>
              {(focused) => <Text style={[styles.link, f('medium'), focused && focusInk]}>{withCode ? t('login.hideCode') : t('login.withCode')}</Text>}
            </Focusable>
          ) : null}
        </View>
        </View>
        {isTV ? langSwitch : null}
        <Credit />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Shows a code and QR; someone signed in approves it on the website ("Link a device")
// or in the phone app, and this device signs in. Renews the code when it expires.
function CodeSignIn({ server, onSignedIn }: { server: string; onSignedIn: (u: User) => void }) {
  const [d, setD] = useState<DeviceCode | null>(null);
  // An app message (translated when shown, so it follows the language) or the server's own text.
  const [err, setErr] = useState<{ key: 'code.cantReach' | 'code.failed' } | { msg: string } | null>(null);
  const [round, setRound] = useState(0);
  const { t, f, isRTL } = useI18n();

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    (async () => {
      try {
        const code = await deviceStart(server, isTV ? 'Android TV' : 'phone');
        if (!live) return;
        setD(code);
        setErr(null);
        const until = Date.now() + code.expiresIn * 1000;
        const poll = async () => {
          if (!live) return;
          if (Date.now() > until) return setRound((n) => n + 1);
          const r = await devicePoll(code.secret).catch(() => 'pending' as const);
          if (!live) return;
          if (r === 'expired') return setRound((n) => n + 1);
          if (r !== 'pending') return onSignedIn(r);
          timer = setTimeout(poll, 2500);
        };
        timer = setTimeout(poll, 2500);
      } catch (e: any) {
        if (!live) return;
        setErr(e?.message?.includes('Network') ? { key: 'code.cantReach' } : e?.message ? { msg: e.message } : { key: 'code.failed' });
        timer = setTimeout(() => setRound((n) => n + 1), 15000);
      }
    })();
    return () => { live = false; clearTimeout(timer); };
  }, [server, round, onSignedIn]);

  return (
    <View style={[styles.card, styles.codeCard]}>
      <Text style={isRTL ? [styles.h1, styles.h1Ar] : styles.h1}>{t('code.title')}</Text>
      <Text style={[styles.codeHelp, f('regular')]}>{t('code.help')}</Text>
      <Text style={styles.code}>{d ? d.display : err ? '—' : '······'}</Text>
      {d ? <Image source={{ uri: mediaUrl(d.qr) }} style={styles.qr} contentFit="contain" accessibilityLabel={t('code.qrA11y')} /> : null}
      <Text style={[styles.link, f('regular')]}>{err ? ('key' in err ? t(err.key) : err.msg) : t('code.changes')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  split: { flexDirection: isTV ? 'row' : 'column', alignItems: isTV ? 'stretch' : 'center', justifyContent: 'center', gap: s(isTV ? 24 : 12), width: '100%' },
  codeCard: { alignItems: 'center' },
  codeHelp: { color: '#ccc', fontSize: s(isTV ? 12 : 14), textAlign: 'center', lineHeight: s(isTV ? 17 : 20) },
  code: { color: '#fff', fontFamily: display, fontSize: s(isTV ? 44 : 52), letterSpacing: 4 },
  qr: { width: s(isTV ? 130 : 180), height: s(isTV ? 130 : 180), borderRadius: 6, backgroundColor: '#fff' },
  passRow: { flexDirection: 'row', alignItems: 'center' },
  // paddingEnd / end so the Show button sits on the left in Arabic.
  passInput: { flex: 1, paddingEnd: s(64) },
  showBtn: { position: 'absolute', end: s(4), paddingHorizontal: s(10), paddingVertical: s(6), borderRadius: 4 },
  showText: { color: '#ccc', fontWeight: '700', fontSize: s(13) },
  wrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: s(isTV ? 12 : 20), gap: s(isTV ? 6 : 12) },
  logo: { width: s(isTV ? 200 : 280), height: s(isTV ? 62 : 86), marginBottom: s(isTV ? 2 : 8) },
  card: { width: isTV ? s(330) : '100%', maxWidth: s(400), backgroundColor: 'rgba(30,30,30,0.9)', borderRadius: 8, padding: s(isTV ? 16 : 24), gap: s(isTV ? 8 : 12) },
  h1: { color: '#fff', fontFamily: display, fontSize: s(isTV ? 28 : 36), letterSpacing: 0.5, marginBottom: s(2) },
  h1Ar: { fontFamily: 'ThmanyahSans-Bold', fontSize: s(isTV ? 22 : 28), letterSpacing: 0 },
  langBtn: { alignSelf: 'flex-end', paddingHorizontal: s(12), paddingVertical: s(4), borderRadius: 4, borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)' },
  langBtnTV: { alignSelf: 'center' },
  langText: { color: '#ddd', fontSize: s(14), fontWeight: '600' },
  input: { borderWidth: 2, borderColor: 'transparent', backgroundColor: '#333', color: '#fff', borderRadius: 4, paddingHorizontal: s(14), paddingVertical: s(isTV ? 8 : 12), fontSize: s(16) },
  inputFocus: { borderWidth: 2, borderColor: '#fff', backgroundColor: '#454545' },
  inputBad: { borderWidth: 2, borderColor: '#e87c03' },
  error: { backgroundColor: '#e87c03', color: '#fff', padding: s(10), borderRadius: 4, fontSize: s(14) },
  link: { color: colors.muted, fontSize: s(13), textAlign: 'center' },
  linkBtn: { alignSelf: 'center', paddingHorizontal: s(10), paddingVertical: s(4), borderRadius: 4 },
});

// Account settings: interface language and password (the same two sections as the website's).
import { useRef, useState, type ComponentRef } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { changePassword } from '../lib/api';
import { arabicFontFor, useI18n, type Lang } from '../lib/i18n';
import { Button, Focusable, focusInk } from '../components/ui';
import { colors, display, s } from '../lib/theme';

// Server messages this screen can show, translated.
const SERVER_ERRORS = {
  'Current password is wrong.': 'server.currentWrong',
  'Password must be at least 6 characters.': 'server.passwordShort',
} as const;

export default function Account() {
  const insets = useSafeAreaInsets();
  const { t, f, ta, isRTL, lang, setLang } = useI18n();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [focused, setFocused] = useState(''); // which field the TV remote / keyboard is on
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const nextRef = useRef<ComponentRef<typeof TextInput>>(null);
  const confirmRef = useRef<ComponentRef<typeof TextInput>>(null);
  const h1 = isRTL ? [styles.h1, styles.h1Ar] : styles.h1;
  const inputAr = isRTL ? [arabicFontFor('regular'), { textAlign: 'right' as const }] : null;

  async function submit() {
    if (busy) return;
    setError('');
    setDone(false);
    if (next.length < 6) return setError(t('account.minLength'));
    if (next !== confirm) return setError(t('account.mismatch'));
    setBusy(true);
    try {
      await changePassword(current, next);
      setDone(true);
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (e: any) {
      const key = SERVER_ERRORS[e?.message as keyof typeof SERVER_ERRORS];
      setError(key ? t(key) : e?.message?.includes('Network') ? t('login.cantReach') : e?.message || t('account.failed'));
    } finally {
      setBusy(false);
    }
  }

  // A language chip, written in its own language and font so it can always be found.
  const chip = (l: Lang, label: string) => (
    <Focusable key={l} style={[styles.chip, lang === l && styles.chipOn]} onPress={() => setLang(l)} hasTVPreferredFocus={lang === l}>
      {(on) => <Text style={[styles.chipText, l === 'ar' ? arabicFontFor('medium') : { fontWeight: '600' }, (lang === l || on) && focusInk]}>{label}</Text>}
    </Focusable>
  );
  const field = (key: string, ref: React.RefObject<ComponentRef<typeof TextInput> | null> | null, value: string, onChange: (v: string) => void,
    placeholder: string, onSubmit: () => void, autoComplete: 'current-password' | 'new-password') => (
    <TextInput ref={ref} style={[styles.input, inputAr, focused === key && styles.inputFocus]} onFocus={() => setFocused(key)} onBlur={() => setFocused('')}
      value={value} onChangeText={(v) => { onChange(v); setError(''); setDone(false); }} placeholder={placeholder} placeholderTextColor="#8c8c8c"
      secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete={autoComplete} returnKeyType={key === 'c' ? 'go' : 'next'}
      submitBehavior={key === 'c' ? undefined : 'submit'} onSubmitEditing={onSubmit} />
  );

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={[styles.wrap, { paddingTop: insets.top + s(32) }]} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text style={h1}>{t('account.title')}</Text>

        <Text style={[styles.h2, f('bold'), ta]}>{t('account.language')}</Text>
        <Text style={[styles.text, f('regular'), ta]}>{t('account.languageHelp')}</Text>
        <View style={styles.chips}>
          {chip('en', 'English')}
          {chip('ar', 'العربية')}
        </View>

        <Text style={[styles.h2, styles.section, f('bold'), ta]}>{t('account.password')}</Text>
        {field('cur', null, current, setCurrent, t('account.current'), () => nextRef.current?.focus(), 'current-password')}
        {field('n', nextRef, next, setNext, t('account.new'), () => confirmRef.current?.focus(), 'new-password')}
        <Text style={[styles.hint, f('regular'), ta]}>{t('account.minLength')}</Text>
        {field('c', confirmRef, confirm, setConfirm, t('account.confirm'), submit, 'new-password')}
        {error ? <Text style={[styles.error, f('regular'), ta]}>{error}</Text> : null}
        {done ? <Text style={[styles.ok, f('regular'), ta]}>{t('account.changed')}</Text> : null}
        <Button label={t('account.password')} onPress={submit} />
        <Button label={t('common.back')} kind="secondary" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, alignItems: 'center', padding: s(20) },
  card: { width: '100%', maxWidth: s(440), backgroundColor: 'rgba(30,30,30,0.9)', borderRadius: 8, padding: s(24), gap: s(12) },
  h1: { color: '#fff', fontFamily: display, fontSize: s(36), letterSpacing: 0.5 },
  h1Ar: { fontFamily: 'ThmanyahSans-Bold', fontSize: s(28), letterSpacing: 0 },
  h2: { color: '#fff', fontSize: s(17), fontWeight: '700' },
  section: { marginTop: s(12) },
  text: { color: '#ccc', fontSize: s(14), lineHeight: s(20) },
  hint: { color: colors.muted, fontSize: s(12), marginTop: -s(6) },
  chips: { flexDirection: 'row', gap: s(8) },
  chip: { paddingHorizontal: s(16), paddingVertical: s(7), borderRadius: 999, borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)' },
  chipOn: { backgroundColor: '#fff', borderColor: '#fff' },
  chipText: { color: '#fff', fontSize: s(15) },
  input: { borderWidth: 2, borderColor: 'transparent', backgroundColor: '#333', color: '#fff', borderRadius: 4, paddingHorizontal: s(14), paddingVertical: s(10), fontSize: s(16) },
  inputFocus: { borderColor: '#fff', backgroundColor: '#454545' },
  error: { backgroundColor: '#e87c03', color: '#fff', padding: s(10), borderRadius: 4, fontSize: s(14) },
  ok: { backgroundColor: 'rgba(70,211,105,0.15)', color: colors.green, padding: s(10), borderRadius: 4, fontSize: s(14) },
});

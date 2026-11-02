import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, type TextStyle } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type Library } from '../lib/api';
import { useAuth } from '../lib/auth';
import { arabicFontFor, useI18n } from '../lib/i18n';
import { isTV, s } from '../lib/theme';
import { Focusable, focusInk } from './ui';

export function TopBar({ categories, active }: { categories: Library['categories']; active?: string }) {
  const { user } = useAuth();
  const { t, f, category } = useI18n();
  const insets = useSafeAreaInsets();
  const [menu, setMenu] = useState(false);
  const tab = (key: string, label: string, onPress: () => void, on: boolean) => (
    <Focusable key={key} onPress={onPress} style={[styles.tab, on && styles.tabCurrent]} focusStyle={styles.tabFocus}>
      {(focused) => <Text style={[styles.tabText, f('medium'), on && styles.tabOn, on && f('bold'), focused && focusInk]}>{label}</Text>}
    </Focusable>
  );
  return (
    <View style={[styles.top, { paddingTop: insets.top + s(8) }]}>
      {isTV
        ? <Image source={require('../../assets/logo.png')} style={styles.wordmark} contentFit='contain' accessibilityLabel='DriveStream' />
        : <Image source={require('../../assets/splash-icon.png')} style={styles.mark} contentFit='contain' accessibilityLabel='DriveStream' />}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        {tab('home', t('nav.home'), () => router.replace('/'), !active)}
        {categories.map((c) => tab(c.slug, category(c.name), () => router.push(`/category/${c.slug}`), active === c.slug))}
        {tab('search', `🔍 ${t('nav.search')}`, () => router.push('/search'), active === 'search')}
      </ScrollView>
      {user ? (
        <Focusable style={[styles.avatar, { backgroundColor: user.color }]} onPress={() => setMenu(true)}>
          {(focused) => <Text style={[styles.avatarText, focused && focusInk]}>{user.name.charAt(0).toUpperCase()}</Text>}
        </Focusable>
      ) : null}
      {user && menu ? <AccountMenu onClose={() => setMenu(false)} /> : null}
    </View>
  );
}

// The avatar's menu: who's signed in, Link a device, Account settings, language, Sign out.
// A modal rather than an Alert: Android alerts hold at most three buttons.
function AccountMenu({ onClose }: { onClose: () => void }) {
  const { user, signOut } = useAuth();
  const { t, f, lang, setLang, isRTL } = useI18n();
  if (!user) return null;
  const item = (label: string, onPress: () => void, opts: { danger?: boolean; first?: boolean; font?: TextStyle | null } = {}) => (
    <Focusable style={styles.item} focusStyle={styles.itemFocus} hasTVPreferredFocus={opts.first}
      onPress={() => { onClose(); onPress(); }}>
      {(focused) => <Text style={[styles.itemText, opts.font !== undefined ? opts.font : f('medium'), opts.danger && { color: '#ff6b6b' }, focused && focusInk]}>{label}</Text>}
    </Focusable>
  );
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      {/* A Modal is its own native root, so it needs its own layout direction. */}
      <View style={[styles.backdrop, { direction: isRTL ? 'rtl' : 'ltr' }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} focusable={false} />
        <View style={styles.sheet}>
          <Text style={[styles.sheetTitle, f('bold')]} numberOfLines={1}>{user.name}</Text>
          <Text style={[styles.sheetSub, f('regular')]} numberOfLines={1}>{t('menu.signedInAs', { username: user.username })}</Text>
          <View style={styles.items}>
            {item(t('menu.linkDevice'), () => router.push('/link'), { first: true })}
            {item(t('menu.account'), () => router.push('/account'))}
            {/* Shown in the other language, so it can always be found. */}
            {lang === 'ar'
              ? item('English', () => setLang('en'), { font: null })
              : item('العربية', () => setLang('ar'), { font: arabicFontFor('medium') })}
            {item(t('menu.signOut'), signOut, { danger: true })}
            {item(t('common.cancel'), () => {})}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: s(12), paddingHorizontal: s(16), paddingBottom: s(8), backgroundColor: isTV ? '#141414' : 'rgba(0,0,0,0.45)' },
  wordmark: { width: s(150), height: s(46) },
  mark: { width: 30, height: 30 },
  tabs: { gap: s(4), alignItems: 'center' },
  // Pills with fixed padding, so focus only changes the colours and nothing shifts.
  tab: { paddingHorizontal: s(14), paddingVertical: s(6), borderRadius: 999 },
  tabCurrent: { backgroundColor: 'rgba(255,255,255,0.14)' },
  tabFocus: { transform: [] }, // white pill without the zoom, which would nudge the row
  tabText: { color: '#e5e5e5', fontSize: s(14) },
  tabOn: { color: '#fff', fontWeight: '800' },
  // marginStart (not marginLeft) so the avatar sits at the far end in both directions.
  avatar: { width: s(32), height: s(32), borderRadius: 4, alignItems: 'center', justifyContent: 'center', marginStart: 'auto' },
  avatarText: { color: '#fff', fontWeight: '800', fontSize: s(15) },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: s(20) },
  sheet: { width: '100%', maxWidth: s(340), backgroundColor: '#262626', borderRadius: 8, padding: s(16), gap: s(2) },
  sheetTitle: { color: '#fff', fontSize: s(18), fontWeight: '800' },
  sheetSub: { color: '#aaa', fontSize: s(13) },
  items: { marginTop: s(10), gap: s(2) },
  item: { paddingVertical: s(10), paddingHorizontal: s(10), borderRadius: 4 },
  itemFocus: { transform: [] },
  itemText: { color: '#eee', fontSize: s(15), fontWeight: '600' },
});

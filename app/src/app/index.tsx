import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, type ContinueEntry, type Item, type Library } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { colors, isTV, s } from '../lib/theme';
import { TopBar } from '../components/TopBar';
import { ContinueCard, Credit, Focusable, focusInk, Hero, PosterCard, Row } from '../components/ui';

const byAdded = (a: Item, b: Item) => (b.addedAt || '').localeCompare(a.addedAt || '');

export default function Home() {
  const [lib, setLib] = useState<Library | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const { t, f, category, genre } = useI18n();

  const load = useCallback(async () => {
    try {
      setLib(await api<Library>('/api/library'));
      setError('');
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  // Reload whenever Home comes back into view, so Continue Watching is fresh after playback.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Back on Home asks before leaving the app (phone and TV); Back again closes the question.
  const [exitAsk, setExitAsk] = useState(false);
  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setExitAsk(true);
      return true;
    });
    return () => sub.remove();
  }, []));

  // Banner: one of the newest titles that has artwork, picked once per visit.
  const [seed] = useState(() => Math.random());
  const pool = lib?.items.filter((i) => i.backdrop).sort(byAdded).slice(0, 8) || [];
  const heroList = pool.length ? pool : lib?.items || [];
  const hero = heroList.length ? heroList[Math.floor(seed * heroList.length)] : null;

  const remove = (e: ContinueEntry) =>
    Alert.alert(t('home.removeTitle'), e.item.title, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.remove'), style: 'destructive', onPress: async () => {
        await api('/api/continue/hide', { method: 'POST', body: { itemId: e.item.id } }).catch(() => {});
        setLib((l) => (l ? { ...l, continue: l.continue.filter((c) => c.item.id !== e.item.id) } : l));
      } },
    ]);

  if (!lib) {
    return (
      <View style={styles.center}>
        {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.red} size="large" />}
        {exitAsk ? <ExitDialog onClose={() => setExitAsk(false)} /> : null}
      </View>
    );
  }

  const genreCount = new Map<string, number>();
  for (const it of lib.items) for (const g of it.genres) genreCount.set(g, (genreCount.get(g) || 0) + 1);
  const topGenres = [...genreCount].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([g]) => g);
  const resume = hero && lib.continue.find((c) => c.item.id === hero.id);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView refreshControl={!isTV ? <RefreshControl refreshing={refreshing} tintColor={colors.red}
        onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} /> : undefined}>
        {hero ? <Hero item={hero} resumeFileId={resume?.fileId} /> : <View style={{ height: s(110) }} />}
        <Row title={t('home.continue')} data={lib.continue} keyOf={(c) => c.item.id} render={(c) => <ContinueCard entry={c} onRemove={remove} />} />
        <Row title={t('home.recent')} data={[...lib.items].sort(byAdded).slice(0, 24)} keyOf={(i) => i.id} render={(i) => <PosterCard item={i} />} />
        {lib.categories.map((c) => (
          <Row key={c.slug} title={category(c.name)} data={lib.items.filter((i) => i.category === c.slug).sort(byAdded)} keyOf={(i) => i.id} render={(i) => <PosterCard item={i} />} />
        ))}
        {topGenres.map((g) => (
          <Row key={g} title={genre(g)} data={lib.items.filter((i) => i.genres.includes(g))} keyOf={(i) => i.id} render={(i) => <PosterCard item={i} />} />
        ))}
        {!lib.items.length ? <Text style={[styles.empty, f('regular')]}>{t('home.empty')}</Text> : null}
        <Credit />
        <View style={{ height: s(40) }} />
      </ScrollView>
      <TopBar categories={lib.categories} />
      {exitAsk ? <ExitDialog onClose={() => setExitAsk(false)} /> : null}
    </View>
  );
}

// "Exit DriveStream?" — styled like the account menu; Exit has the TV focus.
function ExitDialog({ onClose }: { onClose: () => void }) {
  const { t, f, isRTL } = useI18n();
  const btn = (label: string, onPress: () => void, first?: boolean) => (
    <Focusable style={[styles.dlgBtn, first && styles.dlgPrimary]} hasTVPreferredFocus={first} onPress={onPress}>
      {(focused) => <Text style={[styles.dlgBtnText, f('medium'), (first || focused) && focusInk]}>{label}</Text>}
    </Focusable>
  );
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      {/* A Modal is its own native root, so it needs its own layout direction. */}
      <View style={[styles.backdrop, { direction: isRTL ? 'rtl' : 'ltr' }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} focusable={false} />
        <View style={styles.sheet}>
          <Text style={[styles.sheetTitle, f('bold')]}>{t('exit.title')}</Text>
          <View style={styles.dlgRow}>
            {btn(t('common.cancel'), onClose)}
            {btn(t('exit.exit'), () => BackHandler.exitApp(), true)}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 24 },
  error: { color: '#fff', fontSize: s(16), textAlign: 'center' },
  empty: { color: colors.muted, textAlign: 'center', padding: s(30), fontSize: s(15) },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: s(20) },
  sheet: { width: '100%', maxWidth: s(340), backgroundColor: '#262626', borderRadius: 8, padding: s(16), gap: s(14) },
  sheetTitle: { color: '#fff', fontSize: s(18), fontWeight: '800' },
  dlgRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: s(10) },
  dlgBtn: { paddingVertical: s(9), paddingHorizontal: s(20), borderRadius: 4, backgroundColor: 'rgba(109,109,110,0.7)' },
  dlgPrimary: { backgroundColor: '#fff' },
  dlgBtnText: { color: '#fff', fontSize: s(15), fontWeight: '700' },
});

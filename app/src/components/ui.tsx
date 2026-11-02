import { useState, type ReactNode } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { backdropSource, posterSource, type ContinueEntry, type Item } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { colors, display, isTV, qualityBadge, s } from '../lib/theme';

// How a Focusable looks while the TV remote is on it (no outline rings, as on the website):
//   fill – buttons, chips, tabs, menu rows: white with black text, slightly bigger
//   lift – posters and wide cards: bigger, with a shadow
//   none – only the caller's focusStyle
export type FocusLook = 'fill' | 'lift' | 'none';

// Black text on a focused 'fill' Focusable (children given as a function get `focused`).
export const focusInk = { color: '#000' } as const;

// Pressable with the TV focus look. Children may be a function of `focused`, so text can
// turn black on the white fill.
export function Focusable({ style, focusStyle, look = 'fill', children, onFocus, onBlur, ...rest }: Omit<PressableProps, 'children' | 'style'> & {
  style?: StyleProp<ViewStyle>;
  focusStyle?: StyleProp<ViewStyle>;
  look?: FocusLook;
  children: ReactNode | ((focused: boolean) => ReactNode);
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      {...rest}
      onFocus={(e) => { setFocused(true); onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); onBlur?.(e); }}
      style={({ pressed }) => [
        style,
        pressed && { opacity: 0.8 },
        focused && [look === 'fill' ? styles.fill : look === 'lift' ? styles.lift : null, focusStyle],
      ]}>
      {typeof children === 'function' ? children(focused) : children}
    </Pressable>
  );
}

export function Button({ label, icon, onPress, kind = 'primary', small, hasTVPreferredFocus }: {
  label: string; icon?: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger'; small?: boolean; hasTVPreferredFocus?: boolean;
}) {
  const { f } = useI18n();
  const bg = kind === 'primary' ? '#fff' : kind === 'danger' ? '#8f1d1d' : 'rgba(109,109,110,0.7)';
  const fg = kind === 'primary' ? '#000' : '#fff';
  return (
    <Focusable onPress={onPress} hasTVPreferredFocus={hasTVPreferredFocus}
      style={[styles.btn, { backgroundColor: bg, paddingVertical: s(small ? 7 : 10), paddingHorizontal: s(small ? 14 : 22) }]}
      focusStyle={{ transform: [{ scale: 1.08 }] }}>
      {(focused) => <Text style={[styles.btnText, f('medium'), { color: fg, fontSize: s(small ? 14 : 16) }, focused && focusInk]}>{icon ? `${icon}  ` : ''}{label}</Text>}
    </Focusable>
  );
}

// Required by the DriveStream license (LICENSE §3, NOTICE): keep this credit visible.
// tools/check-credit.mjs and the server's startup check look for it.
export function Credit() {
  const { t, f } = useI18n();
  return (
    <Text style={[styles.credit, f('regular')]}>{t('credit.by')}<Text style={[styles.creditName, f('medium')]}>Hesham Elgamal</Text></Text>
  );
}

export function Meta({ item, extra }: { item: Item; extra?: string[] }) {
  const { f, seasons, episodes, runtime } = useI18n();
  const bits: { t: string; c?: string; chip?: boolean }[] = [];
  if (item.rating) bits.push({ t: `★ ${item.rating.toFixed(1)}`, c: colors.green });
  if (item.year) bits.push({ t: String(item.year) });
  if (item.kind === 'show' && item.episodeCount) bits.push({ t: (item.seasonCount || 0) > 1 ? seasons(item.seasonCount || 0) : episodes(item.episodeCount) });
  else if (item.durationMs) bits.push({ t: runtime(Math.round(item.durationMs / 60000)) });
  const q = qualityBadge(item.quality);
  if (q) bits.push({ t: q, chip: true });
  for (const e of extra || []) bits.push({ t: e, chip: true });
  return (
    <View style={styles.meta}>
      {bits.map((b, i) => (
        <Text key={i} style={[styles.metaText, !b.c && !b.chip && f('regular'), b.c ? { color: b.c, fontWeight: '700' } : null, b.chip && styles.chip]}>{b.t}</Text>
      ))}
    </View>
  );
}

function Fallback({ item }: { item: Item }) {
  return (
    <LinearGradient colors={['#2c2c2c', '#181818', '#3b0d10']} style={styles.fallback}>
      <Text style={styles.fallbackTitle} numberOfLines={3}>{item.title}</Text>
      {item.year ? <Text style={styles.fallbackYear}>{item.year}</Text> : null}
    </LinearGradient>
  );
}

const POSTER_W = s(isTV ? 98 : 112); // TV: about 7 posters across a 1080p screen
const LAND_W = s(isTV ? 200 : 230);

const isNew = (it: Item) => !!it.addedAt && Date.now() - Date.parse(it.addedAt) < 10 * 86400_000;

export function PosterCard({ item, width = POSTER_W, hasTVPreferredFocus }: { item: Item; width?: number; hasTVPreferredFocus?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [focused, setFocused] = useState(false); // TV: the remote is on this poster
  const { t, f } = useI18n();
  const src = posterSource(item);
  return (
    <Focusable onPress={() => router.push(`/title/${item.id}`)} hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={[styles.poster, { width }]} look="lift">
      {src && !failed ? <Image source={src} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} onError={() => setFailed(true)} /> : <Fallback item={item} />}
      {isNew(item) ? <Text style={[styles.ribbon, f('bold')]}>{t('card.new')}</Text> : null}
      {isTV && focused ? <QuickInfo item={item} /> : null}
    </Focusable>
  );
}

// Title and quick details over a poster while the TV remote is on it.
function QuickInfo({ item }: { item: Item }) {
  const { f, ta, seasons, episodes, runtime, genre } = useI18n();
  const bits: string[] = [];
  if (item.year) bits.push(String(item.year));
  if (item.kind === 'show' && item.episodeCount) bits.push((item.seasonCount || 0) > 1 ? seasons(item.seasonCount || 0) : episodes(item.episodeCount, true));
  else if (item.durationMs) bits.push(runtime(Math.round(item.durationMs / 60000)));
  const q = qualityBadge(item.quality);
  if (q) bits.push(q);
  return (
    <LinearGradient colors={['transparent', 'rgba(0,0,0,0.8)', 'rgba(0,0,0,0.95)']} locations={[0, 0.45, 1]} style={styles.quick} pointerEvents="none">
      <Text style={[styles.quickTitle, ta]} numberOfLines={2}>{item.title}</Text>
      <Text style={[styles.quickMeta, f('regular'), ta]} numberOfLines={1}>
        {item.rating ? <Text style={{ color: colors.green, fontWeight: '800' }}>★ {item.rating.toFixed(1)}  </Text> : null}
        {bits.join(' · ')}
      </Text>
      {item.genres.length ? <Text style={[styles.quickGenres, f('regular'), ta]} numberOfLines={1}>{item.genres.slice(0, 3).map(genre).join(' • ')}</Text> : null}
    </LinearGradient>
  );
}

export function ContinueCard({ entry, onRemove }: { entry: ContinueEntry; onRemove: (e: ContinueEntry) => void }) {
  const { t, f, episodeLabel } = useI18n();
  const it = entry.item;
  const pct = entry.d ? Math.min(100, (entry.t / entry.d) * 100) : 0;
  const src = backdropSource(it);
  return (
    <View style={{ width: LAND_W }}>
      <Focusable onPress={() => router.push(`/watch/${entry.fileId}`)} onLongPress={() => onRemove(entry)}
        style={styles.land} look="lift" focusStyle={{ transform: [{ scale: 1.05 }] }}>
        {src ? <Image source={src} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} /> : <Fallback item={it} />}
        <View style={styles.playBadge}><Text style={styles.playIcon}>▶</Text></View>
        {pct ? <View style={styles.bar}><View style={[styles.barFill, { width: `${pct}%` }]} /></View> : null}
        {!isTV ? (
          <Pressable hitSlop={10} onPress={() => onRemove(entry)} style={styles.removeBtn} accessibilityLabel={t('card.removeA11y', { title: it.title })}>
            <Text style={styles.removeText}>✕</Text>
          </Pressable>
        ) : null}
      </Focusable>
      <Text style={styles.landTitle} numberOfLines={1}>{it.title}</Text>
      {entry.label ? <Text style={[styles.landSub, f('regular')]}>{entry.upNext ? t('card.upNext', { label: episodeLabel(entry.label) }) : episodeLabel(entry.label)}</Text> : null}
    </View>
  );
}

export function Row<T>({ title, data, render, keyOf }: { title: string; data: T[]; render: (x: T, i: number) => ReactNode; keyOf: (x: T) => string }) {
  const { f, isRTL } = useI18n();
  if (!data.length) return null;
  return (
    <View style={styles.row}>
      <Text style={[styles.rowTitle, f('bold')]}>{title}</Text>
      {/* The row itself keeps flowing left-to-right in Arabic: FlatList's windowing follows the
          app-wide I18nManager direction, not this view's, and loses track of cells in a mirrored
          row. Each card is laid out right-to-left again. */}
      <FlatList
        style={isRTL ? styles.ltr : undefined}
        horizontal
        data={data}
        keyExtractor={keyOf}
        renderItem={({ item, index }) => (isRTL ? <View style={styles.rtl}>{render(item, index)}</View> : <>{render(item, index)}</>)}
        contentContainerStyle={styles.rowContent}
        ItemSeparatorComponent={() => <View style={{ width: s(8) }} />}
        showsHorizontalScrollIndicator={false}
        removeClippedSubviews={false}
      />
    </View>
  );
}

export function Hero({ item, resumeFileId }: { item: Item; resumeFileId?: string }) {
  const { t, f, ta, isRTL } = useI18n();
  const src = backdropSource(item, true);
  return (
    <View style={styles.hero}>
      {src ? <Image source={src} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="top" /> : null}
      {/* Darkest behind the text, which sits on the right in Arabic. */}
      <LinearGradient colors={['rgba(0,0,0,0.85)', 'rgba(0,0,0,0.3)', 'transparent']} start={{ x: isRTL ? 1 : 0, y: 0.5 }} end={{ x: isRTL ? 0 : 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={['transparent', 'rgba(20,20,20,0.6)', colors.bg]} locations={[0.45, 0.75, 1]} style={StyleSheet.absoluteFill} />
      <View style={styles.heroContent}>
        <Text style={[styles.heroTitle, ta]} numberOfLines={2}>{item.title}</Text>
        <Meta item={item} />
        {item.overview ? <Text style={[styles.heroOverview, f('regular'), ta]} numberOfLines={isTV ? 3 : 2}>{item.overview}</Text> : null}
        <View style={styles.actions}>
          <Button label={resumeFileId ? t('hero.resume') : t('hero.play')} icon="▶" hasTVPreferredFocus
            onPress={() => (resumeFileId ? router.push(`/watch/${resumeFileId}`) : router.push(`/title/${item.id}?play=1`))} />
          <Button label={t('hero.moreInfo')} icon="ⓘ" kind="secondary" onPress={() => router.push(`/title/${item.id}`)} />
        </View>
      </View>
    </View>
  );
}

export const styles = StyleSheet.create({
  fill: { backgroundColor: colors.focus, transform: [{ scale: 1.05 }] },
  lift: { transform: [{ scale: 1.08 }], elevation: 12, shadowColor: '#000', shadowOpacity: 0.7, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  ltr: { direction: 'ltr' },
  rtl: { direction: 'rtl' },
  btn: { borderRadius: 4, flexDirection: 'row', alignItems: 'center' },
  btnText: { fontWeight: '700' },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: s(10), marginTop: s(6) },
  metaText: { color: '#ddd', fontSize: s(14) },
  chip: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)', paddingHorizontal: 5, borderRadius: 3, fontSize: s(11) },
  fallback: { flex: 1, justifyContent: 'flex-end', padding: s(10), gap: 2 },
  fallbackTitle: { color: '#fff', fontWeight: '800', fontSize: s(15) },
  fallbackYear: { color: colors.muted, fontSize: s(12) },
  poster: { aspectRatio: 2 / 3, borderRadius: 4, overflow: 'hidden', backgroundColor: colors.panel },
  credit: { color: '#8c8c8c', fontSize: s(13), textAlign: 'center', marginTop: s(12) },
  creditName: { color: '#d0d0d0', fontWeight: '600' },
  quick: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: s(24), paddingHorizontal: s(6), paddingBottom: s(6), gap: 1 },
  quickTitle: { color: '#fff', fontWeight: '800', fontSize: s(isTV ? 10.5 : 14) },
  quickMeta: { color: '#ddd', fontSize: s(isTV ? 8.5 : 11) },
  quickGenres: { color: '#bbb', fontSize: s(isTV ? 8 : 10) },
  // start/end rather than left/right so the badges mirror in Arabic.
  ribbon: { position: 'absolute', top: s(8), start: 0, backgroundColor: colors.red, color: '#fff', fontSize: s(10), fontWeight: '800', paddingHorizontal: 6, paddingVertical: 2 },
  land: { aspectRatio: 16 / 9, borderRadius: 4, overflow: 'hidden', backgroundColor: colors.panel },
  playBadge: { position: 'absolute', alignSelf: 'center', top: '50%', marginTop: -s(20), width: s(40), height: s(40), borderRadius: s(20), borderWidth: 2, borderColor: '#fff', backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  playIcon: { color: '#fff', fontSize: s(16), marginLeft: 3 },
  bar: { position: 'absolute', left: 8, right: 8, bottom: 8, height: 4, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 2, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: colors.red },
  removeBtn: { position: 'absolute', top: 6, end: 6, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(20,20,20,0.8)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.7)', alignItems: 'center', justifyContent: 'center' },
  removeText: { color: '#fff', fontSize: 13 },
  landTitle: { color: '#fff', fontWeight: '700', fontSize: s(14), marginTop: 6 },
  landSub: { color: colors.muted, fontSize: s(12) },
  row: { marginBottom: s(22) },
  rowTitle: { color: '#e5e5e5', fontWeight: '700', fontSize: s(17), marginStart: s(16), marginBottom: s(8) },
  rowContent: { paddingHorizontal: s(16), paddingVertical: s(6) },
  hero: { height: s(isTV ? 340 : 480), justifyContent: 'flex-end' },
  heroContent: { padding: s(20), paddingBottom: s(28), maxWidth: isTV ? '55%' : '100%' },
  heroTitle: { color: '#fff', fontFamily: display, fontSize: s(48), lineHeight: s(48), letterSpacing: 0.5 },
  heroOverview: { color: '#eee', fontSize: s(14), marginTop: s(10), lineHeight: s(20) },
  actions: { flexDirection: 'row', gap: s(10), marginTop: s(16) },
});

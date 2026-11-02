import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, backdropSource, posterSource, stillSource, type Title } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { colors, display, fmtSize, isTV, qualityBadge, s } from '../../lib/theme';
import { Button, Focusable, focusInk, Meta } from '../../components/ui';

export default function TitleScreen() {
  const { id, play } = useLocalSearchParams<{ id: string; play?: string }>();
  const [t, setT] = useState<Title | null>(null);
  const [season, setSeason] = useState<number | null>(null);
  const [error, setError] = useState('');
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const { t: tr, f, ta, isRTL, genre, season: tSeason, episodeLabel, runtime } = useI18n();

  useFocusEffect(useCallback(() => {
    api<Title>(`/api/title/${id}`).then((r) => {
      if (play) return router.replace(`/watch/${r.resume.fileId}`);
      setT(r);
      setSeason((cur) => cur ?? r.seasons?.find((x) => x.episodes.some((e) => e.fileId === r.resume.fileId))?.season ?? r.seasons?.[0]?.season ?? null);
    }).catch((e) => setError(e.message));
  }, [id, play]));

  if (!t) {
    return <View style={styles.center}>{error ? <Text style={[styles.text, f('regular')]}>{error}</Text> : <ActivityIndicator color={colors.red} size="large" />}</View>;
  }

  const resuming = t.resume.t > 0;
  const playLabel = resuming
    ? (t.kind === 'show' && t.resume.label ? tr('title.resumeEp', { label: episodeLabel(t.resume.label) }) : tr('title.resume'))
    : t.kind === 'show' && t.resume.label && t.resume.label !== 'S1:E1' ? tr('title.playEp', { label: episodeLabel(t.resume.label) }) : tr('title.play');
  const poster = posterSource(t);
  // The artwork fills the first screen, with the details along its bottom edge (as on Netflix).
  // A tall phone screen gets the portrait poster, which a wide backdrop would crop badly.
  const portrait = win.height > win.width;
  const backdrop = (portrait && posterSource(t, true)) || backdropSource(t, true);
  const cur = t.seasons?.find((x) => x.season === season);

  return (
    <ScrollView style={{ backgroundColor: colors.bg }}>
      <View style={[styles.hero, { minHeight: win.height }]}>
        {backdrop ? <Image source={backdrop} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="top" /> : null}
        <LinearGradient colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0)', 'rgba(20,20,20,0.85)', colors.bg]} locations={[0, 0.22, 0.62, 1]} style={StyleSheet.absoluteFill} />
        <View style={[styles.heroInner, { paddingTop: insets.top + s(56), paddingBottom: s(isTV ? 36 : 28) }]}>
          {isTV && poster ? <Image source={poster} style={styles.poster} contentFit="cover" /> : null}
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, ta]}>{t.title}</Text>
            <Meta item={t} extra={t.kind === 'movie' && t.subs?.length ? ['CC'] : []} />
            <View style={styles.actions}>
              <Button label={playLabel} icon="▶" hasTVPreferredFocus onPress={() => router.push(`/watch/${t.resume.fileId}`)} />
              {resuming ? <Button label={tr('title.startOver')} kind="secondary" onPress={() => router.push(`/watch/${t.resume.fileId}?from=0`)} /> : null}
            </View>
            {t.overview ? <Text style={[styles.overview, f('regular'), ta]}>{t.overview}</Text> : null}
            {t.genres.length ? <Text style={[styles.facts, f('regular'), ta]}><Text style={[styles.muted, f('medium')]}>{tr('title.genres')}</Text>{t.genres.map(genre).join(isRTL ? '، ' : ', ')}</Text> : null}
            {t.kind === 'movie' && t.versions?.length ? (
              <Text style={[styles.facts, f('regular'), ta]}><Text style={[styles.muted, f('medium')]}>{tr('title.availableIn')}</Text>
                {t.versions.map((v) => `${v.height ? `${v.height}p` : tr('player.original')}${fmtSize(v.size) ? ` (${fmtSize(v.size)})` : ''}`).join(' · ')}</Text>
            ) : null}
            {t.kind === 'movie' && t.subs?.length ? <Text style={[styles.facts, f('regular'), ta]}><Text style={[styles.muted, f('medium')]}>{tr('title.subtitles')}</Text>{t.subs.map((x) => x.label).join(isRTL ? '، ' : ', ')}</Text> : null}
          </View>
        </View>
      </View>

      {t.seasons ? (
        <View style={styles.section}>
          <Text style={[styles.h2, f('bold')]}>{tr('title.episodes')}</Text>
          {t.seasons.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: s(8), paddingVertical: s(8) }}>
              {t.seasons.map((x) => (
                <Focusable key={x.season} onPress={() => setSeason(x.season)} style={[styles.seasonTab, x.season === season && styles.seasonOn]}>
                  {(focused) => <Text style={[styles.seasonText, f('medium'), (x.season === season || focused) && focusInk]}>{tSeason(x.name)}</Text>}
                </Focusable>
              ))}
            </ScrollView>
          ) : null}
          {cur?.episodes.map((e) => {
            const still = stillSource(e);
            return (
              <Focusable key={e.fileId} onPress={() => router.push(`/watch/${e.fileId}`)} style={[styles.ep, e.fileId === t.resume.fileId && styles.epCurrent]} focusStyle={styles.epFocus}>
                {(focused) => (<>
                <View style={styles.epImg}>
                  {still ? <Image source={still} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
                  {e.progress ? <View style={styles.bar}><View style={[styles.barFill, { width: `${Math.round(e.progress * 100)}%` }]} /></View> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.epName, ta, focused && focusInk]} numberOfLines={1}>{e.episode}. {e.name}</Text>
                  <Text style={[styles.muted, f('regular'), ta, focused && styles.inkMuted]}>{[runtime(e.runtimeMin), qualityBadge(e.quality), e.hasSubs ? 'CC' : ''].filter(Boolean).join(' · ')}</Text>
                  {e.overview ? <Text style={[styles.epOverview, f('regular'), ta, focused && styles.inkMuted]} numberOfLines={isTV ? 2 : 3}>{e.overview}</Text> : null}
                </View>
                </>)}
              </Focusable>
            );
          })}
        </View>
      ) : null}
      <View style={{ height: s(40) }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  text: { color: '#fff' },
  hero: { justifyContent: 'flex-end' },
  heroInner: { flexDirection: 'row', gap: s(24), padding: s(20), alignItems: 'flex-end' },
  poster: { width: s(150), aspectRatio: 2 / 3, borderRadius: 6 },
  title: { color: '#fff', fontFamily: display, fontSize: s(46), lineHeight: s(46), letterSpacing: 0.5, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 10 },
  actions: { flexDirection: 'row', gap: s(10), marginTop: s(16), flexWrap: 'wrap' },
  overview: { color: '#eee', fontSize: s(15), lineHeight: s(22), marginTop: s(16), maxWidth: s(760) },
  facts: { color: '#ddd', fontSize: s(13), marginTop: s(6) },
  muted: { color: colors.muted, fontSize: s(13) },
  section: { paddingHorizontal: s(16) },
  h2: { color: '#fff', fontSize: s(20), fontWeight: '700', marginBottom: s(6) },
  seasonTab: { paddingHorizontal: s(14), paddingVertical: s(7), borderRadius: 999, borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)' },
  seasonOn: { backgroundColor: '#fff', borderColor: '#fff' },
  seasonText: { color: '#fff', fontWeight: '700', fontSize: s(14) },
  ep: { flexDirection: 'row', gap: s(14), alignItems: 'center', paddingVertical: s(12), paddingHorizontal: s(8), borderBottomWidth: 1, borderBottomColor: '#333', borderRadius: 4 },
  epFocus: { transform: [{ scale: 1.02 }] }, // a full-width row only grows a little
  inkMuted: { color: '#333' },
  epCurrent: { backgroundColor: '#222' },
  epImg: { width: s(isTV ? 200 : 130), aspectRatio: 16 / 9, borderRadius: 4, overflow: 'hidden', backgroundColor: colors.panel2 },
  bar: { position: 'absolute', left: 6, right: 6, bottom: 6, height: 3, backgroundColor: 'rgba(255,255,255,0.3)' },
  barFill: { height: '100%', backgroundColor: colors.red },
  epName: { color: '#fff', fontSize: s(15), fontWeight: '700' },
  epOverview: { color: '#ccc', fontSize: s(13), marginTop: 4, lineHeight: s(18) },
});

import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, type Library } from '../lib/api';
import { arabicGenre, useI18n } from '../lib/i18n';
import { colors, isTV, s } from '../lib/theme';
import { PosterCard } from '../components/ui';
import { TopBar } from '../components/TopBar';

export default function Search() {
  const [lib, setLib] = useState<Library | null>(null);
  const [q, setQ] = useState('');
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { t, f, ta, isRTL } = useI18n();
  useEffect(() => { api<Library>('/api/library').then(setLib).catch(() => {}); }, []);

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = !lib || !words.length ? [] : lib.items.filter((it) => {
    // Genre names match in both languages ("رعب" finds Horror), whatever the interface language.
    const hay = [it.title, it.year, ...it.genres, ...it.genres.map(arabicGenre), it.overview].join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  const cols = Math.max(3, Math.floor((width - s(24)) / s(isTV ? 170 : 120)));
  const cardW = (width - s(32) - (cols - 1) * s(8)) / cols;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        key={cols}
        data={hits}
        numColumns={cols}
        keyExtractor={(i) => i.id}
        columnWrapperStyle={{ gap: s(8) }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: s(16), paddingTop: insets.top + s(64), gap: s(10) }}
        ListHeaderComponent={
          <>
            <TextInput autoFocus value={q} onChangeText={setQ} placeholder={t('search.placeholder')} placeholderTextColor="#8c8c8c"
              style={[styles.input, f('regular'), isRTL && { textAlign: 'right' }]} autoCorrect={false} returnKeyType="search" />
            {words.length && lib ? <Text style={[styles.heading, f('bold'), ta]}>{t(hits.length ? 'search.results' : 'search.none', { q: q.trim() })}</Text> : null}
          </>
        }
        renderItem={({ item }) => <PosterCard item={item} width={cardW} />}
      />
      {lib ? <TopBar categories={lib.categories} active="search" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { backgroundColor: '#2b2b2b', color: '#fff', fontSize: s(17), paddingHorizontal: s(14), paddingVertical: s(12), borderRadius: 4, marginBottom: s(12) },
  heading: { color: '#ddd', fontSize: s(17), fontWeight: '700', marginBottom: s(10) },
});

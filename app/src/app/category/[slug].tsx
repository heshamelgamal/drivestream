import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, type Item, type Library } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { colors, display, isTV, s } from '../../lib/theme';
import { Focusable, focusInk, PosterCard } from '../../components/ui';
import { TopBar } from '../../components/TopBar';

// Sort orders, as on the website.
const SORTS = {
  added: (a: Item, b: Item) => (b.addedAt || '').localeCompare(a.addedAt || ''),
  title: (a: Item, b: Item) => a.title.localeCompare(b.title),
  year: (a: Item, b: Item) => (b.year || 0) - (a.year || 0),
  rating: (a: Item, b: Item) => (b.rating || 0) - (a.rating || 0),
} as const;
type Sort = keyof typeof SORTS;
const SORT_LABELS = { added: 'sort.added', title: 'sort.title', year: 'sort.year', rating: 'sort.rating' } as const;

export default function Category() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [lib, setLib] = useState<Library | null>(null);
  const [genre, setGenre] = useState('');
  const [sort, setSort] = useState<Sort>('added');
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { t, f, ta, isRTL, category, genre: tGenre, lang } = useI18n();
  useFocusEffect(useCallback(() => { api<Library>('/api/library').then(setLib).catch(() => {}); }, []));

  if (!lib) return <View style={styles.center}><ActivityIndicator color={colors.red} size="large" /></View>;
  const cat = lib.categories.find((c) => c.slug === slug);
  const all = lib.items.filter((i) => i.category === slug).sort(SORTS[sort]);
  const genres = [...new Set(all.flatMap((i) => i.genres))].sort((a, b) => tGenre(a).localeCompare(tGenre(b), lang));
  const list = all.filter((i) => !genre || i.genres.includes(genre));
  const cols = Math.max(3, Math.floor((width - s(24)) / s(isTV ? 170 : 120)));
  const cardW = (width - s(32) - (cols - 1) * s(8)) / cols;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        key={cols}
        data={list}
        numColumns={cols}
        keyExtractor={(i) => i.id}
        columnWrapperStyle={{ gap: s(8) }}
        contentContainerStyle={{ padding: s(16), paddingTop: insets.top + s(64), gap: s(10) }}
        ListHeaderComponent={
          <View style={{ marginBottom: s(8) }}>
            <Text style={isRTL ? [styles.h1, styles.h1Ar] : styles.h1}>{cat ? category(cat.name) : t('category.fallback')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              <Text style={[styles.chipsLabel, f('medium')]}>{t('sort.label')}</Text>
              {(Object.keys(SORTS) as Sort[]).map((k) => (
                <Focusable key={k} onPress={() => setSort(k)} style={[styles.chip, k === sort && styles.chipOn]}>
                  {(focused) => <Text style={[styles.chipText, f('medium'), (k === sort || focused) && focusInk]}>{t(SORT_LABELS[k])}</Text>}
                </Focusable>
              ))}
            </ScrollView>
            {genres.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {['', ...genres].map((g) => (
                  <Focusable key={g || 'all'} onPress={() => setGenre(g)} style={[styles.chip, g === genre && styles.chipOn]}>
                    {(focused) => <Text style={[styles.chipText, f('medium'), (g === genre || focused) && focusInk]}>{g ? tGenre(g) : t('category.all')}</Text>}
                  </Focusable>
                ))}
              </ScrollView>
            ) : null}
          </View>
        }
        ListEmptyComponent={<Text style={[styles.empty, f('regular'), ta]}>{t('category.empty')}</Text>}
        renderItem={({ item, index }) => <PosterCard item={item} width={cardW} hasTVPreferredFocus={index === 0} />}
      />
      <TopBar categories={lib.categories} active={slug} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  h1: { color: '#fff', fontFamily: display, fontSize: s(40), letterSpacing: 0.5 },
  h1Ar: { fontFamily: 'ThmanyahSans-Bold', fontSize: s(30), letterSpacing: 0 },
  chips: { gap: s(8), paddingVertical: s(6), alignItems: 'center' },
  chipsLabel: { color: colors.muted, fontSize: s(14), fontWeight: '600', marginEnd: s(4) },
  chip: { paddingHorizontal: s(14), paddingVertical: s(6), borderRadius: 999, borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)' },
  chipOn: { backgroundColor: '#fff', borderColor: '#fff' },
  chipText: { color: '#ddd', fontSize: s(14), fontWeight: '600' },
  empty: { color: colors.muted, fontSize: s(15), padding: s(20) },
});

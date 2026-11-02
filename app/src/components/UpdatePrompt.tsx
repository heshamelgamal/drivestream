// "Update available" window: on each fresh launch the app asks the server for the newest
// build of itself (GET /api/apps) and, when there's a newer one, says what's new and offers
// Update (download the APK here, then hand it to Android's installer) or Later (ask again
// next launch). The notes come from downloads/releases.json on the server.
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { getServer } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { isTV, s } from '../lib/theme';
import { Focusable, focusInk } from './ui';

type Release = { version: string; url: string; size: number; notes: { en?: string[]; ar?: string[] } | null };

const newer = (a: string, b: string) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
};

let checked = false; // once per launch: coming back from the background doesn't ask again

export function UpdatePrompt() {
  const { t, f, lang, isRTL } = useI18n();
  const [release, setRelease] = useState<Release | null>(null);
  const [state, setState] = useState<'ask' | 'downloading' | 'installing' | 'failed'>('ask');
  const [pct, setPct] = useState(0);

  useEffect(() => {
    if (checked) return;
    checked = true;
    const current = Constants.expoConfig?.version;
    fetch(`${getServer()}/api/apps`)
      .then((r) => r.json())
      .then((apps: Record<string, Release>) => {
        const latest = apps[isTV ? 'TV' : 'Phone'];
        if (latest && current && newer(latest.version, current)) setRelease(latest);
      })
      .catch(() => {});
  }, []);

  if (!release) return null;
  const notes = (release.notes && (release.notes[lang] || release.notes.en)) || [];
  const later = () => setRelease(null);

  const update = async () => {
    setState('downloading');
    setPct(0);
    const file = `${FileSystem.cacheDirectory}DriveStream-${release.version}.apk`;
    try {
      await FileSystem.deleteAsync(file, { idempotent: true });
      const dl = FileSystem.createDownloadResumable(`${getServer()}${release.url}`, file, {}, (p) => {
        if (p.totalBytesExpectedToWrite > 0) setPct(Math.round((p.totalBytesWritten / p.totalBytesExpectedToWrite) * 100));
      });
      const done = await dl.downloadAsync();
      if (!done || done.status !== 200) throw new Error('download failed');
      setState('installing');
      // Android installs it from here, asking once to allow DriveStream to install apps.
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: await FileSystem.getContentUriAsync(done.uri),
        type: 'application/vnd.android.package-archive',
        flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
      });
    } catch {
      setState('failed');
    }
  };

  const btn = (label: string, onPress: () => void, primary?: boolean) => (
    <Focusable style={[styles.btn, primary && styles.primary]} hasTVPreferredFocus={primary} onPress={onPress}>
      {(focused) => <Text style={[styles.btnText, f('medium'), (primary || focused) && focusInk]}>{label}</Text>}
    </Focusable>
  );

  return (
    <Modal transparent visible animationType="fade" onRequestClose={later} supportedOrientations={['portrait', 'landscape']}>
      {/* A Modal is its own native root, so it needs its own layout direction. */}
      <View style={[styles.backdrop, { direction: isRTL ? 'rtl' : 'ltr' }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={later} focusable={false} />
        <View style={styles.sheet}>
          <Text style={[styles.title, f('bold')]}>{t('update.title')}</Text>
          <Text style={[styles.sub, f('regular')]}>{t('update.version', { version: release.version })}</Text>
          {notes.length ? (
            <View style={styles.notes}>
              {notes.map((n, i) => (
                <Text key={i} style={[styles.note, f('regular')]}>•  {n}</Text>
              ))}
            </View>
          ) : null}
          {state === 'downloading' ? (
            <View style={styles.bar}><View style={[styles.barFill, { width: `${pct}%` }]} /></View>
          ) : null}
          {state !== 'ask' ? (
            <Text style={[styles.sub, f('regular'), state === 'failed' && styles.error]}>
              {state === 'downloading' ? t('update.downloading', { pct }) : state === 'installing' ? t('update.installing') : t('update.failed')}
            </Text>
          ) : null}
          <View style={styles.row}>
            {btn(t('update.later'), later)}
            {state === 'downloading' ? null : btn(t('update.now'), update, true)}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: s(20) },
  sheet: { width: '100%', maxWidth: s(420), backgroundColor: '#262626', borderRadius: 8, padding: s(18), gap: s(12) },
  title: { color: '#fff', fontSize: s(19), fontWeight: '800' },
  sub: { color: '#bbb', fontSize: s(14) },
  error: { color: '#ff6b6b' },
  notes: { gap: s(6) },
  note: { color: '#fff', fontSize: s(14), lineHeight: s(20) },
  bar: { height: s(4), borderRadius: 2, backgroundColor: '#444', overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: '#e50914' },
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: s(10), marginTop: s(4) },
  btn: { paddingVertical: s(9), paddingHorizontal: s(20), borderRadius: 4, backgroundColor: 'rgba(109,109,110,0.7)' },
  primary: { backgroundColor: '#fff' },
  btnText: { color: '#fff', fontSize: s(15), fontWeight: '700' },
});

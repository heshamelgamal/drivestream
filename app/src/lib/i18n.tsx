// Interface language (English / Arabic): strings, fonts and layout direction.
// The signed-in user's `lang` (stored on the server) wins; before sign-in the last
// language picked on this device is used, falling back to English.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { TextStyle } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { api, type Lang, type User } from './api';
import { useAuth } from './auth';

export type { Lang };

const en = {
  // nav / top bar
  'nav.home': 'Home',
  'nav.search': 'Search',
  'menu.signedInAs': 'Signed in as @{username}',
  'menu.linkDevice': 'Link a device',
  'menu.signOut': 'Sign out',
  'menu.account': 'Account settings',
  'exit.title': 'Exit DriveStream?',
  'exit.exit': 'Exit',
  'update.title': 'Update available',
  'update.version': 'Version {version} is ready.',
  'update.now': 'Update',
  'update.later': 'Later',
  'update.downloading': 'Downloading… {pct}%',
  'update.installing': 'Opening the installer… If Android asks, allow DriveStream to install apps, then tap Install.',
  'update.failed': 'Couldn’t download the update. Try again later.',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.back': 'Back',
  'common.continue': 'Continue',
  'common.remove': 'Remove',
  'common.hide': 'Hide',
  'common.show': 'Show',
  // home / rows / cards
  'home.continue': 'Continue Watching',
  'home.recent': 'Recently Added',
  'home.empty': 'Your library is empty. Add movies and shows to your library folders.',
  'home.removeTitle': 'Remove from Continue Watching?',
  'card.new': 'NEW',
  'card.upNext': 'Up next · {label}',
  'card.removeA11y': 'Remove {title} from Continue Watching',
  'hero.play': 'Play',
  'hero.resume': 'Resume',
  'hero.moreInfo': 'More info',
  'credit.by': 'Developed by ',
  'meta.seasons': '{n} Seasons',
  'meta.episode': '{n} Episode',
  'meta.episodes': '{n} Episodes',
  'meta.ep': '{n} Ep.',
  'time.hm': '{h}h {m}m',
  'time.m': '{m}m',
  // login
  'login.signIn': 'Sign In',
  'login.signingIn': 'Signing in…',
  'login.username': 'Username',
  'login.password': 'Password',
  'login.showPassword': 'Show password',
  'login.hidePassword': 'Hide password',
  'login.server': 'Server address',
  'login.changeServer': 'Change server address',
  'login.hideServer': 'Hide server address',
  'login.withCode': 'Sign in with a code from another device',
  'login.hideCode': 'Hide the sign-in code',
  'login.cantReach': 'Can’t reach the server. Check the address and your connection.',
  'login.failed': 'Sign in failed',
  'code.title': 'Sign in with your phone',
  'code.help': 'Scan the QR code with your phone’s camera, or open DriveStream on another device, choose Link a device and enter:',
  'code.qrA11y': 'Sign-in QR code',
  'code.changes': 'The code changes every 10 minutes.',
  'code.cantReach': 'Can’t reach the server.',
  'code.failed': 'Couldn’t get a code',
  // link a device
  'link.title': 'Link a device',
  'link.help': 'Enter the code shown on your TV, or scan its QR code.',
  'link.badCode': 'The code has 6 letters and numbers, like ABC-123.',
  'link.checking': 'Checking…',
  'link.scan': 'Scan QR code',
  'link.camera': 'Allow camera access to scan the QR code.',
  'link.pointCamera': 'Point the camera at the QR code on the TV',
  'link.theTV': 'The TV',
  'link.confirmTitle': 'Sign in this TV?',
  'link.confirmA': '{device} will be signed in as ',
  'link.confirmB': ' (@{username}), with your own Continue Watching.',
  'link.signingIn': 'Signing in…',
  'link.signInTV': 'Sign in the TV',
  'link.done': 'Done ✓',
  'link.doneText': 'The TV is signing in now.',
  'link.backHome': 'Back to DriveStream',
  // search / category / title
  'search.placeholder': 'Titles, genres, years',
  'search.none': 'No results for “{q}”',
  'search.results': 'Results for “{q}”',
  'category.fallback': 'Category',
  'category.all': 'All',
  'category.empty': 'Nothing here yet',
  'sort.label': 'Sort',
  'sort.added': 'Recently added',
  'sort.title': 'A–Z',
  'sort.year': 'Newest',
  'sort.rating': 'Top rated',
  'title.play': 'Play',
  'title.playEp': 'Play {label}',
  'title.resume': 'Resume',
  'title.resumeEp': 'Resume {label}',
  'title.startOver': 'Start over',
  'title.genres': 'Genres: ',
  'title.subtitles': 'Subtitles: ',
  'title.availableIn': 'Available in: ',
  'title.episodes': 'Episodes',
  'season.n': 'Season {n}',
  'season.specials': 'Specials',
  // player
  'player.back': 'Back',
  'player.cast': 'Cast',
  'player.castA11y': 'Cast with Web Video Cast',
  'player.back10': 'Back 10 seconds',
  'player.fwd10': 'Forward 10 seconds',
  'player.play': 'Play',
  'player.pause': 'Pause',
  'player.speed': 'Speed ({v}x)',
  'player.episodes': 'Episodes',
  'player.subtitles': 'Subtitles',
  'player.subtitlesOn': 'Subtitles · {label}',
  'player.quality': 'Quality',
  'player.qualityOn': 'Quality · {label}',
  'player.nextEpisode': 'Next Episode',
  'player.skipIntro': 'Skip Intro',
  'player.next': 'Next: {label}',
  'player.nextIn': 'Next episode in {n}',
  'player.nextBtn': 'Next episode',
  'player.watchCredits': 'Watch credits',
  'player.hide': 'Hide',
  'player.playbackSpeed': 'Playback speed',
  'player.off': 'Off',
  'player.normal': '1x (Normal)',
  'player.noFfmpeg': 'Lower resolutions need ffmpeg on the server.',
  'player.nowPlaying': '  (now playing)',
  'player.original': 'Original',
  'player.converted': 'Converted',
  'player.convertedFallback': 'Converted · use if the original won’t play',
  'player.convertedSaves': 'Converted · saves data',
  'player.switching': 'Switching to {label}…',
  'player.cantPlay': 'This file can’t play on this device. Converting it…',
  'player.failed': 'Playback failed',
  'player.subsFailed': 'Couldn’t load subtitles',
  'player.installCast': 'Install Web Video Cast to cast to your TV',
  'player.seconds': '{n}s',
  // account settings
  'account.title': 'Account settings',
  'account.language': 'Language',
  'account.languageHelp': 'Choose the language for menus and buttons on all your devices.',
  'account.password': 'Change password',
  'account.current': 'Current password',
  'account.new': 'New password',
  'account.confirm': 'Confirm new password',
  'account.minLength': 'At least 6 characters.',
  'account.mismatch': 'The new passwords don’t match.',
  'account.changed': 'Password changed. Other devices have been signed out.',
  'account.failed': 'Couldn’t change the password',
  // messages from the server, shown translated
  'server.currentWrong': 'Current password is wrong.',
  'server.passwordShort': 'Password must be at least 6 characters.',
};

type Key = keyof typeof en;

const ar: Record<Key, string> = {
  'nav.home': 'الرئيسية',
  'nav.search': 'بحث',
  'menu.signedInAs': 'تم تسجيل الدخول باسم ‎@{username}',
  'menu.linkDevice': 'ربط جهاز',
  'menu.signOut': 'تسجيل الخروج',
  'menu.account': 'إعدادات الحساب',
  'exit.title': 'الخروج من DriveStream؟',
  'exit.exit': 'خروج',
  'update.title': 'يتوفر تحديث',
  'update.version': 'الإصدار {version} جاهز.',
  'update.now': 'تحديث',
  'update.later': 'لاحقًا',
  'update.downloading': 'جارٍ التنزيل… {pct}%',
  'update.installing': 'جارٍ فتح أداة التثبيت… إذا طلب Android ذلك، اسمح لـ DriveStream بتثبيت التطبيقات، ثم اضغط تثبيت.',
  'update.failed': 'تعذّر تنزيل التحديث. حاول مرة أخرى لاحقًا.',
  'common.cancel': 'إلغاء',
  'common.close': 'إغلاق',
  'common.back': 'رجوع',
  'common.continue': 'متابعة',
  'common.remove': 'إزالة',
  'common.hide': 'إخفاء',
  'common.show': 'إظهار',
  'home.continue': 'متابعة المشاهدة',
  'home.recent': 'أُضيف مؤخرًا',
  'home.empty': 'مكتبتك فارغة. أضف أفلامًا ومسلسلات إلى مجلدات المكتبة.',
  'home.removeTitle': 'إزالة من «متابعة المشاهدة»؟',
  'card.new': 'جديد',
  'card.upNext': 'التالي · {label}',
  'card.removeA11y': 'إزالة {title} من «متابعة المشاهدة»',
  'hero.play': 'تشغيل',
  'hero.resume': 'استئناف',
  'hero.moreInfo': 'مزيد من المعلومات',
  'credit.by': 'تطوير ',
  'meta.seasons': '{n} مواسم', // see seasons() / episodes() for Arabic number agreement
  'meta.episode': 'حلقة واحدة',
  'meta.episodes': '{n} حلقات',
  'meta.ep': '{n} حلقات',
  'time.hm': '{h} س {m} د',
  'time.m': '{m} د',
  'login.signIn': 'تسجيل الدخول',
  'login.signingIn': 'جارٍ تسجيل الدخول…',
  'login.username': 'اسم المستخدم',
  'login.password': 'كلمة المرور',
  'login.showPassword': 'إظهار كلمة المرور',
  'login.hidePassword': 'إخفاء كلمة المرور',
  'login.server': 'عنوان الخادم',
  'login.changeServer': 'تغيير عنوان الخادم',
  'login.hideServer': 'إخفاء عنوان الخادم',
  'login.withCode': 'تسجيل الدخول برمز من جهاز آخر',
  'login.hideCode': 'إخفاء رمز تسجيل الدخول',
  'login.cantReach': 'تعذّر الوصول إلى الخادم. تحقّق من العنوان ومن اتصالك.',
  'login.failed': 'تعذّر تسجيل الدخول',
  'code.title': 'سجّل الدخول بهاتفك',
  'code.help': 'امسح رمز QR بكاميرا هاتفك، أو افتح DriveStream على جهاز آخر واختر «ربط جهاز» ثم أدخل:',
  'code.qrA11y': 'رمز QR لتسجيل الدخول',
  'code.changes': 'يتغيّر الرمز كل 10 دقائق.',
  'code.cantReach': 'تعذّر الوصول إلى الخادم.',
  'code.failed': 'تعذّر الحصول على رمز',
  'link.title': 'ربط جهاز',
  'link.help': 'أدخل الرمز الظاهر على التلفزيون، أو امسح رمز QR الخاص به.',
  'link.badCode': 'يتكوّن الرمز من 6 أحرف وأرقام، مثل ABC-123.',
  'link.checking': 'جارٍ التحقق…',
  'link.scan': 'مسح رمز QR',
  'link.camera': 'اسمح بالوصول إلى الكاميرا لمسح رمز QR.',
  'link.pointCamera': 'وجّه الكاميرا إلى رمز QR على التلفزيون',
  'link.theTV': 'التلفزيون',
  'link.confirmTitle': 'تسجيل الدخول على هذا التلفزيون؟',
  'link.confirmA': 'سيتم تسجيل الدخول على {device} باسم ',
  'link.confirmB': ' (‎@{username})، مع قائمة «متابعة المشاهدة» الخاصة بك.',
  'link.signingIn': 'جارٍ تسجيل الدخول…',
  'link.signInTV': 'تسجيل الدخول على التلفزيون',
  'link.done': 'تم ✓',
  'link.doneText': 'يجري الآن تسجيل الدخول على التلفزيون.',
  'link.backHome': 'العودة إلى DriveStream',
  'search.placeholder': 'العناوين، التصنيفات، السنوات',
  'search.none': 'لا توجد نتائج لـ«{q}»',
  'search.results': 'نتائج البحث عن «{q}»',
  'category.fallback': 'الفئة',
  'category.all': 'الكل',
  'category.empty': 'لا شيء هنا بعد',
  'sort.label': 'ترتيب',
  'sort.added': 'المضاف حديثًا',
  'sort.title': 'أ–ي',
  'sort.year': 'الأحدث',
  'sort.rating': 'الأعلى تقييمًا',
  'title.play': 'تشغيل',
  'title.playEp': 'تشغيل {label}',
  'title.resume': 'استئناف',
  'title.resumeEp': 'استئناف {label}',
  'title.startOver': 'البدء من جديد',
  'title.genres': 'التصنيفات: ',
  'title.subtitles': 'الترجمة: ',
  'title.availableIn': 'متوفر بدقة: ',
  'title.episodes': 'الحلقات',
  'season.n': 'الموسم {n}',
  'season.specials': 'حلقات خاصة',
  'player.back': 'رجوع',
  'player.cast': 'بث',
  'player.castA11y': 'البث عبر Web Video Cast',
  'player.back10': 'رجوع 10 ثوانٍ',
  'player.fwd10': 'تقديم 10 ثوانٍ',
  'player.play': 'تشغيل',
  'player.pause': 'إيقاف مؤقت',
  'player.speed': 'السرعة ({v}x)',
  'player.episodes': 'الحلقات',
  'player.subtitles': 'الترجمة',
  'player.subtitlesOn': 'الترجمة · {label}',
  'player.quality': 'الجودة',
  'player.qualityOn': 'الجودة · {label}',
  'player.nextEpisode': 'الحلقة التالية',
  'player.skipIntro': 'تخطي المقدمة',
  'player.next': 'التالي: {label}',
  'player.nextIn': 'الحلقة التالية خلال {n}',
  'player.nextBtn': 'الحلقة التالية',
  'player.watchCredits': 'مشاهدة شارة النهاية',
  'player.hide': 'إخفاء',
  'player.playbackSpeed': 'سرعة التشغيل',
  'player.off': 'إيقاف',
  'player.normal': 'عادية',
  'player.noFfmpeg': 'تتطلب الدقّات الأقل وجود ffmpeg على الخادم.',
  'player.nowPlaying': '  (قيد التشغيل)',
  'player.original': 'الأصلي',
  'player.converted': 'محوّل',
  'player.convertedFallback': 'محوّل · استخدمه إن لم يعمل الأصلي',
  'player.convertedSaves': 'محوّل · يوفّر البيانات',
  'player.switching': 'جارٍ التبديل إلى {label}…',
  'player.cantPlay': 'لا يمكن تشغيل هذا الملف على هذا الجهاز. جارٍ تحويله…',
  'player.failed': 'تعذّر التشغيل',
  'player.subsFailed': 'تعذّر تحميل الترجمة',
  'player.installCast': 'ثبّت Web Video Cast للبث إلى التلفزيون',
  'player.seconds': '{n} ث',
  'account.title': 'إعدادات الحساب',
  'account.language': 'اللغة',
  'account.languageHelp': 'اختر لغة القوائم والأزرار على جميع أجهزتك.',
  'account.password': 'تغيير كلمة المرور',
  'account.current': 'كلمة المرور الحالية',
  'account.new': 'كلمة المرور الجديدة',
  'account.confirm': 'تأكيد كلمة المرور الجديدة',
  'account.minLength': '6 أحرف على الأقل.',
  'account.mismatch': 'كلمتا المرور الجديدتان غير متطابقتين.',
  'account.changed': 'تم تغيير كلمة المرور. تم تسجيل الخروج من الأجهزة الأخرى.',
  'account.failed': 'تعذّر تغيير كلمة المرور',
  'server.currentWrong': 'كلمة المرور الحالية غير صحيحة.',
  'server.passwordShort': 'يجب ألا تقل كلمة المرور عن 6 أحرف.',
};

// Drive folder names the server uses as categories.
const CATEGORIES: Record<string, string> = {
  'Movies': 'أفلام',
  'Films': 'أفلام',
  'TV Series': 'مسلسلات',
  'TV Shows': 'مسلسلات',
  'Series': 'مسلسلات',
  'Shows': 'مسلسلات',
  'Animation': 'رسوم متحركة',
  'Anime': 'أنمي',
  'Documentaries': 'وثائقيات',
  'Kids': 'أطفال',
};

// TMDB's movie and TV genre names.
const GENRES: Record<string, string> = {
  'Action': 'أكشن',
  'Adventure': 'مغامرة',
  'Animation': 'رسوم متحركة',
  'Comedy': 'كوميديا',
  'Crime': 'جريمة',
  'Documentary': 'وثائقي',
  'Drama': 'دراما',
  'Family': 'عائلي',
  'Fantasy': 'فانتازيا',
  'History': 'تاريخي',
  'Horror': 'رعب',
  'Music': 'موسيقى',
  'Mystery': 'غموض',
  'Romance': 'رومانسي',
  'Science Fiction': 'خيال علمي',
  'TV Movie': 'فيلم تلفزيوني',
  'Thriller': 'إثارة',
  'War': 'حرب',
  'Western': 'غرب أمريكي',
  'Action & Adventure': 'أكشن ومغامرة',
  'Kids': 'أطفال',
  'News': 'أخبار',
  'Reality': 'تلفزيون الواقع',
  'Sci-Fi & Fantasy': 'خيال علمي وفانتازيا',
  'Soap': 'دراما اجتماعية',
  'Talk': 'برامج حوارية',
  'War & Politics': 'حرب وسياسة',
};

// Arabic name of a genre whatever the interface language (search matches both).
export const arabicGenre = (name: string) => GENRES[name] || '';

// Thmanyah Sans, embedded by the expo-font plugin (app.json). On Android the family name is
// the file name, and fontWeight doesn't pick a file, so each weight is its own family.
const ARABIC_FONTS = { regular: 'ThmanyahSans-Regular', medium: 'ThmanyahSans-Medium', bold: 'ThmanyahSans-Bold' } as const;
export type Weight = keyof typeof ARABIC_FONTS;
export const arabicFontFor = (w: Weight): TextStyle => ({ fontFamily: ARABIC_FONTS[w], fontWeight: 'normal' });

type Vars = Record<string, string | number>;

type I18n = {
  lang: Lang;
  isRTL: boolean;
  ready: boolean;
  setLang: (l: Lang) => void;
  t: (key: Key, vars?: Vars) => string;
  /** Arabic: the Thmanyah Sans file for that weight (English: nothing, so the look is unchanged). */
  f: (w: Weight) => TextStyle | null;
  /** Arabic: right-aligned block text (paragraphs, notes). */
  ta: TextStyle | null;
  category: (name: string) => string;
  genre: (name: string) => string;
  season: (name: string) => string;
  episodeLabel: (label: string) => string;
  runtime: (min: number | null) => string;
  /** "3 Seasons" / "1 Episode" with Arabic number agreement. `short` gives "8 Ep." in English. */
  seasons: (n: number) => string;
  episodes: (n: number, short?: boolean) => string;
};

const I18nContext = createContext<I18n>(null as unknown as I18n);
export const useI18n = () => useContext(I18nContext);

const LANG_KEY = 'lang';
const CHOSEN_KEY = 'langChosen'; // picked on the sign-in screen, not yet saved to the account

export function I18nProvider({ children }: { children: ReactNode }) {
  const { user, updateUser } = useAuth();
  const [lang, setLangState] = useState<Lang>('en');
  const [loaded, setLoaded] = useState(false);
  const langRef = useRef<Lang>('en');
  const chosenBeforeSignIn = useRef(false);

  const apply = useCallback((l: Lang) => {
    langRef.current = l;
    setLangState(l);
    SecureStore.setItemAsync(LANG_KEY, l).catch(() => {});
  }, []);

  useEffect(() => {
    (async () => {
      const [stored, chosen] = await Promise.all([
        SecureStore.getItemAsync(LANG_KEY).catch(() => null),
        SecureStore.getItemAsync(CHOSEN_KEY).catch(() => null),
      ]);
      if (stored === 'ar' || stored === 'en') {
        langRef.current = stored;
        setLangState(stored);
      }
      chosenBeforeSignIn.current = chosen === '1';
      setLoaded(true);
    })();
  }, []);

  // Signed in: the account's language wins, unless one was just picked on the sign-in screen,
  // in which case that choice is saved to the account.
  const userId = user?.id;
  const userLang = user?.lang;
  useEffect(() => {
    if (!loaded || !userId) return;
    if (chosenBeforeSignIn.current) {
      chosenBeforeSignIn.current = false;
      SecureStore.deleteItemAsync(CHOSEN_KEY).catch(() => {});
      if (userLang !== langRef.current) {
        api<{ user: User }>('/api/me', { method: 'PATCH', body: { lang: langRef.current } })
          .then((r) => r?.user && updateUser(r.user))
          .catch(() => {});
      }
      return;
    }
    if ((userLang === 'en' || userLang === 'ar') && userLang !== langRef.current) apply(userLang);
  }, [loaded, userId, userLang, apply, updateUser]);

  const setLang = useCallback((l: Lang) => {
    apply(l);
    if (user) {
      api<{ user: User }>('/api/me', { method: 'PATCH', body: { lang: l } })
        // Ignore a late reply after the language was switched again.
        .then((r) => r?.user && r.user.lang === langRef.current && updateUser(r.user))
        .catch(() => {});
    } else {
      chosenBeforeSignIn.current = true;
      SecureStore.setItemAsync(CHOSEN_KEY, '1').catch(() => {});
    }
  }, [user, apply, updateUser]);

  const value = useMemo<I18n>(() => {
    const isAr = lang === 'ar';
    const dict = isAr ? ar : en;
    const t = (key: Key, vars?: Vars) => {
      let str: string = dict[key] ?? en[key] ?? key;
      if (vars) for (const k in vars) str = str.split(`{${k}}`).join(String(vars[k]));
      return str;
    };
    return {
      lang,
      isRTL: isAr,
      ready: loaded,
      setLang,
      t,
      f: (w) => (isAr ? arabicFontFor(w) : null),
      ta: isAr ? { textAlign: 'right', writingDirection: 'rtl' } : null,
      category: (name) => (isAr ? CATEGORIES[name] || CATEGORIES[name.trim()] || name : name),
      genre: (name) => (isAr ? GENRES[name] || name : name),
      season: (name) => {
        if (!isAr) return name;
        const m = name.match(/^Season\s+(\d+)$/i);
        if (m) return t('season.n', { n: m[1] });
        return /^specials$/i.test(name) ? t('season.specials') : name;
      },
      episodeLabel: (label) => {
        if (!isAr) return label;
        const m = label.match(/^S(\d+):E(\d+)$/);
        return m ? `م${m[1]} ح${m[2]}` : label;
      },
      seasons: (n) => (!isAr ? t('meta.seasons', { n }) : n === 1 ? 'موسم واحد' : n === 2 ? 'موسمان' : n <= 10 ? `${n} مواسم` : `${n} موسمًا`),
      episodes: (n, short) => (!isAr
        ? t(short ? 'meta.ep' : n === 1 ? 'meta.episode' : 'meta.episodes', { n })
        : n === 1 ? 'حلقة واحدة' : n === 2 ? 'حلقتان' : n <= 10 ? `${n} حلقات` : `${n} حلقة`),
      runtime: (min) => (!min ? '' : min >= 60 ? t('time.hm', { h: Math.floor(min / 60), m: min % 60 }) : t('time.m', { m: min })),
    };
  }, [lang, loaded, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

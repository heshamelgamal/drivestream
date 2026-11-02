// Interface language: English (default) or Arabic, chosen per profile in Account settings.
// Strings are looked up by their English text, so t('Play') returns the Arabic
// translation when Arabic is on and the English text otherwise. {name} placeholders
// are filled from `vars`. Content (titles, plots, people) is never translated.

// Saved like ui.js prefs ('ds.lang'), read directly so ui.js can import this module.
const store = {
  get: () => { try { return JSON.parse(localStorage.getItem('ds.lang')); } catch { return null; } },
  set: (v) => { try { localStorage.setItem('ds.lang', JSON.stringify(v)); } catch {} },
};

const AR = {
  // nav, home, rows
  'Home': 'الرئيسية',
  'Titles, genres, years': 'العناوين، التصنيفات، السنوات',
  'Search': 'بحث',
  'DriveStream home': 'DriveStream الرئيسية',
  'Continue Watching': 'متابعة المشاهدة',
  'Recently Added': 'أُضيف مؤخرًا',
  'New': 'جديد',
  'Up next · {label}': 'التالي · {label}',
  'Continue {title}': 'متابعة {title}',
  'Remove from Continue Watching': 'إزالة من متابعة المشاهدة',
  'Remove {title} from Continue Watching': 'إزالة {title} من «متابعة المشاهدة»',
  'Remove from Continue Watching?': 'إزالة من «متابعة المشاهدة»؟',
  'Remove': 'إزالة',
  'Scroll left': 'تمرير لليسار',
  'Scroll right': 'تمرير لليمين',
  'Resume': 'استئناف',
  'Play': 'تشغيل',
  'More info': 'مزيد من المعلومات',
  '{n} Seasons': '{n} مواسم',
  '{n} Episodes': '{n} حلقات',
  '1 Episode': 'حلقة واحدة',
  '{n} Ep.': '{n} حلقات',
  'never': 'أبدًا',
  '{h}h {m}m': '{h} س {m} د',
  '{m}m': '{m} د',
  'Refreshing…': 'جارٍ التحديث…',
  'Refresh library': 'تحديث المكتبة',
  '{n} titles · last scanned {when}': '{n} عنوان · آخر فحص {when}',
  'Last scan failed: {error}': 'فشل آخر فحص: {error}',
  'Add TMDB_API_KEY in .env for posters and plots': 'أضف TMDB_API_KEY في ملف ‎.env لعرض الملصقات والقصص',
  'Scanning your Google Drive…': 'جارٍ فحص Google Drive…',
  'Scanning your library…': 'جارٍ فحص مكتبتك…',
  'Your library is empty': 'مكتبتك فارغة',
  'This takes a few seconds the first time. The page will refresh on its own.': 'يستغرق هذا بضع ثوانٍ في المرة الأولى. ستتحدّث الصفحة تلقائيًا.',
  'Add movies and shows to your Drive folders, then refresh.': 'أضف أفلامًا ومسلسلات إلى مجلدات Drive، ثم حدّث المكتبة.',
  'Add movies and shows to your media folders, then refresh.': 'أضف أفلامًا ومسلسلات إلى مجلدات الوسائط، ثم حدّث المكتبة.',
  'Category not found': 'التصنيف غير موجود',
  'Sort': 'ترتيب',
  'Recently added': 'المضاف حديثًا',
  'A–Z': 'أ–ي',
  'Newest': 'الأحدث',
  'Top rated': 'الأعلى تقييمًا',
  'All': 'الكل',
  'Nothing here yet': 'لا شيء هنا بعد',
  'Add files to your {name} folder on Drive.': 'أضف ملفات إلى مجلد {name} على Drive.',
  'Add files to your {name} folder.': 'أضف ملفات إلى مجلد {name}.',
  'Results for “{q}”': 'نتائج البحث عن «{q}»',
  'No results for “{q}”': 'لا توجد نتائج لـ«{q}»',
  'Try a different title, genre or year.': 'جرّب عنوانًا أو تصنيفًا أو سنة مختلفة.',
  'Something went wrong': 'حدث خطأ ما',
  'Back to home': 'العودة إلى الرئيسية',
  'Developed by ': 'تطوير ',
  'Download App': 'نزّل التطبيق',
  'Android Phone': 'هاتف Android',
  'Android TV': 'Android TV',

  // title page
  'Resume {label}': 'استئناف {label}',
  'Play {label}': 'تشغيل {label}',
  'Start over': 'البدء من جديد',
  'Genres: ': 'التصنيفات: ',
  'Available in: ': 'متوفر بدقة: ',
  'Original': 'الأصلي',
  'Subtitles: ': 'الترجمة: ',
  'Back': 'رجوع',
  'Episodes': 'الحلقات',
  'Season': 'الموسم',
  'Season {n}': 'الموسم {n}',
  'Specials': 'حلقات خاصة',

  // player
  'Skip Intro': 'تخطي المقدمة',
  'Converted · use if the original won’t play': 'محوّل · استخدمه إن لم يعمل الأصلي',
  'Converted · saves data': 'محوّل · يوفّر البيانات',
  'Couldn’t load subtitles': 'تعذّر تحميل الترجمة',
  'Play (Space)': 'تشغيل (مسافة)',
  'Pause (Space)': 'إيقاف مؤقت (مسافة)',
  'Back 10 seconds (←)': 'رجوع 10 ثوانٍ (←)',
  'Forward 10 seconds (→)': 'تقديم 10 ثوانٍ (→)',
  'Mute (M)': 'كتم الصوت (M)',
  'Unmute (M)': 'تشغيل الصوت (M)',
  'Volume': 'مستوى الصوت',
  'Full screen (F)': 'ملء الشاشة (F)',
  'Exit full screen (F)': 'الخروج من ملء الشاشة (F)',
  'Cast': 'بث',
  'Cast with Web Video Cast': 'البث عبر Web Video Cast',
  'Couldn’t prepare the cast link': 'تعذّر تجهيز رابط البث',
  'Speed ({n}x)': 'السرعة ({n}x)',
  'Subtitles': 'الترجمة',
  'Subtitles · {label}': 'الترجمة · {label}',
  'Quality · {label}': 'الجودة · {label}',
  'Next Episode': 'الحلقة التالية',
  'Seek': 'شريط التقدّم',
  'Close': 'إغلاق',
  'Quality': 'الجودة',
  'Switching to {label} (converted)…': 'جارٍ التبديل إلى {label} (محوّل)…',
  'Switching to {label}…': 'جارٍ التبديل إلى {label}…',
  'Lower resolutions need ffmpeg on the server.': 'تتطلب الدقّات الأقل وجود ffmpeg على الخادم.',
  'Off': 'إيقاف',
  'Playback speed': 'سرعة التشغيل',
  '1x (Normal)': 'عادية',
  '(now playing)': '(قيد التشغيل)',
  '{n}s': '{n} ث',
  'This file’s format isn’t supported by your browser. Converting it…': 'صيغة هذا الملف غير مدعومة في متصفحك. جارٍ تحويله…',
  'Conversion failed. Check the server log.': 'فشل التحويل. راجع سجل الخادم.',
  'This browser can’t play this file. Install ffmpeg on the server to convert it.': 'لا يستطيع هذا المتصفح تشغيل هذا الملف. ثبّت ffmpeg على الخادم لتحويله.',
  'Next: {label}': 'التالي: {label}',
  'Next episode': 'الحلقة التالية',
  'Next episode in {n}': 'الحلقة التالية خلال {n}',
  'Watch credits': 'مشاهدة شارة النهاية',
  'Hide': 'إخفاء',

  // sign in, link a device
  'Sign In': 'تسجيل الدخول',
  'Username': 'اسم المستخدم',
  'Password': 'كلمة المرور',
  'Show': 'إظهار',
  'Show password': 'إظهار كلمة المرور',
  'Hide password': 'إخفاء كلمة المرور',
  'Ask the person who runs this DriveStream for a profile.': 'اطلب ملفًا شخصيًا من الشخص الذي يدير DriveStream هذا.',
  // messages from the server
  'There’s no profile with that username.': 'لا يوجد ملف شخصي بهذا الاسم.',
  'Wrong password.': 'كلمة المرور غير صحيحة.',
  'Current password is wrong.': 'كلمة المرور الحالية غير صحيحة.',
  'That code isn’t valid or has expired. Check the code on the TV.': 'هذا الرمز غير صالح أو انتهت صلاحيته. تحقّق من الرمز على التلفزيون.',
  'Too many attempts. Try again in a few minutes.': 'محاولات كثيرة. حاول مجددًا بعد بضع دقائق.',
  'Too many codes requested. Try again in a few minutes.': 'طلبات رموز كثيرة. حاول مجددًا بعد بضع دقائق.',
  'Please sign in.': 'يرجى تسجيل الدخول.',
  'Title not found': 'العنوان غير موجود',
  'Not in library': 'غير موجود في المكتبة',
  'Not found.': 'غير موجود.',
  'Profile not found.': 'الملف الشخصي غير موجود.',
  'That username is already taken.': 'اسم المستخدم هذا مستخدم بالفعل.',
  'Server error': 'خطأ في الخادم',
  'Sign in with your phone': 'سجّل الدخول بهاتفك',
  'Scan the QR code with your phone’s camera, or open DriveStream on your phone or computer, choose ': 'امسح رمز QR بكاميرا هاتفك، أو افتح DriveStream على هاتفك أو حاسوبك واختر ',
  'Link a device': 'ربط جهاز',
  ' and enter:': ' وأدخل:',
  'The code changes every 10 minutes.': 'يتغيّر الرمز كل 10 دقائق.',
  'Continue': 'متابعة',
  'Sign in this TV?': 'تسجيل الدخول على هذا التلفزيون؟',
  'The TV': 'التلفزيون',
  '{device} will be signed in as ': 'سيتم تسجيل الدخول على {device} باسم ',
  ' (@{username}), with your own Continue Watching.': ' (‎@{username})، مع قائمة «متابعة المشاهدة» الخاصة بك.',
  'Done ✓': 'تم ✓',
  'The TV is signing in now.': 'يجري الآن تسجيل الدخول على التلفزيون.',
  'Back to DriveStream': 'العودة إلى DriveStream',
  'Sign in the TV': 'تسجيل الدخول على التلفزيون',
  'Cancel': 'إلغاء',
  'Exit DriveStream?': 'الخروج من DriveStream؟',
  'Exit': 'خروج',
  'Enter the code shown on your TV.': 'أدخل الرمز الظاهر على التلفزيون.',

  // profile menu, account settings
  'Manage profiles': 'إدارة الملفات الشخصية',
  'Account settings': 'إعدادات الحساب',
  'Sign out': 'تسجيل الخروج',
  'Profile: {name}': 'الملف الشخصي: {name}',
  'Language': 'اللغة',
  'Choose the language for menus and buttons on all your devices.': 'اختر لغة القوائم والأزرار على جميع أجهزتك.',
  'Change password': 'تغيير كلمة المرور',
  'Password changed. Other devices have been signed out.': 'تم تغيير كلمة المرور. تم تسجيل الخروج من الأجهزة الأخرى.',
  'The new passwords don’t match.': 'كلمتا المرور الجديدتان غير متطابقتين.',
  'Current password': 'كلمة المرور الحالية',
  'New password': 'كلمة المرور الجديدة',
  'Confirm new password': 'تأكيد كلمة المرور الجديدة',

  // manage profiles (admins)
  'Save': 'حفظ',
  'Name': 'الاسم',
  'e.g. Sara': 'مثال: سارة',
  '3–32 characters: letters, numbers, . _ -': 'من 3 إلى 32 حرفًا: أحرف إنجليزية وأرقام و . _ -',
  'Leave blank to keep the current password. Changing it signs this profile out on all devices.': 'اتركه فارغًا للإبقاء على كلمة المرور الحالية. تغييرها يسجّل خروج هذا الملف من جميع الأجهزة.',
  'At least 6 characters.': '6 أحرف على الأقل.',
  'Admin (can manage profiles)': 'مشرف (يمكنه إدارة الملفات الشخصية)',
  'Never': 'أبدًا',
  'Just now': 'الآن',
  '{n} min ago': 'قبل {n} دقيقة',
  '{n} h ago': 'قبل {n} ساعة',
  'Admins only': 'للمشرفين فقط',
  'Add profile': 'إضافة ملف شخصي',
  '+ Add profile': '+ إضافة ملف شخصي',
  'You': 'أنت',
  'Admin': 'مشرف',
  '{n} titles in history · last watched {ago}': '{n} عنوان في السجل · آخر مشاهدة {ago}',
  'Edit {name}': 'تعديل {name}',
  'Edit': 'تعديل',
  'Clear {name}’s history?': 'مسح سجل {name}؟',
  'This empties their Continue Watching and resume points. It can’t be undone.': 'سيؤدي هذا إلى إفراغ قائمة متابعة المشاهدة ونقاط الاستئناف. لا يمكن التراجع عن ذلك.',
  'Clear history': 'مسح السجل',
  'Delete {name}?': 'حذف {name}؟',
  '@{username} will be signed out everywhere and their watch history deleted. This can’t be undone.': 'سيُسجَّل خروج @{username} من كل مكان ويُحذف سجل مشاهدته. لا يمكن التراجع عن ذلك.',
  'Delete profile': 'حذف الملف الشخصي',
  'Delete': 'حذف',
  'Everyone signs in with their own username and password and gets their own Continue Watching.': 'يسجّل كل شخص الدخول باسم مستخدم وكلمة مرور خاصين به، وله قائمة متابعة مشاهدة خاصة.',

  // uploads (admins)
  'Waiting': 'في الانتظار',
  'Downloading': 'جارٍ التنزيل',
  'Uploading to Drive': 'جارٍ الرفع إلى Drive',
  'In Drive': 'في Drive',
  'Skipped': 'تم التخطي',
  'Failed': 'فشل',
  'Cancelled': 'أُلغي',
  'Add to Google Drive': 'إضافة إلى Google Drive',
  'One-time setup: create a Google OAuth client (type “Web application”) and add this as its authorised redirect URI:': 'إعداد لمرة واحدة: أنشئ عميل Google OAuth (من نوع “Web application”) وأضف هذا العنوان كعنوان إعادة توجيه مصرّح به:',
  'Client ID': 'معرّف العميل',
  'Client secret': 'سرّ العميل',
  'Connect the Google account that owns your library folders. Uploads are made as that account.': 'اربط حساب Google الذي يملك مجلدات مكتبتك. يتم الرفع باسم هذا الحساب.',
  'Connect Google Drive': 'ربط Google Drive',
  'Show folder (optional)': 'مجلد المسلسل (اختياري)',
  'Remove row': 'إزالة الصف',
  'Send to Drive': 'إرسال إلى Drive',
  '+ Add link': '+ إضافة رابط',
  '{a} of {b}': '{a} من {b}',
  'Retry': 'إعادة المحاولة',
  'Clear': 'مسح',
  'Nothing sent yet.': 'لم يُرسل شيء بعد.',
  'Connected as ': 'متصل بحساب ',
  'your Google account': 'حساب Google الخاص بك',
  'Disconnect': 'قطع الاتصال',
  'Paste one link per row (pasting several lines at once fills several rows). The server downloads each file, uploads it to Drive and deletes its own copy; the library refreshes when it’s done.': 'الصق رابطًا واحدًا في كل صف (لصق عدة أسطر دفعة واحدة يملأ عدة صفوف). ينزّل الخادم كل ملف ويرفعه إلى Drive ثم يحذف نسخته؛ وتتحدّث المكتبة عند الانتهاء.',
  'Recent': 'الأحدث',
};

// Drive folder names (categories) and TMDB genres arrive in English.
const AR_NAMES = {
  'Movies': 'أفلام',
  'Films': 'أفلام',
  'TV Series': 'مسلسلات',
  'TV Shows': 'مسلسلات',
  'Series': 'مسلسلات',
  'Shows': 'مسلسلات',
  'Animation': 'رسوم متحركة',
  'Anime': 'أنمي',
  'Documentaries': 'وثائقيات',
  'Action': 'أكشن',
  'Adventure': 'مغامرة',
  'Action & Adventure': 'أكشن ومغامرة',
  'Comedy': 'كوميديا',
  'Crime': 'جريمة',
  'Documentary': 'وثائقي',
  'Drama': 'دراما',
  'Family': 'عائلي',
  'Fantasy': 'فانتازيا',
  'History': 'تاريخي',
  'Horror': 'رعب',
  'Kids': 'أطفال',
  'Music': 'موسيقى',
  'Mystery': 'غموض',
  'News': 'أخبار',
  'Reality': 'تلفزيون الواقع',
  'Romance': 'رومانسي',
  'Science Fiction': 'خيال علمي',
  'Sci-Fi & Fantasy': 'خيال علمي وفانتازيا',
  'Soap': 'دراما اجتماعية',
  'Talk': 'برامج حوارية',
  'TV Movie': 'فيلم تلفزيوني',
  'Thriller': 'إثارة',
  'War': 'حرب',
  'War & Politics': 'حرب وسياسة',
  'Western': 'غرب أمريكي',
};

const saved = store.get();
export let lang = saved === 'ar' ? 'ar' : 'en';
export const isArabic = () => lang === 'ar';

const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s);

export function t(text, vars) {
  return fill(lang === 'ar' ? AR[text] || text : text, vars);
}

// Category and genre names; season names like "Season 2".
export function tName(name) {
  if (lang !== 'ar' || !name) return name;
  const season = /^Season (\d+)$/.exec(name);
  if (season) return t('Season {n}', { n: season[1] });
  return AR_NAMES[name] || AR[name] || name;
}

// Episode labels: "S1:E2" reads "م1 ح2" in Arabic (as in the apps).
export function epLabel(label) {
  if (lang !== 'ar' || !label) return label;
  const m = /^S(\d+):E(\d+)$/.exec(label);
  return m ? `م${m[1]} ح${m[2]}` : label;
}

// Sets <html lang/dir>. The video player keeps a left-to-right layout (see styles.css).
export function applyLang(next) {
  lang = next === 'ar' ? 'ar' : 'en';
  store.set(lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  const searchBox = document.getElementById('search');
  if (searchBox) {
    searchBox.placeholder = t('Titles, genres, years');
    searchBox.setAttribute('aria-label', t('Search'));
  }
  return lang;
}
applyLang(lang);

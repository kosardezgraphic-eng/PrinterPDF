# گزارش ممیزی و پایدارسازی PrintStudio Pro

مبنای ممیزی: commit `f4db676d0b03e4446be5c7b9d2444d8bfcac6830`. شماره خطوط بخش یافته‌ها مربوط به همین commit است، نه فایل‌های تغییرکرده. این گزارش گواهی کیفیت نیست: ویندوز، چاپگر، Sidecar، Electron GUI و سناریوی E2E در این محیط اجرا نشده‌اند. شرح کدهای A–K از نام‌ها و کامنت‌های همین مخزن استنتاج شده؛ سند مستقل نگاشت تمام زیرقابلیت‌ها در مخزن پیدا نشد.

## مرحله ۱ — وضعیت مبنا

✅ یعنی با شواهد کافی کامل؛ ⚠️ ناقص/تأییدنشده؛ ❌ اجرای ساختگی یا مسیر اصلی اجرا نشده. نبود ✅ به معنی نبود هیچ کد واقعی نیست.

| P0 | وضعیت | شواهد / دلیل |
|---|---|---|
| A1 ورود فایل و Drag/Paste | ⚠️ | File API و جداسازی خطا وجود دارد؛ PDFها دارای تصویر ساختگی بودند و واردات تصویر تمامی فرمت‌های اعلامی را معتبرسنجی نمی‌کند. |
| A2 Open With/CLI | ⚠️ | main پیام `cli:open-files` می‌فرستد؛ preload/renderer مشترک پیام را دریافت نمی‌کنند؛ اجرای نخست هم بارگذاری فایل ندارد. |
| A3 انتخاب و مدیریت صفحات | ⚠️ | انتخاب و تغییر ترتیب در store/UI وجود دارد؛ صحت کامل تعامل و مقیاس ۱۰هزار صفحه آزموده نشده. |
| A4 عملیات صفحه / تفکیک | ⚠️ | حذف، کپی، چرخش و درج وجود دارند؛ خروجی چرخش را اعمال نمی‌کند و export برای تصویر placeholder است. |
| A5 Undo/Redo | ⚠️ | history و آزمون واحد وجود دارد؛ پوشش همه تغییرات و رفتار مقیاس بزرگ تأیید نشده؛ ظرفیت history در store برابر ۳۰۰ است. |
| B1 شمارش صفحه/برگ | ⚠️ | محاسبات چیدمان تست واحد دارند اما تشخیص رنگ و پوشش جوهر PDF ساختگی بود. |
| B2 هزینه/تفکیک | ⚠️ | محاسبات تعرفه موجودند اما مبتنی بر داده رنگ مصنوعی و بدون اعتبارسنجی چاپ واقعی‌اند. |
| C1 ادغام و خروجی PDF | ⚠️ | pdf-lib صفحات PDF را embed می‌کند اما ورودی تصویر و منبع ازدست‌رفته را به شکل کادر جعلی صادر می‌کند؛ چرخش نادیده است. |
| C2 بوک‌مارک/تفکیک | ⚠️ | بوک‌مارک در UI و خروجی انتخاب وجود دارد، نه بازسازی کامل bookmarkهای PDF و تفکیک جامع تأییدشده. |
| D1 N-Up | ⚠️ | محاسبه grid و تست واحد وجود دارد؛ تطابق تصویری با خروجی در همه موارد تست نشده. |
| D2 ترتیب و Step & Repeat | ⚠️ | الگوریتم و تست واحد موجود؛ خروجی واقعی و موارد مرزی تأیید نشده. |
| D3 حاشیه/مقیاس/چرخش | ⚠️ | هندسه محاسبه می‌شود اما `effectiveRotation` در PDF خروجی استفاده نمی‌شود. |
| D4 کاغذ/جهت | ⚠️ | اندازه و جهت در layout وجود دارند؛ ابعاد سفارشی در UI و قابلیت‌های واقعی درایور کامل نیست. |
| D5 دورو/ترتیب | ⚠️ | محاسبه و راهنمای دستی وجود دارد؛ انتقال و اجرای چاپ دورو روی درایور اثبات نشده. |
| E1 Invert | ⚠️ | CSS preview و Difference در export پیاده شده، تطابق پیکسلی/چاپگر و حالت‌های ویژه آزموده نشده. |
| E2 افکت‌ها | ⚠️ | بخشی از pipeline پیش‌نمایش/پیکسل وجود دارد؛ export به‌جز Invert افکت‌ها را اعمال نمی‌کند و sharpness پیاده نیست. |
| F1 واترمارک | ⚠️ | در UI وجود دارد؛ StandardFonts و حذف غیر ASCII باعث از دست رفتن فارسی در خروجی می‌شود. |
| F2 شماره صفحه/Bates | ⚠️ | قالب‌ساز موجود؛ PDF خروجی برای قالب غیر Bates از شماره برگ لاتین ثابت استفاده می‌کند. |
| G1 تنظیمات چاپ | ⚠️ | دیالوگ وجود دارد؛ range، فرد/زوج، reverse و سایر تنظیمات به سند اعمال نمی‌شوند. |
| G2 چاپ مستقیم | ❌ | PDF bytes به submit ارسال نمی‌شود و Sidecar handler برای `printer:print-job` ندارد؛ fallback می‌تواند موفقیت جعلی نشان دهد. |
| H1 صف Batch | ❌ | حلقه پس از تأخیر job را completed می‌کند بدون ارسال چاپ. |
| H2 کنترل Batch | ⚠️ | وضعیت/دکمه‌ها موجودند ولی نه اجرای واقعی job و نه snapshot فایل معتبر وجود ندارد. |
| I1 فهرست پرینتر | ⚠️ | کد Sidecar واقعی وجود دارد ولی Win32 اجرا نشده؛ خطای IPC در Electron به داده ساختگی تبدیل می‌شود. |
| I2 وضعیت/قابلیت | ⚠️ | اطلاعات محدود واقعی با مقادیر ثابت/فرضی آمیخته شده؛ در fallback همه ساختگی‌اند. |
| I3 Spooler | ⚠️ | P/Invoke و کنترل موجود، اجرا نشده؛ priority کامل نیست و fallback خروجی ساختگی می‌دهد. |
| J1 نمای کار | ⚠️ | zoom و preview وجود دارند؛ thumbnail ساختگی و theme روشن کل خروجی را invert می‌کند؛ 60fps اثبات نشده. |
| K1 تنظیمات/نشست | ⚠️ | save موجود؛ load و timer بازیابی به UI وصل نیستند؛ فایل پروژه rawBytes را حذف می‌کند و امکان بازسازی PDF ندارد. |

### پاسخ‌های فنی b–e

- **رندر در مبنا:** `pdf-lib` فقط PDF را parse می‌کرد؛ thumbnail توسط `buildCrispPageSvgDataUrl` تولید می‌شد و صفحه واقعی نبود. `pdfjs-dist` در وابستگی‌ها بود اما موتور رندر استفاده نمی‌شد. رنگ بر اساس شماره صفحه و مقدار جوهر ثابت بود. هیچ PDFium وجود ندارد.
- **Mock:** `ipcBridge.ts` فهرست چاپگر، job، profile/default، status، کنترل صف، purge و submit را شبیه‌سازی می‌کرد. خطای Electron در list/update/default/list jobs/submit/control/purge نیز به mock می‌افتاد. نمونه اولیه workspace شامل PDF واقعی ساده و thumbnail SVG ساختگی بود. Sidecar نیز بعضی capabilities را ثابت فرض می‌کند.
- **Thread:** در مبنا Worker برای PDF/شمارش/merge وجود نداشت؛ parsing، تولید SVG، شمارش و pdf-lib export در renderer/UI thread اجرا می‌شدند. `async` به معنی off-thread نیست.
- **مسیر چاپ:** store فقط `request,totalSheets` به bridge می‌دهد؛ پارامتر اختیاری `pdfBytes` خالی است. main فقط در صورت دریافت bytes فایل موقت می‌سازد و client مسیر را با JSON-RPC نام `printer:print-job` می‌فرستد؛ switch در C# چنین handlerی ندارد. افزون بر آن، حلقه pipe با `await using` پس از آغاز task بدون await سرور را dispose می‌کند؛ مدیریت exception پاسخ نیز id را صفر می‌گذارد. اجرای واقعی چاپ اثبات نشده است.

### f) مکان‌یابی استاتیک در مبنا

- `TODO`: هیچ مورد در فایل‌های tracked کد پیدا نشد. نوع صریح TypeScript `any`: هیچ موردی پیدا نشد؛ واژه `any` در متون انگلیسی و comment نوع نیست. `console.error`: در کد مبنا موردی پیدا نشد؛ این به معنی نبود خطای بلعیده‌شده نیست.
- `catch` بدون جزئیات exception: `app/src/engine/ipcBridge.ts:270,284,300,325,343,384,411,429,441,453`؛ `app/src/engine/pdfService.ts:297,538`؛ `app/src/store/useAppStore.ts:1103`؛ `electron/sessionStore.ts:41,50,64,73`؛ `printer-service/Services/PrinterSpoolerService.cs:72,189`. همه این‌ها از نظر رفتار یکسان نیستند: برخی مقدار false/null یا پیام عمومی برمی‌گردانند و برخی fallback یا skip بی‌صدا هستند. `electron/printerSidecarClient.ts:101` و `printer-service/Program.cs:90` exception را می‌گیرند، اما دومی correlation id را از دست می‌دهد.
- Promiseهای fire-and-forget بالقوه: `app/src/App.tsx:35,98,140`؛ `app/src/components/Modals.tsx:538`؛ `app/src/components/PreviewWorkspace.tsx:451,472,559,741,760,784,833,848,863,877`؛ `app/src/components/QuickBar.tsx:105,201`؛ `app/src/components/Ribbon.tsx:131,203,222,824,839,889`؛ `app/src/components/SidebarPages.tsx:467`؛ `app/src/store/useAppStore.ts:997,1064,1354`؛ و task بدون await در `printer-service/Program.cs:38`. همچنین `electron/main.ts` زنجیره `app.whenReady().then(...)` را بدون catch نهایی شروع می‌کند. این‌ها موارد بالقوه‌اند، نه ادعای اینکه تک‌تک در اجرای واقعی reject شده‌اند. listener عمومی `unhandledrejection` پیام می‌دهد اما جای مدیریت محلی و تصحیح state را نمی‌گیرد.

## خروجی‌های واقعی فرمان‌ها

`npm install` قبلی با `ELECTRON_SKIP_BINARY_DOWNLOAD=1` اجرا شده بود؛ متن کامل آن در دسترس نیست و بازسازی نمی‌شود. اجرای دقیق `npm install` زیر **پس از تغییرات و افزودن وابستگی تست** انجام شد:

```text
> npm install
added 2 packages, and audited 542 packages in 3s

95 packages are looking for funding
  run `npm fund` for details

21 vulnerabilities (5 moderate, 13 high, 3 critical)

To address issues that do not require attention, run:
  npm audit fix

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.
```

رونوشت زیر در بازاجرای **کد مبنا** با node_modules فعلی در `/tmp/printstudio-baseline` ثبت شد؛ نسخه زمان اجرا و وابستگی‌ها ممکن است همان لحظه نصب اولیه نباشد:

```text
$ npx tsc --noEmit
exit: 0
$ npx tsc -p tsconfig.electron.json --noEmit
exit: 0
$ npm run build

> printstudio-pro@1.0.0 build
> tsc -b && vite build

vite v6.4.5 building for production...
transforming...
✓ 2275 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.87 kB │ gzip:   0.54 kB
dist/assets/index-DIE4b5_y.css   49.26 kB │ gzip:   8.53 kB
dist/assets/index-Cg6_HmWA.js   849.82 kB │ gzip: 298.78 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 4.29s
exit: 0
$ npm test

> printstudio-pro@1.0.0 test
> vitest run


 RUN  v3.2.7 /tmp/printstudio-baseline

 ✓ app/src/engine/engine.test.ts (7 tests) 65ms

 Test Files  1 passed (1)
      Tests  7 passed (7)
   Start at  13:28:15
   Duration  628ms (transform 188ms, setup 0ms, collect 330ms, tests 65ms, environment 0ms, prepare 73ms)

exit: 0
```

`npm run dev` روی شاخه فعلی اجرا شد؛ 5173 از قبل مشغول بود:

```text
> printstudio-pro@1.0.0 dev
> vite --host 0.0.0.0 --port 5173

1:27:10 PM [vite] (client) Re-optimizing dependencies because lockfile has changed
Port 5173 is in use, trying another one...

  VITE v6.4.5  ready in 249 ms

  ➜  Local:   http://localhost:5174/
  ➜  Network: http://169.254.0.21:5174/
```

رونوشت خروجی نهایی شاخه فعلی (نه وضعیت مبنا):

```text
$ npx tsc --noEmit
exit: 0
$ npx tsc -p tsconfig.electron.json --noEmit
exit: 0
$ npm run build

> printstudio-pro@1.0.0 build
> tsc -b && vite build

vite v6.4.5 building for production...
transforming...
✓ 2275 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                                0.87 kB │ gzip:   0.54 kB
dist/assets/pdfRendererWorker-BpDi0Brj.js    410.62 kB
dist/assets/pdf.worker.min-rsCePomN.mjs    1,417.59 kB
dist/assets/index-DIE4b5_y.css                49.26 kB │ gzip:   8.53 kB
dist/assets/index-CDS-wTBs.js                850.12 kB │ gzip: 299.08 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 6.96s
exit: 0
$ npm test

> printstudio-pro@1.0.0 test
> vitest run


 RUN  v3.2.7 /home/user/PrinterPDF

 ✓ app/src/engine/pdfRealRenderer.test.ts (3 tests) 305ms
 ✓ app/src/engine/ipcBridge.test.ts (5 tests) 303ms
 ✓ app/src/engine/engine.test.ts (8 tests) 69ms

 Test Files  3 passed (3)
      Tests  16 passed (16)
   Start at  13:28:46
   Duration  2.04s (transform 270ms, setup 0ms, collect 701ms, tests 677ms, environment 1ms, prepare 228ms)

exit: 0
$ dotnet build printer-service/PrinterService.csproj
/bin/bash: line 1: dotnet: command not found
exit: 127
```

## مرحله ۲ — تغییرات و شواهد

| Commit | علت ریشه‌ای → تغییر | تست و محدودیت |
|---|---|---|
| `c0b8761` | SVG و رنگ فرضی → PDF.js در Worker با OffscreenCanvas و اندازه‌گیری تخمینی پیکسل؛ خطا به کاربر برمی‌گردد و خروجی build مسیر نسبی دارد. | `pdfRealRenderer.test.ts` رندر واقعی مستطیل‌های سفید/خاکستری/رنگی را با canvas بومی Node تست می‌کند. Electron/Worker مرورگر و PDF فارسی آزمایش نشده‌اند. تست رندر Node پیش از اصلاح ثبت نشده است؛ آزمون اتصال `pdfWorkerIntegration.test.ts` پس از نوشتن، روی snapshot مبنا اجرا شد و شکست خورد (صفر فراخوانی Worker)، و در شاخه فعلی پاس شد. Worker در این آزمون mock است. `@napi-rs/canvas` صرفاً وابستگی تست است؛ `pdfjs-dist` از قبل موجود بود. |
| `852b50a` | fallback خاموش IPC به mock → انتشار خطا، و وضعیت خالی همراه toast هنگام شکست سرویس؛ عملیات موفق صف نتیجه واقعی را مجدداً می‌خواند. | `ipcBridge.test.ts` خطای IPC، نبود preload، پاسخ واقعی صف و نمایش خطا در init را تست می‌کند؛ آزمون پس از اصلاح، روی snapshot مبنا نیز اجرا شد: به جای reject، فهرست جعلی برگرداند و شکست خورد؛ روی شاخه فعلی پاس شد. Electron واقعی تست نشده. |
| `1798fbd` | job صرفاً پس از تأخیر completed می‌شد → موقتاً با وضعیت failed و پیام واضح متوقف می‌شود؛ چاپ دسته‌ای واقعی پیاده نشده است. | `ipcBridge.test.ts` جلوگیری از موفقیت ساختگی را تست می‌کند؛ همان تست پس از اصلاح روی snapshot مبنا اجرا شد و به دلیل completed به جای failed شکست خورد؛ روی شاخه فعلی پاس شد. |
| `1cc96a2` | فقدان source یا PDF خراب خروجی ساختگی موفق ایجاد می‌کرد → خروجی با خطا متوقف می‌شود؛ صفحه PDF واقعاً خالی مجاز است. | تست `rejects export when a nonblank source document is missing` پیش از رفع شکست خورد چون Promise به PDF جعلی resolve شد؛ اکنون پاس می‌شود. برای export تصاویر هنوز پشتیبانی وجود ندارد و اکنون خطا داده می‌شود. |

### وضعیت پس از مرحله ۲ (ناتمام)

| قلم | وضعیت |
|---|---|
| A1 / B1 / J1 رندر و تحلیل | ⚠️ رندر واقعی در کد و تست Node؛ Worker واقعی، فارسی، درصدها و مقیاس در Electron تأیید نشده. thumbnailها همه در state نگهداری می‌شوند؛ ۱۰هزار صفحه/60fps ثابت نشده. |
| I1–I3 fallback Electron | ⚠️ حذف fallback برای bridge شناسایی‌شده؛ Sidecar/driver هنوز در ویندوز آزموده نشده و داده‌های capability ثابت باقی‌اند. |
| G1–G2 و Sidecar | ❌ مسیر چاپ هنوز ناقص، range و تولید payload وصل نشده؛ از آن برای چاپ واقعی استفاده نکنید. |
| H1–H2 | ⚠️ موفقیت جعلی متوقف شده؛ اجرای Batch غیرفعال است. |
| C1/C2 | ⚠️ از جعل محتوا هنگام فقدان source جلوگیری شد؛ تصاویر صادر نمی‌شوند و پروژه ذخیره‌شده هنوز فاقد bytes است. |
| A2–A5، B2، D1–D5، E1–E2، F1–F2، J1، K1 | ⚠️ ایرادات جدول مبنا، جز تغییرات صریح بالا، پابرجا هستند؛ تست جامع نشده‌اند. |

## مرحله ۳ — Vertical Slice

| مورد | وضعیت |
|---|---|
| Playwright + Electron، Drag PDF فارسی ۱۰ صفحه‌ای، بررسی ۱۰ thumbnail، ۲×۲، Invert، Save و بازخوانی سه برگ و پیکسل/موقعیت | ❌ اجرا و پیاده‌سازی نشده؛ نتیجه پاس ادعا نمی‌شود. |
| محیط | Electron binary و مرورگر در sandbox موجود نبودند و `dotnet` در دسترس نیست؛ پرینتر/WinSpool ویندوز نیز موجود نیست. نصب یا اجرای ابزار جایگزین، شواهد Windows واقعی محسوب نمی‌شود. |
| وابستگی‌های پیشنهادی | برای E2E، Playwright و باینری Electron نصب‌شده و runner گرافیکی لازم است؛ برای چاپ واقعی یک رندرکننده PDF به سطح چاپ Windows و آزمون با درایور واقعی لازم است. ارسال بایت PDF به صف RAW عمومی برای همه پرینترها درست نیست. |

کارهای باقی‌مانده: رفع RPC و مالکیت named pipe، قرارداد خطا و correlation، تولید payload و فیلترهای چاپ، print ticket و چاپ رندرشده با آزمون Windows؛ بازیابی پروژه بدون فقدان bytes؛ حفظ تصاویر و Unicode، چرخش export، تمام افکت‌ها، UI روشن، بارگذاری تدریجی و آزمون‌های مقیاس؛ سپس E2E در Electron واقعی. وضعیت کلی فاز ۱ **آماده استفاده تولیدی نیست**.

### اجرای نهایی تکمیلی

پس از افزودن آزمون اتصال Worker، `npx tsc --noEmit` بدون خروجی و با exit 0 و `npm test` با ۴ فایل و ۱۷ تست پاس شد. اجرای دوباره تست‌های IPC و Batch روی snapshot مبنا بعد از رفع انجام شد، نه پیش از تغییر؛ این یک مقایسه پس‌نگر است.

تلاش واقعی برای نصب باینری Electron با `node node_modules/electron/install.js` شکست خورد (exit 1):

```text
RequestError: unable to verify the first certificate
    at ClientRequest.<anonymous> (/home/user/PrinterPDF/node_modules/got/dist/source/core/index.js:970:111)
    at Object.onceWrapper (node:events:634:26)
    at ClientRequest.emit (node:events:531:35)
    at origin.emit (/home/user/PrinterPDF/node_modules/@szmarczak/http-timer/dist/source/index.js:43:20)
    at emitErrorEvent (node:_http_client:108:11)
    at TLSSocket.socketErrorListener (node:_http_client:575:5)
    at TLSSocket.emit (node:events:519:28)
    at emitErrorNT (node:internal/streams/destroy:170:8)
    at emitErrorCloseNT (node:internal/streams/destroy:129:3)
    at process.processTicksAndRejections (node:internal/process/task_queues:89:21)
    at TLSSocket.onConnectSecure (node:internal/tls/wrap:1701:34)
    at TLSSocket.emit (node:events:519:28)
    at TLSSocket._finishInit (node:internal/tls/wrap:1099:8)
    at ssl.onhandshakedone (node:internal/tls/wrap:885:12)
```

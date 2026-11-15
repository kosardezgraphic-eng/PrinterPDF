> **وضعیت فعلی:** این پروژه هنوز برای چاپ تولیدی تأیید نشده است. چاپ مستقیم و Batch فعلاً غیرفعال‌اند؛ خروجی تصویر به PNG/JPEG محدود است و بخشی از افکت‌ها و ابزارهای تعاملی هنوز در PDF اعمال نمی‌شوند. جزئیات و محدودیت‌های بوم یکپارچه را در [گزارش وضعیت](docs/UNIFIED-STUDIO-STATUS.md) ببینید.

# PrintStudio Pro (v1.0 — Phase 1 MVP Complete)

**استودیو حرفه‌ای پیش‌نمایش چاپ، چیدمان (Imposition)، شمارش صفحات، ادغام PDF و مدیریت پرینترهای ویندوز**
الهام‌گرفته از `priPrinter Professional` با معماری مدرن **Electron + React 19 + TypeScript (Strict) + Tailwind CSS 4 + Zustand + pdf-lib + C# (.NET 8) Win32 Spooler Sidecar**.

---

## ۱. معماری سیستم و جریان داده (Architecture & Data Flow)

```text
+-----------------------------------------------------------------------------------+
|                        Renderer Process (/app - React 19 + TS)                    |
|  - Tabbed Ribbon UI (RTL/LTR) + Virtualized Sidebar + 60fps WYSIWYG Sheet Canvas  |
|  - Zustand Store + CommandHistoryManager (Unlimited Undo/Redo) + LRUPageCache     |
|  - LayoutEngine (N-Up 1..10x10, Step & Repeat, Duplex) + EffectsPipeline (Invert) |
|  - CounterEngine (Sheets, Sizes, Cost) + Watermark/Bates/Shamsi Engine            |
+-----------------------------------------+-----------------------------------------+
                                          |
                 Typed IPC via contextBridge (contextIsolation: true,
                         nodeIntegration: false, Strict CSP)
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                         Main Process (/electron - Node.js)                        |
|  - Single-Instance Lock + CLI/Explorer Open-With Handler                          |
|  - SessionStore (.psp Gzipped JSON Project + Crash Recovery Auto-Save)            |
|  - PrinterSidecarClient (Async JSON-RPC 2.0 over Windows Named Pipe)              |
+-----------------------------------------+-----------------------------------------+
                                          |
                     Named Pipe: \\.\pipe\PrintStudioPrinterService
                                  (JSON-RPC 2.0 Stream)
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                   C# (.NET 8) Sidecar (/printer-service/PrinterService.exe)       |
|  - Win32 Spooler P/Invoke (winspool.drv: OpenPrinter, DeviceCapabilities, SetJob) |
|  - System.Printing (LocalPrintServer, PrintQueue, PrintTicket, DEVMODE)           |
|  - Live Status (Ready, Offline, PaperJam, OutOfPaper, LowToner, DoorOpen)         |
|  - Direct Spooler Job Control (Pause, Resume, Restart, Cancel, Purge, Priority)   |
+-----------------------------------------------------------------------------------+
```

---

## ۲. ساختار Monorepo

```text
PrinterPDF/
├── shared/
│   ├── models.ts                  # تمامی مدل‌های داده، تایپ‌های چیدمان، افکت، پرینتر و پروژه .psp
│   └── ipc-channels.ts            # قراردادهای تایپ‌شده IPC و JSON-RPC 2.0
├── printer-service/               # Sidecar بومی ویندوز به زبان C# (.NET 8)
│   ├── PrinterService.csproj      # تنظیمات کامپایل win-x64 Single-File Self-Contained
│   ├── Program.cs                 # سرور Named Pipe و مفسر JSON-RPC 2.0
│   ├── Models/RpcModels.cs        # DTOهای همتا با TypeScript
│   └── Services/
│       ├── WinSpoolInterop.cs     # توابع P/Invoke کتابخانه winspool.drv
│       └── PrinterSpoolerService.cs # مدیریت کامل صف، قابلیت‌های درایور و وضعیت پرینتر
├── electron/                      # پروسه اصلی Electron
│   ├── main.ts                    # پنجره اصلی، قفل تک‌نمونه‌ای، CSP و ثبت کانال‌های IPC
│   ├── preload.ts                 # پل امن contextBridge بدون دسترسی مستقیم Node در UI
│   ├── printerSidecarClient.ts    # کلاینت ارتباط با Named Pipe و مدیریت پروسه Sidecar
│   └── sessionStore.ts            # ذخیره‌سازی فشرده .psp (Gzip) و بازیابی خودکار نشست
├── app/src/                       # رابط کاربری و موتورهای محاسباتی
│   ├── i18n/
│   │   ├── shamsi.ts              # تبدیل تقویم میلادی به هجری شمسی، ارقام فارسی و اعداد رومی
│   │   └── translations.ts        # دیکشنری کامل دوزبانه فارسی (RTL) و انگلیسی (LTR)
│   ├── engine/
│   │   ├── commandHistory.ts      # الگوی Command برای Undo/Redo نامحدود (A5)
│   │   ├── pageCache.ts           # کش حافظه LRU برای مدیریت هزاران صفحه بدون افت فریم
│   │   ├── layoutEngine.ts        # موتور Imposition، ماتریس ۱۰×۱۰، Step & Repeat و دورو (D1–D5)
│   │   ├── counterEngine.ts       # شمارشگر آنی صفحات، برگ فیزیکی و محاسبه تعرفه چاپ (B1–B2)
│   │   ├── effectsPipeline.ts     # پایپ‌لاین غیرمخرب افکت‌ها و Invert برداری/پیکسلی (E1–E2)
│   │   ├── watermarkEngine.ts     # موتور ماکروهای واترمارک، تاریخ شمسی و Bates Numbering (F1–F2)
│   │   ├── pdfService.ts          # ورود/ادغام/تفکیک واقعی PDF و تصویر با pdf-lib (C1–C2)
│   │   ├── ipcBridge.ts           # پل ارتباطی هوشمند با پشتیبانی شبیه‌ساز در محیط مرورگر
│   │   └── engine.test.ts         # مجموعه تست‌های واحد و یکپارچگی Vitest
│   ├── store/
│   │   └── useAppStore.ts         # مدیریت وضعیت سراسری Zustand
│   └── components/
│       ├── ErrorBoundary.tsx      # مدیریت خطای رابط کاربری با پیام فارسی و بازیابی فوری
│       ├── QuickBar.tsx           # نوار دسترسی سریع بالا و انتخابگر هوشمند پرینتر
│       ├── Ribbon.tsx             # ریبون تب‌دار ۹گانه با انتخابگر ماتریس ۱۰×۱۰
│       ├── SidebarPages.tsx       # پنل صفحات گروه‌بندی‌شده، بوک‌مارک، Drag Reorder و منوی راست‌کلیک
│       ├── PreviewWorkspace.tsx   # بوم پیش‌نمایش زنده چندبرگ با خط‌کش، Loupe و پنل‌های Batch/Spooler
│       ├── StatusBar.tsx          # نوار وضعیت پایین، مختصات زنده ماوس، خلاصه شمارش و اسلایدر زوم
│       └── Modals.tsx             # پنجره‌های شمارش، چاپ، راهنمای ۳بعدی دورو، تفکیک، تنظیمات و تور راهنما
├── electron-builder.yml           # تنظیمات ساخت نصاب ویندوز (NSIS + Portable x64)
├── vite.config.ts
└── package.json
```

---

## ۳. دستورات نصب، اجرا، تست و ساخت Installer

```bash
# ۱. نصب وابستگی‌ها
npm install

# ۲. اجرای برنامه در الکترون (دسکتاپ واقعی + فهرست پرینترهای ویندوز) — روی ویندوز
npm run electron:dev
#   این اسکریپت به ترتیب: ensure-sidecar (ساخت خودکار PrinterService.exe اگر نبود) →
#   کامپایل main → build:preload (باندل CJS پریلود) → اجرای هم‌زمان Vite روی ۵۱۷۳ و Electron
#   با VITE_DEV_SERVER_URL=http://localhost:5173

# ۳. اجرای مرورگر (پیش‌نمایش وب؛ پرینترها شبیه‌سازی‌شده‌اند)
npm run dev
#   توجه: در این حالت window.printStudioAPI وجود ندارد، پس فهرست پرینتر ساختگی است و
#   «حاشیهٔ سخت دستگاه» و «ارسال به صف ویندوز» کار نمی‌کنند. برای پرینتر واقعی باید
#   npm run electron:dev اجرا شود.

# ۴. اجرای تست‌های واحد و یکپارچگی (Vitest)
npm test

# ۵. بیلد نسخه وب و کامپایل TypeScript
npm run build

# ۶. کامپایل سرویس پرینتر C# (.NET 8) روی ویندوز (نیازمند .NET 8 SDK)
npm run build:service
#   معادل: dotnet publish printer-service/PrinterService.csproj -c Release -r win-x64 --self-contained true
#   نام قدیمی sidecar:publish همان دستور بالا است و هنوز کار می‌کند.

# ۷. تست مستقیم سرویس پرینتر بدون الکترون (روی ویندوز، PowerShell 5.1+)
npm run test:sidecar
#   معادل: .\scripts\test-printer-service.ps1
#   به \\.\pipe\PrintStudioPrinterService وصل می‌شود، درخواست printer:list می‌فرستد و پاسخ را چاپ می‌کند.

# ۸. ساخت فایل نصاب ویندوز (NSIS Installer + Portable .exe)
npm run build:electron
```

اسکریپت‌های پرینت در `package.json`:

| اسکریپت | کار |
| --- | --- |
| `dev` | فقط Vite روی ۵۱۷۳ — پیش‌نمایش مرورگر، پرینتر شبیه‌سازی‌شده |
| `electron:dev` | ساخت سرویس C# (در صورت نبود) + کامپایل main + `build:preload` + اجرای هم‌زمان Vite و الکترون با `VITE_DEV_SERVER_URL` |
| `build:preload` | باندل `electron/preload.ts` با esbuild به `dist-electron/electron/preload.cjs` (قالب CJS، `--external:electron`) |
| `build:service` | `dotnet publish` سرویس پرینتر برای `win-x64` به‌صورت self-contained |
| `build:electron` | `build:service` → `build:preload` → کامپایل الکترون → `vite build` → pre-flight → `electron-builder --win --x64` |
| `build:electron:nosidecar` | همان مسیر، بدون سرویس C# (فهرست پرینتر در زمان اجرا unavailable می‌شود) |
| `test:sidecar` | اجرای `scripts/test-printer-service.ps1` برای عیب‌یابی Named Pipe |

---

## ۴. گرفتن خروجی ویندوز (NSIS + Portable)

خروجی ویندوز فقط روی ویندوز (یا روی رانر `windows-latest` در GitHub Actions) ساخته می‌شود؛
`electron-builder` برای بسته‌بندی به فایل‌های فشردهٔ Electron ویندوز و ابزار NSIS نیاز دارد که
در محیط لینوکس/کانتینر قابل دریافت نیستند.

**روش ۱ — روی ماشین ویندوزی:**

```powershell
npm ci
npm test
npm run build:service          # .NET 8 SDK لازم است
npm run build:electron         # خروجی در پوشهٔ release/
```

اگر سرویس C# را publish نکنید، بیلد با پیام راهنما متوقف می‌شود. برای ساخت نسخه‌ای بدون سرویس
چاپ (ادغام، ایمپوزیشن، خروجی PDF و پیش‌نمایش کامل کار می‌کند؛ فهرست چاپگرها، حاشیهٔ سخت دستگاه
و ارسال کار به صف در دسترس نخواهند بود و «حاشیه چاپگر» به‌صورت unavailable گزارش می‌شود):

```powershell
npm run build:electron:nosidecar
```

پس از اتمام، دو فایل در `release/` ساخته می‌شود:

- `PrintStudio Pro-1.0.0-x64.exe` — نصاب NSIS (قابل انتخاب محل نصب، میان‌بر دسکتاپ/استارت،
  `perMachine: false` یعنی نصب برای کاربر جاری)
- `PrintStudio Pro-1.0.0-Portable-x64.exe` — نسخهٔ قابل اجرا بدون نصب

**روش ۲ — بدون ماشین ویندوزی (GitHub Actions):** فایل `.github/workflows/build-windows.yml`
را باز کنید، **Run workflow** را بزنید (در صورت نیاز گزینهٔ `skip-sidecar` را روشن کنید). پس از
موفق شدن، قطعهٔ `printstudio-windows-x64` در صفحهٔ Summary همان اجرا هر دو فایل `.exe` را دارد.
این workflow ترتیبِ بالا را اجرا می‌کند: `npm ci` → `npm test` → `build:service` → `build:electron`.

**نکات مهم دربارهٔ خروجی:**

- **امضای کد (code signing) انجام نشده** — گواهی در مخزن نیست؛ ویندوز هنگام اولین اجرا احتمالاً
  هشدار SmartScreen نشان می‌دهد (More info → Run anyway). برای توزیع عمومی باید `win.sign*` با
  یک گواهی معتبر پیکربندی شود.
- **آیکون سفارشی نیست** — پوشهٔ `build/` (buildResources) وجود ندارد، پس electron-builder از آیکون
  پیش‌فرض Electron استفاده می‌کند و فقط هشدار می‌دهد. برای آیکون سفارشی، `build/icon.ico` را اضافه کنید.
- **پیوند فایل‌ها** هنگام نصب ثبت می‌شود: `.pdf` (نمایش) و `.psp` (ویرایش). باز کردن فایل از
  Explorer یا خط فرمان هم پشتیبانی می‌شود: مسیرها از طریق `cli:open-files` به رندرر می‌رسند و
  به‌عنوان سند جدید وارد می‌شوند (سقف هر فایل ۱۲۸ مگابایت).
- `publish` در `electron-builder.yml` به `https://updates.printstudiopro.local/releases` اشاره می‌کند؛
  تا وقتی آن سرور وجود ندارد، **باید** بدون سوییچ `--publish` بیلد کنید (دستورهای بالا همین‌طورند).
- قراردادهای مسیرِ بسته‌بندی (`main`، محل `dist/index.html`، پوشهٔ publish سرویس، قالب CommonJS
  بودن خروجی `dist-electron`) با تست `app/src/engine/packaging.test.ts` پایش می‌شود تا اگر
  تنظیمات از هم فاصله گرفتند، در CI بشکنند — چون این خطاها نصاب را می‌سازند ولی برنامه را روی
  ماشین کاربر می‌خوابانند.

---

## ۵. عیب‌یابی: فهرست پرینترهای واقعی ویندوز خالی است

سه علت ممکن است و هیچ‌کدام پنهان نمی‌شود: علت در همان انتخابگر پرینتر (نوار بالا، پنل
«پرینترهای ویندوز» و فرم چاپ) به‌همراه دکمهٔ «تلاش مجدد» نمایش داده می‌شود.

| پیام در UI | علت | راه‌حل |
| --- | --- | --- |
| `Electron preload bridge is unavailable` | پریلود لود نشده است | `npm run build:preload` و بعد `npm run electron:dev`. در حالت `sandbox: true` فقط یک باندل CommonJS تک‌فایل لود می‌شود؛ خروجی `tsc` برای `electron/preload.ts` قالب ESM دارد و بی‌صدا رد می‌شود، پس `window.printStudioAPI` تعریف نمی‌ماند. |
| `Browser preview: the printer list is simulated` | برنامه در مرورگر باز شده، نه در الکترون | برای دیدن پرینتر واقعی `npm run electron:dev` را اجرا کنید؛ `npm run dev` عمداً فقط Vite است و `VITE_DEV_SERVER_URL` را هم ست نمی‌کند. |
| `PrinterService.exe was not found` | سرویس C# ساخته نشده | `npm run build:service` (همان `dotnet publish ... -r win-x64 --self-contained true`؛ نبود `-r win-x64` پوشهٔ `printer-service/bin/Release/net8.0-windows/win-x64/publish` را که `electron-builder.yml` کپی می‌کند می‌سازد). `npm run electron:dev` خودش `scripts/ensure-sidecar.mjs` را اجرا می‌کند. |
| `no process is listening on \\.\pipe\PrintStudioPrinterService` | سرویس بالا نیامده یا Pipe بسته شده | `PrinterService.exe` را دستی اجرا کنید و `npm run test:sidecar` را بزنید. |
| `PrinterService.exe stopped before the app connected (exit code N)` + آخرین خروجی stderr | سرویس هنگام استارت crash کرده (Spooler خاموش، دسترسی Pipe) | متن stderr در پنل چاپ می‌شود؛ با `Get-Service Spooler` وضعیت سرویس چاپ ویندوز را ببینید. |
| `Windows reported no printers installed` | ویندوز واقعاً پرینتری گزارش نکرده | در `Printers & scanners` پرینتر نصب کنید، سپس «تلاش مجدد». |
| `DllNotFoundException` در `MS.Win32.HwndSubclass` / کرش با کد `0xC000041D` | در publish تک‌فایل، DLLهای native مربوط به WPF (`PresentationNative_cor3.dll`، `wpfgfx_cor3.dll`، `D3DCompiler_47_cor3.dll`) بیرون از باندل می‌مانند و هر تماس با `System.Printing` پروسه را می‌اندازد | `IncludeNativeLibrariesForSelfExtract=true` در `printer-service/PrinterService.csproj` این را حل می‌کند (در مخزن تنظیم شده)؛ بعد از هر تغییر در سرویس `npm run build:service` را دوباره اجرا کنید |
| هر خطای دیگر از سرویس | — | آخرین خطاها در `%APPDATA%\PrintStudioPro\printer-service.log` نوشته می‌شوند و مسیر همین فایل در پیام UI چاپ می‌شود (`Service log: …`) |

ترتیب بررسی روی ویندوز:

```powershell
npm run build:service         # ۱. PrinterService.exe (خروجی: printer-service/bin/Release/net8.0-windows/win-x64/publish)
npm run build:preload         # ۲. باندل پریلود؛ بدون آن window.printStudioAPI تعریف نمی‌شود
npm run build:electron-main   # ۳. کامپایل پروسهٔ اصلی
npm run electron:dev          # ۴. Vite + الکترون با VITE_DEV_SERVER_URL=http://localhost:5173
npm run test:sidecar          # ۵. اگر فهرست خالی ماند: تست مستقیم Named Pipe بدون الکترون
```

دکمهٔ «تلاش مجدد» دوباره `printer:list` را صدا می‌زند و نتیجه را در استور می‌نویسد؛ علت خطا در دو
فیلد نگه داشته می‌شود: `printerServiceError` پیام همان فراخوانی است و `printerServiceNote` توضیح
سایدکار از کانال `printer:status-note` (هرچه `PrinterSidecarClient.describeFailure` می‌سازد). اگر
هیچ‌کدام نباشد و فهرست خالی بماند، متن جایگزین «ویندوز پرینتری گزارش نکرد» نمایش داده می‌شود —
فهرست خالی هرگز بدون توضیح نمی‌ماند. قراردادها در
`app/src/engine/printerListDiagnostics.test.ts`، `app/src/engine/sidecarLog.test.ts` و
`app/src/engine/packaging.test.ts` تست شده‌اند.

### ترتیب خواندن پرینترها و لاگ سرویس

`PrinterService.exe` فهرست را این‌طور می‌سازد (در `PrinterSpoolerService.ListPrinters`):

۱. `EnumPrinters` از `winspool.drv` (بدون هیچ وابستگی به WPF) — اگر پرینتری برگرداند، همین جواب
   نهایی است و `System.Printing` اصلاً صدا زده نمی‌شود. پرینتر پیش‌فرض هم با `GetDefaultPrinter`
   خوانده می‌شود، نه با property وابسته‌به‌WPF.
۲. فقط اگر مرحلهٔ اول خالی بود، `LocalPrintServer`/`System.Printing` برای گرفتن اطلاعات کامل‌تر
   (محل صف، PrintTicket زندهٔ درایور) امتحان می‌شود.
۳. هر دو خالی بود → خطای `Windows returned no printer queues …` که در UI همان پنل علت را نشان
   می‌دهد.

هر تماس `System.Printing` (شامل شمارش کارهای صف در `ListJobs`) داخل `try/catch` است و خطایش با
`Program.Log` نوشته می‌شود، چون یک درایور بدنباید پروسه را بکشد: اگر پروسه بمیرد، پیام بعدی که
کاربر می‌بیند یک خطای Pipe بی‌ربط است، نه علت واقعی. `Program.Log` هر خط را هم روی stderr می‌نویسد
(که `printerSidecarClient.ts` دنبالهٔ آن را در پنل نشان می‌دهد) و هم در
`%APPDATA%\PrintStudioPro\printer-service.log` ذخیره می‌کند؛ `AppDomain.CurrentDomain.UnhandledException`
و `TaskScheduler.UnobservedTaskException` هم به همین فایل می‌نویسند تا کرش‌های بدون console قابل
ردیابی بمانند. فایل در ۱ مگابایت چرخش می‌کند (truncate هنگام استارت).

برای دیدن لاگ از خط فرمان:

```powershell
Get-Content "$env:APPDATA\PrintStudioPro\printer-service.log" -Tail 40
```

---

## ۶. میز کار خالی، درگ فایل و دامنهٔ کلیک راست

### باز شدن برنامه
`initializeWorkspace` فقط وضعیت پرینتر را می‌خواند و دیگر هیچ سند نمونه‌ای تولید نمی‌کند. تا وقتی
فایلی وارد نشده باشد پیش‌نمایش حالت خالی («هیچ سندی در میز کار باز نیست») را نشان می‌دهد، پس صفحات
واقعی با داده آزمایشی قاطی نمی‌شوند. همچنین اسناد موجود را پاک نمی‌کند، چون یک remount (hot reload
یا StrictMode) نباید کار اپراتور را از بین ببرد. داده نمونه برای تست از کنسول در دسترس است:
`useAppStore.getState().loadSampleWorkspace()` — دکمهٔ «بارگذاری نمونه» از Ribbon و از صفحهٔ خالی
حذف شده است.

### رها کردن فایل روی برنامه
- روی **برگهٔ پیش‌نمایش**: فایل تصویر به‌عنوان اورلی روی همان صفحه می‌نشیند؛ PDF و بقیهٔ فایل‌ها سند
  جدید می‌شوند (رفتار مستندشده در [docs/IMAGE-OVERLAYS.md](docs/IMAGE-OVERLAYS.md)).
- روی **هر جای دیگر** (حاشیهٔ پیش‌نمایش، ریبون، سایدبار، یا کلیپ‌بورد با `Ctrl+V`): هر فایل سند جدید
  می‌شود؛ بیرون از برگه هیچ تصویری اورلی نمی‌شود.
- بعد از ورود فایل، پیش‌نمایش به اولین صفحهٔ جدید می‌رود (`requestPreviewPage`). قبلاً صفحات
  اضافه‌شده در انتهای میز کار می‌ماندند و همان شیت قبلی روی صفحه بود، یعنی دقیقاً «انگار فایل وارد
  نشد».
- overlay راهنمای درگ `pointer-events-none` است و فقط با گذار شمارندهٔ `dragenter`/`dragleave` از
  صفر روشن یا خاموش می‌شود. قبلاً هر `dragover` یک re-render از کل شیت‌ها و هر `dragleave` روی عناصر
  فرزند یک ناپدیدشدن بود؛ روی ماشین شلوغ ویندوز ویندوز درگ را لغو می‌کرد و فایل هیچ‌وقت وارد نمی‌شد.
- اگر هیچ handlerی درگ را نگیرد، `App.tsx` در سطح window پیش‌فرض مرورگر را می‌گیرد، و در
  `electron/main.ts` هم `will-navigate` فقط آدرسِ خودِ برنامه را مجاز می‌داند؛ در غیر این صورت یک فایل
  رهاشده کل پنجره را به نمایش‌دهندهٔ PDF تبدیل می‌کند.

### کلیک راست روی بندانگشتی‌ها
همهٔ فرمان‌های منو روی **کل صفحات انتخاب‌شده** اعمال می‌شوند، نه فقط روی صفحه‌ای که رویش کلیک راست
شده: چرخش، تکثیر، تکرار آرایه‌ای، درج صفحهٔ خالی بعد از هر صفحه، معکوس رنگ، حذف، استخراج PDF و
معکوس کردن وضعیت چاپ. خط بالای منو دامنهٔ عمل و تعداد صفحات را می‌گوید. برای «معکوس کردن وضعیت چاپ
همهٔ صفحات» یک آیتم جدا در منو باقی مانده است. جزئیات:
[docs/PRINT-SELECTION.md](docs/PRINT-SELECTION.md).

### چیزی که این‌جا تأیید نشده
رفتارهای بالا با jsdom پوشش داده شده‌اند (`emptyStartup.test.ts`، `fileDropUI.test.ts`،
`windowDropUI.test.ts`، `sidebarContextMenuUI.test.ts`). درگ واقعی با فایل از Explorer، رفتار
Chromium/Electron روی ویندوز، و روان‌بودن پیش‌نمایش هنگام درگ در این محیط قابل اجرا نبودند و **تأیید
نشده‌اند**.

## ۷. رندر وکتوری پیش‌نمایش، بازنشانی تنظیمات و پریست‌ها

### پیش‌نمایش دقیق فایل‌های وکتور (`previewFidelity`)
مقدار پیش‌فرض `"crisp"` است. در این حالت همان صفحه‌ای که داخل یک خانهٔ روی برگه دیده می‌شود، **دوباره از
روی دستور‌های رسم خودِ PDF** در همان اندازه رندر می‌شود (`app/src/engine/vectorPreview.ts` +
`pdfRendererWorker.ts`) و روی بندانگشتیِ import با CSS یکسان (`pageImageStyle`) نشان داده می‌شود؛ پس
خطِ ۰٫۲pt خط می‌ماند نه طوسی محو. خروجی چاپ و PDF دست‌نخورده است: `exportMergedOrImposedPdf` از همیشه
صفحهٔ منبع را به‌صورت وکتور embed می‌کند؛ چیزی که عوض شد فقط دیدن است.

مصرف، با سقف‌های زیر مهار شده — نه با ساده‌سازی تصویر:

- فقط سلول‌های داخل viewport (IntersectionObserver) درخواست می‌دهند؛ شیت هرگز یک‌جا رستر نمی‌شود.
- اندازه‌ها به پلهٔ ۹۶px گرد می‌شوند و هر ضلع حداکثر ۲۶۰۰px، تا زوم کردن هر بار کل کش را باطل نکند.
- حداکثر ۲ رندر هم‌زمان؛ بقیه در صف می‌مانند و با لغو شدن اشتراک، رندر در حال انجام **cancel** می‌شود.
- کش دوبار محدود است: تعداد تصویر و **حجم بایتی** (`vectorFrameBytes`؛ پیش‌فرض ۴۸MB، از
  `maxCachePages × 96KB` بین ۲۴ تا ۱۹۲MB) و هنگام اخراج، `ImageBitmap.close()` صدا زده می‌شود تا
  حافظه واقعاً برگردد.
- حداکثر ۴ سند parse‌شده باز می‌ماند؛ بیرون رفتن از این پنجره یعنی یک parse دوباره، نه import دوباره.
- صفحه‌ای که یک بار شکست بخورد برای همان اندازه دیگر تلاش نمی‌شود؛ fallback همیشه بندانگشتی است
  (تار بهتر از خالی).
- بایت‌های فایل **transfer نمی‌شوند** (کپی می‌شوند)، چون PDF.js بفرسته‌شده را detach می‌کند و آن‌وقت
  export/چاپ روی فایلی که فقط دیده شده می‌شکست.

با `"fast"` رفتار قبلی برمی‌گردد (فقط PNG داخل حافظه). سوییچ crisp در تب View ریبون است و «خالی‌کردن کش
پیش‌نمایش» هم همان‌جا (از مودال تنظیمات به آن‌جا منتقل شد، چون یک کنش لحظه‌ای است نه یک تنظیم);
previewFidelity خودش در مودال تنظیمات هم هست. جزئیات و عددِ تست‌ها:
[docs/PREVIEW-QUALITY.md](docs/PREVIEW-QUALITY.md).

### پروفایل‌های تنظیمات شیت — و سطری که همه‌چیز را به پیش‌فرض برمی‌گرداند
پروفایل‌ها و دکمهٔ بازنشانی **یک ویژگی‌اند، نه دو تا**: اولین سطر لیست «پیش‌فرض خود برنامه» است، کلید
میانبرش `Alt+F6` است، و زدنش همان `resetAllSettings()` است — یعنی `layout`، `effects`، `watermark`،
`pageNumbering` و `settings` به مقدار اولیه برمی‌گردند؛ **فایل‌ها، صفحات، بوک‌مارک‌ها و اورلی‌ها
دست‌نخورده می‌مانند** و `settings.language` عوض نمی‌شود تا رابط وسط کار زیر کاربر زبان عوض نکند. این یک
قدم undo است (`Ctrl+Z` بخش‌های شیت را برمی‌گرداند؛ بخش تنظیمات عمومی در snapshot نیست). در مودال تنظیمات
این سطر برای امنیت **دو کلیک** می‌خواهد؛ از منوی ریبون و از کلید میانبر، چون خودِ انتخاب یک لیست، تصمیم
است، یک‌کلیک اعمال می‌شود.

بقیهٔ سطرها پروفایل‌های خود کاربرند (`SettingsPreset` = `layout` + `effects` + `watermark` +
`pageNumbering` + نام + کلید + زمان‌ها). **تنظیمات خود برنامه عملاً بیرون از پروفایل است**: قبلاً `settings`
هم ذخیره می‌شد، ولی «چیدمان همیشگی» را که اعمال می‌کردی، زبان و واحد و تعرفه هم زیر دستت ری‌ست می‌شد.
فایل قدیمی که هنوز بلوک `settings` دارد خوانده می‌شود و همان بلوک موقع `sanitizeSettingsPresetList` دور
ریخته می‌شود (مهاجرت ندارد، چون دیگر خواسته شده).

ویرایش با یک **دکمهٔ `Edit` روی خود سطر** انجام می‌شود (سطرِ بسته فقط «اعمال» است، وگرنه لیستِ دسترسی سریع
دیگر سریع نیست): با زدنش همان سطر باز می‌شود و **تغییر نام** inline (Enter/blur ثبت، Esc لغو؛ نام تکراری رد
می‌شود نه اینکه `A4 (2)` بسازد)، **ضبط کلید میانبر**، **ذخیرهٔ دوبارهٔ چیدمان فعلی روی همان پروفایل** (نام،
کلید و تاریخ ایجاد می‌مانند)، و **حذف با دو کلیک** (تأیید بعد از ۶ ثانیه می‌سوزد) را نشان می‌دهد. دکمهٔ Edit
در منوی ریبون هم هست و مودال تنظیمات را روی همین سطرِ باز شده باز می‌کند. سطر پیش‌فرض قابل ویرایش/حذف نیست و
هرگز در فایل ذخیره نمی‌شود. دسترسی سریع: منوی `Layers` در ریبون. `restorePreferences()` هنگام بالا آمدن
برنامه هم تنظیمات و هم پروفایل‌ها از دیسک می‌خواند — قبلاً `settings.json` فقط نوشته می‌شد و هر بار اجرا
همه‌چیز بی‌صدا به پیش‌فرض برمی‌گشت. محل ذخیره:
`%APPDATA%\PrintStudioPro\settings-presets.json` (در مرورگر: `localStorage['printstudio:presets']`)؛ جدا
از فایل تنظیمات، تا یک بازنشانی نتواند پروفایل‌های عمدی را پاک کند.

### کلید میانبر برای هر پروفایل
`isAssignableShortcut` فقط این‌ها را می‌پذیرد: `Alt+F7` تا `Alt+F12`، یا `Ctrl+Alt` بعلاوهٔ یک حرف/رقم.
`Alt+F6` رزروِ سطر پیش‌فرض است. بقیهٔ کلیدها (کلید تنها، `Ctrl+3` که تب مرورگر را عوض می‌کند، `Meta+…`،
`Alt+D`) رد می‌شوند — و رد کردن، **کل عمل را** رد می‌کند: `saveSettingsPreset('name', chord)` هیچ ذخیرهٔ
نیمه‌ای نمی‌کند تا پروفایلی با کلیدِ بی‌عمل وسط لیست نباشد. متن کلید قبل از canonicalise شدن با `alt+ f6`
هم مقایسه می‌شود، پس پیام «این کلید رزرو است» به‌جای «کلید نامعتبر» می‌آید. ضبط کلید در فاز capture گوش
می‌دهد و `shortcutRecordingFor` را ست می‌کند؛ هندلر سراسری `App.tsx` **قبل** از گارد «کلیدها را در input
نادیده بگیر» نشسته (کلید ترکیبی هیچ‌وقت تایپ نیست) و تا ضبط‌گر باز است کنار می‌رود، وگرنه همان لحظهٔ
فشاردن کلید، پروفایل را هم آتش می‌زد. Esc لغو می‌کند و یک ✕ کلید را برمی‌دارد. جزئیات:
[docs/SETTINGS-PRESETS.md](docs/SETTINGS-PRESETS.md).

### جابه‌جایی آزاد تصویر و شکل روی صفحه
درصد‌های یک اورلی نسبت به **کادر محتوا** سنجیده می‌شوند، ولی چیز که آن را clip می‌کند **سلول** (یا کل
برگه) است — و این دوتا یکی نیستند. `overlayLimitsForBox()` در `engine/overlayGeometry.ts` همان کادر و همان
ناحیهٔ قابل‌چاپ را به حد مجاز درصدی تبدیل می‌کند، و درگ، کلیدهای جهت‌دار، شش دکمهٔ تراز، و فیلدهای
`X (mm)`/`Y (mm)` پنل همه همین یک پاسخ را می‌پرسند (قانونِ دوگانه یعنی «تراز چپ» شکلی را لبه‌ای می‌گذارد
که ماوس به آن نمی‌رسد). قانون: **مرکز داخل ناحیهٔ قابل‌چاپ می‌ماند، خودش می‌تواند از هر لبه‌ای بیرون بزند** —
پس لوگو را می‌شود به حاشیه برد، روی خط برش گذاشت، یا برای بلید نیمه‌اش را بیرون برد، و هرگز گم نمی‌شود چون
نصفش همیشه روی برگه است. فیلد عددی اما بحث‌کردنی نیست: `-20` یعنی `-20` (مقدار نامحدود/NaN رد می‌شود).
تصویرِ تازه‌رهاشده هنوز کامل داخل کادر می‌نشیند؛ باز کردنِ قلمرو کار درگ و این فیلدهاست. جزئیات:
[docs/IMAGE-OVERLAYS.md](docs/IMAGE-OVERLAYS.md).

### ابزار اشکال هندسی در تب Insert
`ShapePicker` يازده شکل را یک‌کلیکی می‌گذارد: مستطیل، **مربع**، مستطیل گرد، دایره، حلقه، مثلث، لوزی،
چندضلعی، ستاره، خط و پیکان. خطِ هر شکل **یک‌جا** تعریف شده — `engine/shapes.ts` دستورهای `M/L/C/Z` را بر
مبنای **مرکز کادر و بر حسب میلی‌متر** می‌سازد و سه مصرف‌کننده فقط واحدها را عوض می‌کنند: SVG لایهٔ تعاملی،
`renderOverlaysOnCanvas` برای raster، و `drawSvgPath` در `pdfService.ts` که شکل را به‌صورت **بردار** روی
برگه می‌گذارد (نه bitmap، وگرنه خط ۰٫۲ نقطه‌ای موقع چاپ به‌شکل یک لکهٔ خاکستری درمی‌آمد). قوس‌ها بژیهٔ
بسته‌اند نه `A`، چون parser مسیرِ PDF نیاز به آن ندارد. کادر پیش‌فرض اول میلی‌متر حساب می‌شود بعد به درصد
تبدیل می‌شود، پس دایره روی A4 گرد می‌ماند (درصد روی صفحهٔ ۲۱۰×۲۹۷ این ضمانت را نمی‌دهد). پنل شکل: رنگ
داخل/بدونِ آن، رنگ و ضخامت (نقطه) و نوع خط، `lineCap`، شعاع گوشه (م‌م)، تعداد اضلاع ستاره/چندضلعی، عمق
ستاره، شفافیت، چرخش + اسنپ ۹۰ درجه، عرض/ارتفاع/XY میلی‌متری، تراز، مبنا (صفحه/برگه) و دامنه با بازهٔ
دستی، ترتیب لایه، نسخه، و حذف. هر عددی که از فایل پروژه یا از پنل می‌آید از
`normalizeShapeStyle` رد می‌شود (رنگ فقط `#rgb`/`#rrggbb`/`transparent`، `sides` بین ۳ و ۱۶)، پس نمی‌توان
مسیرِ ترکیده یا `url(#gradient)` داخل SVG تزریق کرد. جزئیات: [docs/SHAPES.md](docs/SHAPES.md).

### چیزی که این‌جا تأیید نشده
روان‌بودن واقعی اسکرول/زوم با ۶۰fps، RSS عملی روی ویندوز، رفتار `Alt+F6` وقتی ویندوز آن را برای جابه‌جایی
بین پنجره‌های یک برنامه رزرو می‌کند (`Alt+F6` در ویندوز معنا دارد؛ رسیدن یا نرسیدنش به renderer این‌جا
قابل تست نیست، پس همان سطرِ قابل‌کلیکِ «پیش‌فرض خود برنامه» راه تضمین‌شده است)، و خواندن/نوشتن `%APPDATA%`
(این محیط Linux است و Electron ندارد) — همه **تأییدنشده**. پوشش خودکار: `vectorPreview.test.ts`،
`crispPreviewUI.test.ts`، تست‌های وکتوریِ واقعی داخل `pdfRealRenderer.test.ts`، `sheetPresets.test.ts`،
`settingsResetAndPresets.test.ts`، `settingsRestoreRace.test.ts`، `settingsShortcutsUI.test.ts`،
`shapes.test.ts`، `shapesUI.test.ts`، `overlayGeometry.test.ts` و `imageOverlayUI.test.ts`.
دو چیز که در این دور **نمی‌توان** تأیید کرد و ادعایش نمی‌کنیم: ترتیب لایه‌ها در پیش‌نمایش از آرایهٔ
`overlays` دنبال می‌شود، ولی خروجی PDF هر نوع را در نوبت خودش می‌کشد (اول شکل‌ها، بعد متن، بعد تصویرها) —
پس «آوردن یک شکل روی متن» در پیش‌نمایش دیده می‌شود و در چاپ نه؛ این رفتار از قبل برای تصویر/متن همین‌طور
بود و در این دور اصلاح نشده. و اینکه آیا یک driver واقعی هیرلاین ۰٫۲ نقطه‌ایِ برداری را مثل Chromium
می‌رند کند، فقط با کاغذ روشن می‌شود.

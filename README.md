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

# ۲. اجرای محیط توسعه و پیش‌نمایش زنده
npm run dev

# ۳. اجرای تست‌های واحد و یکپارچگی (Vitest)
npm test

# ۴. بیلد نسخه وب و کامپایل TypeScript
npm run build

# ۵. کامپایل سرویس پرینتر C# (.NET 8) روی ویندوز (نیازمند .NET 8 SDK)
npm run sidecar:publish
# معادل: dotnet publish printer-service/PrinterService.csproj -c Release

# ۶. ساخت فایل نصاب ویندوز (NSIS Installer + Portable .exe)
npm run build:electron
```

---

## ۴. گرفتن خروجی ویندوز (NSIS + Portable)

خروجی ویندوز فقط روی ویندوز (یا روی رانر `windows-latest` در GitHub Actions) ساخته می‌شود؛
`electron-builder` برای بسته‌بندی به فایل‌های فشردهٔ Electron ویندوز و ابزار NSIS نیاز دارد که
در محیط لینوکس/کانتینر قابل دریافت نیستند.

**روش ۱ — روی ماشین ویندوزی:**

```powershell
npm ci
npm test
npm run sidecar:publish        # .NET 8 SDK لازم است
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
این workflow ترتیبِ بالا را اجرا می‌کند: `npm ci` → `npm test` → `sidecar:publish` → `build:electron`.

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

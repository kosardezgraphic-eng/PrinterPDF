import React, { useEffect, useState } from 'react';
import { useAppStore } from './store/useAppStore';
import { ErrorBoundary } from './components/ErrorBoundary';
import { QuickBar } from './components/QuickBar';
import { Ribbon } from './components/Ribbon';
import { SidebarPages } from './components/SidebarPages';
import { PreviewWorkspace } from './components/PreviewWorkspace';
import { StatusBar } from './components/StatusBar';
import { ModalsAndToasts } from './components/Modals';
import { TextControlPanel } from './components/TextControlPanel';
import { NumberingControlPanel } from './components/NumberingControlPanel';
import { ImageControlPanel } from './components/ImageControlPanel';
import { ShapeControlPanel } from './components/ShapeControlPanel';
import { WatermarkControlPanel } from './components/WatermarkControlPanel';
import { routeDroppedFiles } from './engine/imageImport';
import { buildSheetPresetRows, findPresetIdByShortcut } from './engine/sheetPresets';
import { formatShortcut } from '@shared/models';
import { listenForNativeOpenFiles } from './engine/nativeFiles';

/** Whether this page load has already read the persisted settings back (see the effect in `App`). */
let preferencesRestored = false;

export const App: React.FC = () => {
  const {
    settings,
    selectedOverlayId,
    overlays,
    watermark,
    pages,
    zoomPercent,
    initializeWorkspace,
    undo,
    redo,
    toggleGlobalInvert,
    duplicatePages,
    deletePages,
    removeOverlay,
    selectAllForPrint,
    setZoomPercent,
    setModalState,
    exportMergedOrImposedPdf,
    importFiles,
    addToast,
    restorePreferences,
  } = useAppStore();

  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [watermarkPanelOpen, setWatermarkPanelOpen] = useState(false);

  useEffect(() => {
    void initializeWorkspace();
  }, [initializeWorkspace]);

  // Settings and saved profiles are written to disk as they change, so they have to be read back once,
  // before the operator touches anything — otherwise a restart quietly throws away the whole setup.
  // Once per load, and only once: a StrictMode double-mount or a hot reload must not overwrite the
  // values the operator has been editing in this session with whatever was on disk a moment ago.
  useEffect(() => {
    if (preferencesRestored) return;
    preferencesRestored = true;
    void restorePreferences();
  }, [restorePreferences]);

  // A file opened from Explorer or the command line reaches the app as a path only, so it is read
  // through the desktop bridge. In a browser there is no bridge and nothing subscribes at all.
  useEffect(() => {
    const stop = listenForNativeOpenFiles(
      files => {
        const { documents } = routeDroppedFiles(files, false); // a file from Explorer is a new document, never an overlay
        if (documents.length) void importFiles(documents);
      },
      error =>
        addToast({
          type: 'warning',
          title: settings.language === 'fa' ? 'فایل باز نشد' : 'Cannot open the file',
          message: error instanceof Error ? error.message : String(error),
        }),
    );
    return stop;
  }, [importFiles, addToast, settings.language]);

  // Close only the watermark settings panel when the user clicks outside it.
  // The watermark's enabled state is independent and remains unchanged.
  useEffect(() => {
    if (!watermarkPanelOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-watermark-control-panel],[data-watermark-panel-trigger]')) return;
      setWatermarkPanelOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [watermarkPanelOpen]);

  // Synchronize HTML dir (RTL/LTR) and lang
  useEffect(() => {
    const dir = settings.language === 'fa' ? 'rtl' : 'ltr';
    document.documentElement.setAttribute('dir', dir);
    document.documentElement.setAttribute('lang', settings.language);
  }, [settings.language]);

  // Principle #1: Prevent any Unhandled Promise Rejection from crashing or going silent
  useEffect(() => {
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      event.preventDefault();
      addToast({
        type: 'warning',
        title:
          settings.language === 'fa'
            ? 'عملیات پس‌زمینه مدیریت شد'
            : 'Background operation handled safely',
        message: String(event.reason?.message || event.reason || ''),
      });
    };
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () =>
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
  }, [addToast, settings.language]);

  // Comprehensive Keyboard Shortcuts & Clipboard Paste (A1)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Chords are resolved against the profile list, so `Alt+F6` is not a special case any more — it is
      // the chord the built-in defaults row owns, and a recorded profile behaves the same way. The lookup
      // runs above the "ignore keys typed into a field" guard because a chord carrying Alt or Ctrl is
      // never text input, and a shortcut that only works when the caret happens to be on a button is not
      // a shortcut. Nothing that does not match is swallowed: an unassigned `Ctrl+Alt+Q` still belongs to
      // the browser.
      const chord = formatShortcut(e);
      if (chord) {
        const state = useAppStore.getState();
        // While the panel is waiting for a key to learn, no chord fires — the press is being recorded.
        if (!state.shortcutRecordingFor) {
          const rows = buildSheetPresetRows(state.settingsPresets, state.settings.language === 'fa');
          const presetId = findPresetIdByShortcut(rows, chord);
          if (presetId) {
            e.preventDefault();
            state.applySettingsPreset(presetId);
            return;
          }
        }
      }

      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }

      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if (
        (ctrl && e.key.toLowerCase() === 'y') ||
        (ctrl && e.shiftKey && e.key.toLowerCase() === 'z')
      ) {
        e.preventDefault();
        redo();
        return;
      }
      if (ctrl && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setModalState('print', true);
        return;
      }
      if (ctrl && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void exportMergedOrImposedPdf(false);
        return;
      }
      if (ctrl && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        toggleGlobalInvert();
        return;
      }
      if (ctrl && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        const highlighted = pages.filter((p) => p.isHighlighted).map((p) => p.id);
        duplicatePages(highlighted);
        return;
      }
      if (ctrl && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selectAllForPrint(true);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const selectedOverlay = useAppStore.getState().selectedOverlayId;
        if (selectedOverlay) {
          e.preventDefault();
          removeOverlay(selectedOverlay);
          return;
        }
        e.preventDefault();
        const highlighted = pages.filter((p) => p.isHighlighted).map((p) => p.id);
        deletePages(highlighted);
        return;
      }
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setZoomPercent(zoomPercent + 15);
        return;
      }
      if (e.key === '-') {
        e.preventDefault();
        setZoomPercent(zoomPercent - 15);
      }
    };

    // A picture dropped on a sheet becomes an editable overlay; dropped anywhere else it is a new document/page.
    const onWindowDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types && Array.from(e.dataTransfer.types).includes('Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    };
    const onWindowDrop = (e: DragEvent) => {
      const alreadyRouted = e.defaultPrevented; // the preview already took this drop onto a page
      const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
      const hasFiles =
        files.length > 0 ||
        (!!e.dataTransfer && Array.from(e.dataTransfer.types ?? []).includes('Files'));
      // The browser default for a file drop is navigation: the window would be replaced by the
      // dropped file itself (and in a packaged app it would simply look like the UI fell apart).
      // That has to be stopped even when the app cannot use the file, hence before the early return.
      if (hasFiles) e.preventDefault();
      if (alreadyRouted || files.length === 0) return;
      const { documents } = routeDroppedFiles(files, false); // outside the sheet even a picture is a new document
      if (documents.length === 0) return;
      void importFiles(documents);
    };

    const onPaste = (e: ClipboardEvent) => {
      const files = e.clipboardData?.files
        ? Array.from(e.clipboardData.files)
        : [];
      if (files.length > 0) {
        e.preventDefault();
        void importFiles(files);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('paste', onPaste);
    window.addEventListener('dragover', onWindowDragOver);
    window.addEventListener('drop', onWindowDrop);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('dragover', onWindowDragOver);
      window.removeEventListener('drop', onWindowDrop);
    };
  }, [
    pages,
    zoomPercent,
    undo,
    redo,
    toggleGlobalInvert,
    duplicatePages,
    deletePages,
    removeOverlay,
    selectAllForPrint,
    setZoomPercent,
    setModalState,
    exportMergedOrImposedPdf,
    importFiles,
  ]);

  return (
    <ErrorBoundary>
      <div
        className={`flex h-screen w-screen flex-col overflow-hidden ${
          settings.theme === 'light' ? 'theme-light invert hue-rotate-180' : ''
        }`}
      >
        <QuickBar />
        <Ribbon onOpenWatermarkPanel={() => setWatermarkPanelOpen(true)} />
        <div className="flex flex-1 overflow-hidden">
          <SidebarPages />
          <PreviewWorkspace onCursorMoveMm={setCursorPos} />
          {selectedOverlayId && overlays.some(o=>o.id===selectedOverlayId && o.kind==='text') && <TextControlPanel />}
          {selectedOverlayId && overlays.some(o=>o.id===selectedOverlayId && o.kind==='numbering') && <NumberingControlPanel />}
          {selectedOverlayId && overlays.some(o=>o.id===selectedOverlayId && o.kind==='image') && <ImageControlPanel />}
          {selectedOverlayId && overlays.some(o=>o.id===selectedOverlayId && o.kind==='shape') && <ShapeControlPanel />}
          {watermarkPanelOpen && <WatermarkControlPanel onClose={() => setWatermarkPanelOpen(false)} />}
        </div>
        <StatusBar cursorPos={cursorPos} />
        <ModalsAndToasts />
      </div>
    </ErrorBoundary>
  );
};

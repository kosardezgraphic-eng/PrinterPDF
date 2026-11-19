import React, { useEffect, useState } from 'react';
import { useAppStore } from './store/useAppStore';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppShell } from './components/AppShell';
import { t } from './i18n/translations';
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
import { BookletControlPanel } from './components/BookletControlPanel';
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
  const [bookletPanelOpen, setBookletPanelOpen] = useState(false);

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
    return (
    <ErrorBoundary>
      <AppShell
        theme={settings.theme}
        labels={t(settings.language).shell}
        topbar={<QuickBar />}
        navigation={
          <Ribbon
            onOpenWatermarkPanel={() => setWatermarkPanelOpen(true)}
            onOpenBookletPanel={() => setBookletPanelOpen(true)}
          />
        }
        workspace={
          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <SidebarPages />
            <PreviewWorkspace onCursorMoveMm={setCursorPos} />
            {selectedOverlayId && overlays.some(o => o.id === selectedOverlayId && o.kind === 'text') && <TextControlPanel />}
            {selectedOverlayId && overlays.some(o => o.id === selectedOverlayId && o.kind === 'numbering') && <NumberingControlPanel />}
            {selectedOverlayId && overlays.some(o => o.id === selectedOverlayId && o.kind === 'image') && <ImageControlPanel />}
            {selectedOverlayId && overlays.some(o => o.id === selectedOverlayId && o.kind === 'shape') && <ShapeControlPanel />}
            {watermarkPanelOpen && <WatermarkControlPanel onClose={() => setWatermarkPanelOpen(false)} />}
            {bookletPanelOpen && <BookletControlPanel onClose={() => setBookletPanelOpen(false)} />}
          </div>
        }
        statusBar={<StatusBar cursorPos={cursorPos} />}
        overlays={<ModalsAndToasts />}
      />
    </ErrorBoundary>
  );

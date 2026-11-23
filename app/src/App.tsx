import React, { useEffect, useState } from 'react';
import { useAppStore } from './store/useAppStore';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppShell } from './components/AppShell';
import { t } from './i18n/translations';
import { QuickBar } from './components/QuickBar';
import { TopToolRibbon } from './components/TopToolRibbon';
import { ToolPanel } from './components/ToolPanel';
import { SidebarPages } from './components/SidebarPages';
import { PreviewWorkspace } from './components/PreviewWorkspace';
import { StatusBar } from './components/StatusBar';
import { ModalsAndToasts } from './components/Modals';
import { BatchPrintWorkspace } from './components/BatchPrintWorkspace';
import { TicketNumberingWorkspace } from './components/TicketNumberingWorkspace';
import { routeDroppedFiles } from './engine/imageImport';
import { extractFilesFromClipboardData } from './engine/clipboardImport';
import { buildSheetPresetRows, findPresetIdByShortcut } from './engine/sheetPresets';
import { formatShortcut } from '@shared/models';
import { listenForNativeOpenFiles } from './engine/nativeFiles';
import { ipcBridge } from './engine/ipcBridge';

/** Whether this page load has already read the persisted settings back (see the effect in `App`). */
let preferencesRestored = false;

export const App: React.FC = () => {
  const {
    appMode,
    settings,
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
    sidebarWidthPx,
    setSidebarWidthPx,
    refreshVirtualPrinterStatus,
    handleIncomingVirtualPrinterJob,
  } = useAppStore();

  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [resizingSidebar, setResizingSidebar] = useState(false);

  const startSidebarResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidthPx;
    setResizingSidebar(true);

    const onMove = (moveEvent: PointerEvent | MouseEvent) => {
      setSidebarWidthPx(startWidth + (moveEvent.clientX - startX));
    };
    const onUp = () => {
      setResizingSidebar(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  useEffect(() => {
    void initializeWorkspace();
    void refreshVirtualPrinterStatus();
    const stopVirtual = ipcBridge.listenForVirtualPrinterJobs((payload) => {
      void handleIncomingVirtualPrinterJob(payload);
    });
    return () => {
      stopVirtual();
    };
  }, [initializeWorkspace, refreshVirtualPrinterStatus, handleIncomingVirtualPrinterJob]);

  useEffect(() => {
    if (preferencesRestored) return;
    preferencesRestored = true;
    void restorePreferences();
  }, [restorePreferences]);

  useEffect(() => {
    const stop = listenForNativeOpenFiles(
      (files) => {
        const { documents } = routeDroppedFiles(files, false);
        if (documents.length) void importFiles(documents);
      },
      (error) =>
        addToast({
          type: 'warning',
          title: settings.language === 'fa' ? 'فایل باز نشد' : 'Cannot open the file',
          message: error instanceof Error ? error.message : String(error),
        })
    );
    return stop;
  }, [importFiles, addToast, settings.language]);

  useEffect(() => {
    const dir = settings.language === 'fa' ? 'rtl' : 'ltr';
    document.documentElement.setAttribute('dir', dir);
    document.documentElement.setAttribute('lang', settings.language);
  }, [settings.language]);

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

  useEffect(() => {
    const getTargetPageIds = (state: ReturnType<typeof useAppStore.getState>) => {
      const highlighted = state.pages.filter((p) => p.isHighlighted).map((p) => p.id);
      if (highlighted.length > 0) return highlighted;
      if (state.activePageId) return [state.activePageId];
      return state.pages.length > 0 ? [state.pages[0].id] : [];
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const chord = formatShortcut(e);
      if (chord) {
        const state = useAppStore.getState();
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

      if (e.key === 'F1' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const state = useAppStore.getState();
        state.setModalState('shortcuts', !state.showShortcutsModal);
        return;
      }

      if (
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        !e.shiftKey &&
        (e.key.toLowerCase() === 'w' || e.code === 'KeyW')
      ) {
        const current = useAppStore.getState();
        if (!current.shortcutRecordingFor) {
          e.preventDefault();
          e.stopPropagation();
          if (current.textEdit) {
            current.finishTextEdit();
          }
          if (
            current.appMode === 'studio' &&
            (current.documents.length > 0 || current.pages.length > 0 || current.overlays.length > 0)
          ) {
            current.clearWorkspace();
          }
          return;
        }
      }

      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const state = useAppStore.getState();
      if (state.appMode === 'batch' || state.appMode === 'ticket') {
        if (e.ctrlKey || e.metaKey) {
          if (e.key === '/' || e.key === '?' || e.code === 'Slash') {
            e.preventDefault();
            state.setModalState('shortcuts', !state.showShortcutsModal);
          }
        }
        return;
      }
      const ctrl = e.ctrlKey || e.metaKey;
      const lowerKey = e.key.toLowerCase();

      if (e.shiftKey && !ctrl && !e.altKey && (e.key === 'Insert' || e.code === 'Insert')) {
        e.preventDefault();
        state.insertBlankPagesAfter(getTargetPageIds(state));
        return;
      }

      if (ctrl && !e.altKey) {
        if (lowerKey === 'z' && !e.shiftKey) {
          e.preventDefault();
          state.undo();
          return;
        }
        if (lowerKey === 'y' || (e.shiftKey && lowerKey === 'z')) {
          e.preventDefault();
          state.redo();
          return;
        }
        if (lowerKey === 'p' && e.shiftKey) {
          e.preventDefault();
          state.setModalState('print', true);
          return;
        }
        if (lowerKey === 'p' && !e.shiftKey) {
          e.preventDefault();
          void state.silentPrintNow();
          return;
        }
        if (lowerKey === 's' && e.shiftKey) {
          e.preventDefault();
          state.savePspProject();
          return;
        }
        if (lowerKey === 's' && !e.shiftKey) {
          e.preventDefault();
          void state.exportMergedOrImposedPdf(false);
          return;
        }
        if (lowerKey === 'o' && e.shiftKey) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('printstudio:open-psp'));
          return;
        }
        if (lowerKey === 'o' && !e.shiftKey) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('printstudio:add-files'));
          return;
        }
        if (lowerKey === 'd') {
          e.preventDefault();
          state.duplicatePages(getTargetPageIds(state));
          return;
        }
        if (lowerKey === 'a' && !e.shiftKey) {
          e.preventDefault();
          state.selectAllForPrint(true);
          return;
        }
        if (lowerKey === 'i' && !e.shiftKey) {
          e.preventDefault();
          state.toggleGlobalInvert();
          return;
        }
        if (lowerKey === 'r' && !e.shiftKey) {
          e.preventDefault();
          const targetIds = getTargetPageIds(state);
          if (targetIds.length > 0) {
            state.rotatePages(targetIds, 90);
          }
          return;
        }
        if ((e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0') && !e.shiftKey) {
          e.preventDefault();
          state.triggerFitPage();
          return;
        }
        if (lowerKey === 'g' && !e.shiftKey) {
          e.preventDefault();
          state.setShowRulers(!state.showRulers);
          return;
        }
        if (lowerKey === 'm' && !e.shiftKey) {
          e.preventDefault();
          state.setSnapEnabled(!state.snapEnabled);
          return;
        }
        if (e.key === '/' || e.key === '?' || e.code === 'Slash') {
          e.preventDefault();
          state.setModalState('shortcuts', !state.showShortcutsModal);
          return;
        }
      }

      if (e.key === 'Delete' || e.key === 'Backspace' || e.key === 'Escape') {
        if (state.spendEraseKey(e.key)) {
          e.preventDefault();
          return;
        }
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.selectedOverlayId) {
          e.preventDefault();
          state.removeOverlay(state.selectedOverlayId);
          return;
        }
        e.preventDefault();
        state.deletePages(getTargetPageIds(state));
        return;
      }
      if (!ctrl && !e.altKey && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        state.setZoomPercent(state.zoomPercent + 15);
        return;
      }
      if (!ctrl && !e.altKey && e.key === '-') {
        e.preventDefault();
        state.setZoomPercent(state.zoomPercent - 15);
      }
    };

    const onWindowDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types && Array.from(e.dataTransfer.types).includes('Files')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    };
    const onWindowDrop = (e: DragEvent) => {
      const alreadyRouted = e.defaultPrevented;
      const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
      const hasFiles =
        files.length > 0 ||
        (!!e.dataTransfer && Array.from(e.dataTransfer.types ?? []).includes('Files'));
      if (hasFiles) e.preventDefault();
      if (alreadyRouted || files.length === 0) return;
      const { documents } = routeDroppedFiles(files, false);
      if (documents.length === 0) return;
      const mode = useAppStore.getState().appMode;
      if (mode === 'batch') {
        void useAppStore.getState().addBatchFiles(documents);
      } else if (mode === 'ticket') {
        void useAppStore.getState().importTicketSourceFiles(files);
      } else {
        void importFiles(documents);
      }
    };

    const onPaste = (e: ClipboardEvent) => {
      const extracted = extractFilesFromClipboardData(e.clipboardData);
      if (extracted.length === 0) return;

      const target = e.target as HTMLElement | null;
      const isTextControl =
        !!target &&
        ((target.tagName === 'INPUT' &&
          !['button', 'checkbox', 'radio', 'file', 'submit', 'reset'].includes(
            (target as HTMLInputElement).type?.toLowerCase() || ''
          )) ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      const hasPlainText = Boolean(e.clipboardData?.getData('text/plain'));
      if (isTextControl && hasPlainText) {
        return;
      }

      e.preventDefault();
      const mode = useAppStore.getState().appMode;
      if (mode === 'batch') {
        void useAppStore.getState().addBatchFiles(extracted);
      } else if (mode === 'ticket') {
        void useAppStore.getState().importTicketSourceFiles(extracted);
      } else {
        void importFiles(extracted);
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
  }, [importFiles]);

  const isStandaloneMode = appMode === 'batch' || appMode === 'ticket';

  return (
    <ErrorBoundary>
      <AppShell
        theme={settings.theme}
        labels={t(settings.language).shell}
        topbar={<QuickBar />}
        navigation={isStandaloneMode ? null : <TopToolRibbon />}
        workspace={
          appMode === 'batch' ? (
            <BatchPrintWorkspace />
          ) : appMode === 'ticket' ? (
            <TicketNumberingWorkspace />
          ) : (
            <div dir="ltr" className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
              <SidebarPages />
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label={
                  settings.language === 'fa'
                    ? 'تغییر عرض پنل تصاویر بندانگشتی'
                    : 'Resize thumbnail sidebar'
                }
                aria-valuemin={180}
                aria-valuemax={560}
                aria-valuenow={sidebarWidthPx}
                tabIndex={0}
                data-sidebar-resizer
                title={
                  settings.language === 'fa'
                    ? 'برای تغییر عرض پنل بکشید؛ دوبار کلیک برای بازگشت به اندازه پیش‌فرض'
                    : 'Drag to resize sidebar; double-click to reset'
                }
                onPointerDown={startSidebarResize}
                onDoubleClick={() => setSidebarWidthPx(288)}
                onKeyDown={(e) => {
                  const step = e.shiftKey ? 48 : 16;
                  if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    setSidebarWidthPx(sidebarWidthPx + step);
                  } else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    setSidebarWidthPx(sidebarWidthPx - step);
                  } else if (e.key === 'Home') {
                    e.preventDefault();
                    setSidebarWidthPx(180);
                  } else if (e.key === 'End') {
                    e.preventDefault();
                    setSidebarWidthPx(560);
                  }
                }}
                className={`group relative z-20 flex w-1.5 shrink-0 cursor-col-resize items-center justify-center transition-colors focus:outline-none focus-visible:bg-sky-500 ${
                  resizingSidebar
                    ? 'bg-sky-500'
                    : 'bg-slate-200 hover:bg-sky-400 dark:bg-slate-800 dark:hover:bg-sky-500'
                }`}
                style={{ touchAction: 'none' }}
              >
                <span
                  aria-hidden="true"
                  className="h-10 w-0.5 rounded-full bg-slate-400/70 transition-colors group-hover:bg-white dark:bg-slate-600"
                />
              </div>
              <PreviewWorkspace onCursorMoveMm={setCursorPos} />
              <ToolPanel />
            </div>
          )
        }
        statusBar={<StatusBar cursorPos={cursorPos} />}
        overlays={<ModalsAndToasts />}
      />
    </ErrorBoundary>
  );
};

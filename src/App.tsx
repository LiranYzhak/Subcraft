import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { SingleDownloader } from './components/SingleDownloader';
import { VideoStudioView } from './components/VideoStudioView';
import { BatchDownloader } from './components/BatchDownloader';
import { HistoryView } from './components/HistoryView';
import { PlatformsGuide } from './components/PlatformsGuide';
import { translations } from './constants/translations';
import {
  getUserPreferences,
  saveUserPreferences,
  getStoredHistory,
} from './utils/storage';
import { DownloadHistoryItem } from './types/video';

export default function App() {
  const [preferences, setPreferences] = useState(() => getUserPreferences());
  const [currentTab, setCurrentTab] = useState<'single' | 'studio' | 'batch' | 'history' | 'guide'>('single');
  const [history, setHistory] = useState<DownloadHistoryItem[]>([]);
  const [activeStudioVideo, setActiveStudioVideo] = useState<DownloadHistoryItem | null>(null);
  const [autoTranscribeStudio, setAutoTranscribeStudio] = useState(false);

  // Load history on mount
  useEffect(() => {
    const stored = getStoredHistory();
    setHistory(stored);
    if (stored.length > 0) {
      setActiveStudioVideo(stored[0]);
    }
  }, []);

  const refreshHistory = () => {
    const stored = getStoredHistory();
    setHistory(stored);
    if (activeStudioVideo) {
      const updated = stored.find((item) => item.id === activeStudioVideo.id);
      if (updated) setActiveStudioVideo(updated);
    } else if (stored.length > 0) {
      setActiveStudioVideo(stored[0]);
    }
  };

  const handleOpenInStudio = (item: DownloadHistoryItem, autoTranscribe = true) => {
    setActiveStudioVideo(item);
    setAutoTranscribeStudio(autoTranscribe);
    setCurrentTab('studio');
  };

  // Sync dark class and RTL attribute
  useEffect(() => {
    const root = document.documentElement;
    if (preferences.theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    root.setAttribute('dir', preferences.lang === 'he' ? 'rtl' : 'ltr');
    root.setAttribute('lang', preferences.lang);

    saveUserPreferences(preferences);
  }, [preferences]);

  const toggleTheme = () => {
    setPreferences((prev) => ({
      ...prev,
      theme: prev.theme === 'dark' ? 'light' : 'dark',
    }));
  };

  const toggleLang = () => {
    setPreferences((prev) => ({
      ...prev,
      lang: prev.lang === 'he' ? 'en' : 'he',
    }));
  };

  const t = translations[preferences.lang];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans transition-colors selection:bg-sky-500 selection:text-white">
      {/* Top Bar Header */}
      <Header
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        lang={preferences.lang}
        onToggleLang={toggleLang}
        isDark={preferences.theme === 'dark'}
        onToggleTheme={toggleTheme}
        historyCount={history.length}
      />

      {/* Main Viewport Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8">
        {currentTab === 'single' && (
          <SingleDownloader
            lang={preferences.lang}
            onDownloadFinished={refreshHistory}
            onOpenInStudio={handleOpenInStudio}
          />
        )}

        {currentTab === 'studio' && (
          <VideoStudioView
            lang={preferences.lang}
            activeVideo={activeStudioVideo}
            history={history}
            autoTranscribeRequested={autoTranscribeStudio}
            onClearAutoTranscribe={() => setAutoTranscribeStudio(false)}
            onSelectVideo={(item) => setActiveStudioVideo(item)}
            onHistoryUpdated={refreshHistory}
            onGoToDownloader={() => setCurrentTab('single')}
          />
        )}

        {currentTab === 'batch' && (
          <BatchDownloader
            lang={preferences.lang}
            onDownloadFinished={refreshHistory}
          />
        )}

        {currentTab === 'history' && (
          <HistoryView
            history={history}
            lang={preferences.lang}
            onRefresh={refreshHistory}
            onOpenInStudio={handleOpenInStudio}
          />
        )}

        {currentTab === 'guide' && (
          <PlatformsGuide lang={preferences.lang} />
        )}
      </main>

      {/* Quiet, Clean Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/80 mt-auto py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-700 dark:text-slate-300">{t.appTitle}</span>
            <span aria-hidden="true">·</span>
            <span>{preferences.lang === 'he' ? 'סטודיו להורדה, עריכת וידאו וכתוביות בעברית' : 'Social Video Downloader, Editor & Hebrew Subtitle Studio'}</span>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => setCurrentTab('guide')}
              className="hover:text-slate-900 dark:hover:text-slate-200 transition-colors"
            >
              {t.navGuide}
            </button>
            <span aria-hidden="true">·</span>
            <button
              onClick={() => setCurrentTab('history')}
              className="hover:text-slate-900 dark:hover:text-slate-200 transition-colors"
            >
              {t.navHistory}
            </button>
            <span aria-hidden="true">·</span>
            <span>{preferences.lang === 'he' ? 'לשימוש אישי וחוקי בלבד' : 'For personal fair-use only'}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

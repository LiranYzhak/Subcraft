import React from 'react';
import { Clapperboard, Moon, Sun, Globe } from 'lucide-react';
import { translations, Language } from '../constants/translations';

interface HeaderProps {
  currentTab: 'single' | 'studio' | 'batch' | 'history' | 'guide';
  onSelectTab: (tab: 'single' | 'studio' | 'batch' | 'history' | 'guide') => void;
  lang: Language;
  onToggleLang: () => void;
  isDark: boolean;
  onToggleTheme: () => void;
  historyCount: number;
}

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  onSelectTab,
  lang,
  onToggleLang,
  isDark,
  onToggleTheme,
  historyCount,
}) => {
  const t = translations[lang];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-neutral-200 dark:border-neutral-800 bg-white/95 dark:bg-slate-950/95 backdrop-blur-md transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Brand title wordmark */}
        <div
          onClick={() => onSelectTab('single')}
          className="cursor-pointer flex items-center gap-2.5 whitespace-nowrap shrink-0 group"
        >
          <div className="w-9 h-9 rounded-lg bg-sky-500 text-white flex items-center justify-center shadow-sm group-hover:bg-sky-600 transition-colors">
            <Clapperboard className="w-5 h-5" />
          </div>
          <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
            {t.appTitle}
          </span>
        </div>

        {/* Zone 2: Navigation Links (single line, whitespace-nowrap) */}
        <nav className="hidden md:flex items-center gap-1 sm:gap-2">
          <button
            onClick={() => onSelectTab('single')}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              currentTab === 'single'
                ? 'text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/40'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-900'
            }`}
          >
            {t.navConverter}
          </button>

          <button
            onClick={() => onSelectTab('studio')}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              currentTab === 'studio'
                ? 'text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/40'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-900'
            }`}
          >
            {t.navStudio}
          </button>

          <button
            onClick={() => onSelectTab('batch')}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              currentTab === 'batch'
                ? 'text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/40'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-900'
            }`}
          >
            {t.navBatch}
          </button>

          <button
            onClick={() => onSelectTab('history')}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0 relative cursor-pointer ${
              currentTab === 'history'
                ? 'text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/40'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-900'
            }`}
          >
            {t.navHistory}
            {historyCount > 0 && (
              <span className="ms-1.5 text-xs font-mono font-semibold px-1.5 py-0.2 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                {historyCount}
              </span>
            )}
          </button>

          <button
            onClick={() => onSelectTab('guide')}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              currentTab === 'guide'
                ? 'text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/40'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-900'
            }`}
          >
            {t.navGuide}
          </button>
        </nav>

        {/* Zone 3: 1 primary action & utility controls */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Language Toggle */}
          <button
            onClick={onToggleLang}
            title={lang === 'he' ? 'Switch to English' : 'החלף לעברית'}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md border border-slate-200 dark:border-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Globe className="w-3.5 h-3.5 text-slate-500" />
            <span>{lang === 'he' ? 'EN' : 'עברית'}</span>
          </button>

          {/* Theme Switcher */}
          <button
            onClick={onToggleTheme}
            aria-label="Toggle theme"
            className="p-2 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md border border-slate-200 dark:border-slate-800 transition-colors shrink-0 cursor-pointer"
          >
            {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
          </button>
        </div>
      </div>

      {/* Mobile nav strip */}
      <div className="flex md:hidden border-t border-slate-200 dark:border-slate-800 px-4 py-2 gap-2 overflow-x-auto">
        <button
          onClick={() => onSelectTab('single')}
          className={`px-3 py-1 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
            currentTab === 'single'
              ? 'text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/40'
              : 'text-slate-600 dark:text-slate-400'
          }`}
        >
          {t.navConverter}
        </button>
        <button
          onClick={() => onSelectTab('studio')}
          className={`px-3 py-1 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
            currentTab === 'studio'
              ? 'text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/40'
              : 'text-slate-600 dark:text-slate-400'
          }`}
        >
          {t.navStudio}
        </button>
        <button
          onClick={() => onSelectTab('batch')}
          className={`px-3 py-1 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
            currentTab === 'batch'
              ? 'text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/40'
              : 'text-slate-600 dark:text-slate-400'
          }`}
        >
          {t.navBatch}
        </button>
        <button
          onClick={() => onSelectTab('history')}
          className={`px-3 py-1 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
            currentTab === 'history'
              ? 'text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/40'
              : 'text-slate-600 dark:text-slate-400'
          }`}
        >
          {t.navHistory} ({historyCount})
        </button>
        <button
          onClick={() => onSelectTab('guide')}
          className={`px-3 py-1 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
            currentTab === 'guide'
              ? 'text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/40'
              : 'text-slate-600 dark:text-slate-400'
          }`}
        >
          {t.navGuide}
        </button>
      </div>
    </header>
  );
};

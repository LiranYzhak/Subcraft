import React, { useState } from 'react';
import {
  Download,
  Trash2,
  Copy,
  Check,
  Play,
  X,
  HardDrive,
  Film,
  Subtitles,
} from 'lucide-react';
import { DownloadHistoryItem } from '../types/video';
import { translations, Language } from '../constants/translations';
import { clearAllHistory, removeHistoryItem } from '../utils/storage';
import { getPlatformBadge, downloadVideoFile } from '../utils/downloader';

interface HistoryViewProps {
  history: DownloadHistoryItem[];
  lang: Language;
  onRefresh: () => void;
  onOpenInStudio: (item: DownloadHistoryItem) => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  history,
  lang,
  onRefresh,
  onOpenInStudio,
}) => {
  const t = translations[lang];

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activePreview, setActivePreview] = useState<DownloadHistoryItem | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const handleCopy = (id: string, url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleRemove = (id: string) => {
    removeHistoryItem(id);
    onRefresh();
  };

  const handleClear = () => {
    clearAllHistory();
    setConfirmClear(false);
    onRefresh();
  };

  const handleReDownload = async (item: DownloadHistoryItem) => {
    setDownloadingId(item.id);
    try {
      await downloadVideoFile({
        url: item.originalUrl,
        directUrl: item.directUrl,
        formatId: item.formatId,
        title: item.title,
        platform: item.platform,
        qualityId: item.qualityId,
        format: item.format,
        fileSizeMb: item.fileSizeMb,
        onProgress: () => {},
      });
    } catch (e) {
      console.error('Redownload error:', e);
    } finally {
      setDownloadingId(null);
    }
  };

  const totalMb = history.reduce((sum, it) => sum + (it.fileSizeMb || 0), 0);
  const totalGb = (totalMb / 1024).toFixed(2);

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Title & Stats */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">
            {t.historyTitle}
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {t.historyDesc}
          </p>
        </div>

        {history.length > 0 && (
          <div className="flex items-center gap-2 self-start sm:self-auto">
            {confirmClear ? (
              <>
                <button
                  onClick={handleClear}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors cursor-pointer"
                >
                  {lang === 'he' ? 'אשר מחיקה' : 'Confirm Clear'}
                </button>
                <button
                  onClick={() => setConfirmClear(false)}
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                >
                  {lang === 'he' ? 'ביטול' : 'Cancel'}
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmClear(true)}
                className="px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg border border-red-200 dark:border-red-900/50 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{t.clearHistory}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Metric strip with tabular numerals */}
      {history.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="text-xs text-slate-500 dark:text-slate-400">{t.totalDownloadedFiles}</div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1 font-mono-numbers">
              {history.length}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="text-xs text-slate-500 dark:text-slate-400">{t.totalDownloadedSize}</div>
            <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1 font-mono-numbers">
              {totalMb > 1024 ? `${totalGb} GB` : `${totalMb.toFixed(1)} MB`}
            </div>
          </div>

          <div className="col-span-2 sm:col-span-1 p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {lang === 'he' ? 'אחסון מקומי' : 'Local Storage'}
              </div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                {lang === 'he' ? 'זמין תמיד' : 'Always Ready'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* History List or Empty state */}
      {history.length === 0 ? (
        <div className="p-12 text-center rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
          <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mx-auto">
            <Film className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200">
            {lang === 'he' ? 'הרשימה ריקה' : 'History is empty'}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
            {t.emptyHistory}
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800 shadow-sm">
          {history.map((item) => {
            const badge = getPlatformBadge(item.platform);
            const dateStr = new Date(item.timestamp).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-US', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            });

            return (
              <div
                key={item.id}
                className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {/* Thumbnail / Icon */}
                  <div
                    className="relative w-16 h-12 rounded-lg overflow-hidden bg-slate-900 shrink-0 group cursor-pointer flex items-center justify-center"
                    onClick={() => setActivePreview(item)}
                  >
                    {item.thumbnail ? (
                      <img
                        src={item.thumbnail}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    ) : (
                      <Film className="w-5 h-5 text-slate-500" />
                    )}
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <Play className="w-5 h-5 text-white fill-white" />
                    </div>
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.2 rounded shrink-0"
                        style={{ backgroundColor: `${badge.color}20`, color: badge.color }}
                      >
                        {item.platformName}
                      </span>
                      <h4 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                        {item.title}
                      </h4>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono-numbers">
                      <span className="font-semibold text-sky-600 dark:text-sky-400">{item.qualityLabel}</span>
                      <span aria-hidden="true">·</span>
                      <span>{item.fileSizeMb} MB</span>
                      <span aria-hidden="true">·</span>
                      <span>{dateStr}</span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                  <button
                    onClick={() => handleCopy(item.id, item.originalUrl)}
                    className="p-2 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    title={t.copyLink}
                  >
                    {copiedId === item.id ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                  </button>

                  <button
                    onClick={() => setActivePreview(item)}
                    className="p-2 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    title={t.previewVideo}
                  >
                    <Play className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => onOpenInStudio(item)}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer border border-slate-700"
                    title={t.openInStudio}
                  >
                    <Subtitles className="w-3.5 h-3.5 text-sky-400" />
                    <span>{lang === 'he' ? 'ערוך וכתוביות' : 'Edit & Subtitles'}</span>
                  </button>

                  <button
                    onClick={() => handleReDownload(item)}
                    disabled={downloadingId === item.id}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-sky-500 hover:bg-sky-600 disabled:opacity-50 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{downloadingId === item.id ? '...' : t.reDownload}</span>
                  </button>

                  <button
                    onClick={() => handleRemove(item.id)}
                    className="p-2 text-slate-400 hover:text-red-500 rounded-lg transition-colors cursor-pointer"
                    title={lang === 'he' ? 'מחק מהרשימה' : 'Remove'}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Video Modal Preview */}
      {activePreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="relative w-full max-w-2xl bg-slate-900 rounded-2xl overflow-hidden shadow-2xl border border-slate-800">
            <div className="flex items-center justify-between p-4 border-b border-slate-800 text-white">
              <h3 className="text-sm font-semibold truncate pe-4">{activePreview.title}</h3>
              <button
                onClick={() => setActivePreview(null)}
                className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-black flex items-center justify-center max-h-[460px]">
              <video
                src={activePreview.streamUrl}
                poster={activePreview.thumbnail}
                preload="metadata"
                playsInline
                controls
                className="w-full max-h-[460px] object-contain"
              />
            </div>

            <div className="p-4 flex items-center justify-between bg-slate-950 text-xs text-slate-400 font-mono-numbers">
              <span>{activePreview.qualityLabel} · {activePreview.fileSizeMb} MB</span>
              <button
                onClick={() => {
                  handleReDownload(activePreview);
                  setActivePreview(null);
                }}
                className="px-3 py-1.5 bg-sky-500 hover:bg-sky-600 text-white font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{t.reDownload}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

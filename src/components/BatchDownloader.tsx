import React, { useState } from 'react';
import {
  Sparkles,
  Download,
  Trash2,
  CheckCircle2,
  AlertCircle,
  FileArchive,
  Film,
} from 'lucide-react';
import { BatchItem, VideoMetadata } from '../types/video';
import { translations, Language } from '../constants/translations';
import { packageBatchZip, getPlatformBadge, downloadVideoFile } from '../utils/downloader';
import { saveHistoryItem } from '../utils/storage';

interface BatchDownloaderProps {
  lang: Language;
  onDownloadFinished: () => void;
}

const SAMPLE_BATCH_URLS = [
  'https://www.tiktok.com/@tiktok/video/7106594312292453675',
  'https://www.instagram.com/reel/Chunk8-jurw/',
  'https://x.com/historyinmemes/status/1790637656616943991',
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
];

export const BatchDownloader: React.FC<BatchDownloaderProps> = ({ lang, onDownloadFinished }) => {
  const t = translations[lang];

  const [rawText, setRawText] = useState('');
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [defaultQualityPref, setDefaultQualityPref] = useState<'best' | '720p' | '480p' | 'mp3'>('best');
  const [isAnalyzingAll, setIsAnalyzingAll] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState<{ percent: number; currentItem: string } | null>(null);

  const handleLoadSamples = () => {
    setRawText(SAMPLE_BATCH_URLS.join('\n'));
  };

  const pickQualityByPref = (meta: VideoMetadata, pref: string): string => {
    if (pref === 'mp3') {
      const mp3Opt = meta.qualities.find((q) => q.format === 'mp3');
      if (mp3Opt) return mp3Opt.id;
    }
    if (pref === '720p') {
      const q720 = meta.qualities.find((q) => q.label.includes('720'));
      if (q720) return q720.id;
    }
    if (pref === '480p') {
      const q480 = meta.qualities.find((q) => q.label.includes('480') || q.label.includes('360'));
      if (q480) return q480.id;
    }
    const popular = meta.qualities.find((q) => q.isPopular) || meta.qualities[0];
    return popular ? popular.id : '';
  };

  const handleAnalyzeAll = async () => {
    const lines = rawText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('http'));

    if (lines.length === 0) return;

    const initialItems: BatchItem[] = lines.map((url, idx) => ({
      id: `batch_${Date.now()}_${idx}`,
      url,
      status: 'analyzing',
      selectedQualityId: '',
      progress: 0,
    }));

    setBatchItems(initialItems);
    setIsAnalyzingAll(true);

    for (let i = 0; i < initialItems.length; i++) {
      const current = initialItems[i];
      try {
        const res = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: current.url }),
        });
        const json = await res.json();
        if (res.ok && json.success && json.data) {
          const meta: VideoMetadata = json.data;
          const chosenQ = pickQualityByPref(meta, defaultQualityPref);
          setBatchItems((prev) =>
            prev.map((item) =>
              item.id === current.id
                ? {
                    ...item,
                    status: 'ready',
                    metadata: meta,
                    selectedQualityId: chosenQ,
                  }
                : item
            )
          );
        } else {
          throw new Error(json.error || 'Failed to analyze URL');
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Error';
        setBatchItems((prev) =>
          prev.map((item) =>
            item.id === current.id
              ? {
                  ...item,
                  status: 'error',
                  errorMessage: msg,
                }
              : item
          )
        );
      }
    }

    setIsAnalyzingAll(false);
  };

  const handleDownloadSingleBatchItem = async (item: BatchItem) => {
    if (!item.metadata) return;

    setBatchItems((prev) =>
      prev.map((it) => (it.id === item.id ? { ...it, status: 'downloading', progress: 10 } : it))
    );

    const q =
      item.metadata.qualities.find((opt) => opt.id === item.selectedQualityId) ||
      item.metadata.qualities[0];

    try {
      const { sizeMb: actualSizeMb, jobId } = await downloadVideoFile({
        url: item.metadata.url,
        directUrl: q.directUrl,
        formatId: q.formatId,
        title: item.metadata.title,
        platform: item.metadata.platform,
        qualityId: q.id,
        format: q.format,
        fileSizeMb: q.fileSizeMb,
        onProgress: (p) => {
          setBatchItems((prev) =>
            prev.map((it) => (it.id === item.id ? { ...it, progress: p.percent } : it))
          );
        },
      });

      saveHistoryItem({
        jobId,
        title: item.metadata.title,
        platform: item.metadata.platform,
        platformName: item.metadata.platformName,
        qualityId: q.id,
        qualityLabel: q.label,
        formatId: q.formatId,
        directUrl: q.directUrl,
        format: q.format,
        fileSizeMb: actualSizeMb || q.fileSizeMb,
        durationSeconds: item.metadata.durationSeconds,
        thumbnail: item.metadata.thumbnail,
        originalUrl: item.metadata.url,
        streamUrl: item.metadata.streamUrl,
      });

      setBatchItems((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, status: 'completed', progress: 100 } : it))
      );
      onDownloadFinished();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Download error';
      setBatchItems((prev) =>
        prev.map((it) =>
          it.id === item.id ? { ...it, status: 'error', errorMessage: msg } : it
        )
      );
    }
  };

  const handleDownloadAllZip = async () => {
    const readyItems = batchItems.filter((it) => it.status === 'ready' && it.metadata);
    if (readyItems.length === 0) return;

    setIsZipping(true);
    setZipProgress({ percent: 0, currentItem: 'מתחיל הורדת קבצים...' });

    try {
      const itemsToPack = readyItems.map((it) => {
        const meta = it.metadata!;
        const q = meta.qualities.find((opt) => opt.id === it.selectedQualityId) || meta.qualities[0];
        return {
          url: meta.url,
          directUrl: q.directUrl,
          formatId: q.formatId,
          title: meta.title,
          platform: meta.platform,
          qualityId: q.id,
          format: q.format,
          fileSizeMb: q.fileSizeMb,
        };
      });

      await packageBatchZip(itemsToPack, (percent, currentItem) => {
        setZipProgress({ percent: Math.round(percent), currentItem });
      });

      setBatchItems((prev) =>
        prev.map((it) => (it.metadata ? { ...it, status: 'completed', progress: 100 } : it))
      );

      readyItems.forEach((it) => {
        const meta = it.metadata!;
        const q = meta.qualities.find((opt) => opt.id === it.selectedQualityId) || meta.qualities[0];
        saveHistoryItem({
          title: meta.title,
          platform: meta.platform,
          platformName: meta.platformName,
          qualityId: q.id,
          qualityLabel: q.label,
          formatId: q.formatId,
          directUrl: q.directUrl,
          format: q.format,
          fileSizeMb: q.fileSizeMb,
          thumbnail: meta.thumbnail,
          originalUrl: meta.url,
          streamUrl: meta.streamUrl,
        });
      });

      onDownloadFinished();
    } catch (e) {
      console.error('ZIP batch error:', e);
    } finally {
      setIsZipping(false);
      setZipProgress(null);
    }
  };

  const readyCount = batchItems.filter((i) => i.status === 'ready' || i.status === 'completed').length;

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      <div className="text-center space-y-2">
        <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">
          {t.batchTitle}
        </h2>
        <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 max-w-xl mx-auto">
          {t.batchDesc}
        </p>
      </div>

      {/* Input area */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-4 shadow-sm">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <label className="font-semibold text-slate-800 dark:text-slate-200">
              {lang === 'he' ? 'רשימת קישורים אמיתיים (קישור בכל שורה)' : 'List of Real URLs (one per line)'}
            </label>
            <button
              onClick={handleLoadSamples}
              className="text-sky-600 dark:text-sky-400 hover:underline cursor-pointer"
            >
              {lang === 'he' ? 'טען 4 קישורים אמיתיים לבדיקה' : 'Load 4 verified real links'}
            </button>
          </div>

          <textarea
            rows={4}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder={t.batchPlaceholder}
            className="w-full p-3 text-xs sm:text-sm font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
          {/* Default Quality Selector */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-600 dark:text-slate-400 font-medium">
              {t.defaultQualityForBatch}
            </span>
            <select
              value={defaultQualityPref}
              onChange={(e) => setDefaultQualityPref(e.target.value as any)}
              className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-medium text-xs focus:ring-sky-500"
            >
              <option value="best">{lang === 'he' ? 'איכות מקסימלית (Full HD / 4K)' : 'Highest Quality (Full HD / 4K)'}</option>
              <option value="720p">720p HD</option>
              <option value="480p">480p / 360p SD</option>
              <option value="mp3">MP3 Audio (320k)</option>
            </select>
          </div>

          {/* Analyze All Button */}
          <button
            onClick={handleAnalyzeAll}
            disabled={isAnalyzingAll || !rawText.trim()}
            className="px-5 py-2.5 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white font-semibold text-xs sm:text-sm rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
          >
            {isAnalyzingAll ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>{t.analyzing}</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>{t.analyzeBatch}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Batch Processing Table */}
      {batchItems.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm space-y-0">
          <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
              <span className="font-semibold text-slate-900 dark:text-white">
                {batchItems.length} {t.totalVideos}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {readyCount} {t.readyToDownload}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setBatchItems([])}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-md transition-colors cursor-pointer"
                title={lang === 'he' ? 'נקה רשימה' : 'Clear queue'}
              >
                <Trash2 className="w-4 h-4" />
              </button>

              <button
                onClick={handleDownloadAllZip}
                disabled={isZipping || readyCount === 0}
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer"
              >
                <FileArchive className="w-3.5 h-3.5" />
                <span>{t.downloadAllZip}</span>
              </button>
            </div>
          </div>

          {/* Zip progress bar */}
          {isZipping && zipProgress && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border-b border-emerald-200 dark:border-emerald-800/60 text-xs font-mono-numbers space-y-1">
              <div className="flex justify-between text-emerald-900 dark:text-emerald-200 font-semibold">
                <span className="truncate pe-4">{zipProgress.currentItem}</span>
                <span>{zipProgress.percent}%</span>
              </div>
              <div className="w-full h-1.5 bg-emerald-200 dark:bg-emerald-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-600 rounded-full transition-all"
                  style={{ width: `${zipProgress.percent}%` }}
                />
              </div>
            </div>
          )}

          {/* Rows List */}
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {batchItems.map((item, idx) => {
              const meta = item.metadata;
              const badge = meta ? getPlatformBadge(meta.platform) : null;

              return (
                <div key={item.id} className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="text-xs font-mono text-slate-400 w-5 shrink-0">
                      #{idx + 1}
                    </span>

                    {meta && meta.thumbnail ? (
                      <div className="relative w-14 h-10 rounded-md overflow-hidden bg-slate-900 shrink-0">
                        <img
                          src={meta.thumbnail}
                          alt=""
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="w-14 h-10 rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                        <Film className="w-4 h-4 text-slate-400" />
                      </div>
                    )}

                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-2">
                        {meta && badge && (
                          <span
                            className="text-[10px] font-semibold px-1.5 py-0.2 rounded shrink-0"
                            style={{ backgroundColor: `${badge.color}20`, color: badge.color }}
                          >
                            {meta.platformName}
                          </span>
                        )}
                        <h4 className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white truncate">
                          {meta ? meta.title : item.url}
                        </h4>
                      </div>

                      {meta && (
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-2 font-mono-numbers">
                          <span>{meta.authorHandle}</span>
                          <span aria-hidden="true">·</span>
                          <span>{meta.durationFormatted}</span>
                        </div>
                      )}

                      {item.status === 'analyzing' && (
                        <span className="text-[11px] text-sky-600 dark:text-sky-400 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-ping" />
                          <span>{t.analyzing}</span>
                        </span>
                      )}

                      {item.status === 'error' && (
                        <span className="text-[11px] text-red-500 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3 shrink-0" />
                          <span className="truncate">{item.errorMessage || 'Error'}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions & Quality picker */}
                  <div className="flex items-center gap-2.5 self-end sm:self-center shrink-0">
                    {meta && (
                      <select
                        value={item.selectedQualityId}
                        onChange={(e) =>
                          setBatchItems((prev) =>
                            prev.map((it) =>
                              it.id === item.id ? { ...it, selectedQualityId: e.target.value } : it
                            )
                          )
                        }
                        className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono-numbers text-slate-800 dark:text-slate-200"
                      >
                        {meta.qualities.map((q) => (
                          <option key={q.id} value={q.id}>
                            {q.label} (~{q.fileSizeMb}MB)
                          </option>
                        ))}
                      </select>
                    )}

                    {item.status === 'completed' ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-semibold px-2 py-1">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>{lang === 'he' ? 'הושלם' : 'Done'}</span>
                      </span>
                    ) : item.status === 'downloading' ? (
                      <div className="flex items-center gap-2 text-xs font-mono text-sky-600">
                        <div className="w-3.5 h-3.5 border-2 border-sky-500/30 border-t-sky-500 rounded-full animate-spin" />
                        <span>{item.progress}%</span>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleDownloadSingleBatchItem(item)}
                        disabled={item.status !== 'ready'}
                        className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-sky-50 dark:hover:bg-sky-950/40 text-slate-700 dark:text-slate-300 hover:text-sky-600 transition-colors disabled:opacity-30 cursor-pointer"
                        title={lang === 'he' ? 'הורד קובץ זה' : 'Download this item'}
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

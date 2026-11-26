import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  Clipboard,
  X,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize2,
  Check,
  Download,
  Sliders,
  Sparkles,
  ExternalLink,
  Film,
  Music,
  CheckCircle2,
  Clock,
  Eye,
  Heart,
  KeyRound,
  Subtitles,
} from 'lucide-react';
import {
  VideoMetadata,
  VideoQualityOption,
  ConversionOptions,
  PlatformType,
  DownloadHistoryItem,
} from '../types/video';
import { translations, Language } from '../constants/translations';
import { downloadVideoFile, DownloadProgress, getPlatformBadge } from '../utils/downloader';
import { saveHistoryItem } from '../utils/storage';

interface SingleDownloaderProps {
  lang: Language;
  onDownloadFinished: () => void;
  onOpenInStudio: (item: DownloadHistoryItem) => void;
}

interface SampleItem {
  label: string;
  url: string;
  platform: PlatformType;
  category: string;
}

const REAL_VERIFIED_SAMPLES: SampleItem[] = [
  {
    label: 'TikTok Official (@tiktok)',
    url: 'https://www.tiktok.com/@tiktok/video/7106594312292453675',
    platform: 'tiktok',
    category: 'TikTok HD',
  },
  {
    label: 'Instagram Reel',
    url: 'https://www.instagram.com/reel/Chunk8-jurw/',
    platform: 'instagram',
    category: 'Instagram Reel',
  },
  {
    label: 'X / Twitter Video',
    url: 'https://x.com/historyinmemes/status/1790637656616943991',
    platform: 'twitter',
    category: 'X (Twitter)',
  },
  {
    label: 'YouTube Trailer (4K/HD)',
    url: 'https://youtu.be/6HEVkzXSih0?si=O71ldR9pt_DTpu2W',
    platform: 'youtube',
    category: 'YouTube 4K',
  },
];

export const SingleDownloader: React.FC<SingleDownloaderProps> = ({
  lang,
  onDownloadFinished,
  onOpenInStudio,
}) => {
  const t = translations[lang];

  const [inputUrl, setInputUrl] = useState('');
  const [cookiesText, setCookiesText] = useState('');
  const [showCookiesInput, setShowCookiesInput] = useState(false);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [videoData, setVideoData] = useState<VideoMetadata | null>(null);
  const [selectedQuality, setSelectedQuality] = useState<VideoQualityOption | null>(null);

  // Conversion Options
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [options, setOptions] = useState<ConversionOptions>({
    trimEnabled: false,
    trimStart: 0,
    trimEnd: 0,
    muteAudio: false,
    customFilename: '',
  });

  // Download state
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [downloadSuccess, setDownloadSuccess] = useState(false);
  const [lastSavedItem, setLastSavedItem] = useState<DownloadHistoryItem | null>(null);

  // Video player controls
  const videoRef = useRef<HTMLVideoElement>(null);
  const playPromiseRef = useRef<Promise<void> | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  const detectedType = detectInputPlatform(inputUrl);

  function detectInputPlatform(url: string): PlatformType | null {
    if (!url) return null;
    const lower = url.toLowerCase();
    if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube';
    if (lower.includes('tiktok.com')) return 'tiktok';
    if (lower.includes('instagram.com')) return 'instagram';
    if (lower.includes('twitter.com') || lower.includes('x.com')) return 'twitter';
    if (lower.includes('facebook.com') || lower.includes('fb.watch') || lower.includes('fb.com')) return 'facebook';
    if (lower.includes('threads.net') || lower.includes('threads.com')) return 'threads';
    if (lower.includes('reddit.com') || lower.includes('redd.it')) return 'reddit';
    if (lower.includes('vimeo.com')) return 'vimeo';
    if (lower.startsWith('http')) return 'other';
    return null;
  }

  // Handle URL Paste
  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setInputUrl(text.trim());
        setErrorMessage(null);
        handleAnalyze(text.trim());
      }
    } catch (e) {
      console.warn('Clipboard read error:', e);
    }
  };

  // Handle real URL analysis
  const handleAnalyze = async (urlToAnalyze?: string) => {
    const url = (urlToAnalyze || inputUrl).trim();
    if (!url) {
      setErrorMessage(lang === 'he' ? 'אנא הזן קישור לסרטון' : 'Please enter a video URL');
      return;
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      setErrorMessage(
        lang === 'he'
          ? 'כתובת הקישור חייבת להתחיל ב-https:// או http://'
          : 'URL must start with https:// or http://'
      );
      return;
    }

    setIsAnalyzing(true);
    setErrorMessage(null);
    setDownloadSuccess(false);
    setIsPlaying(false);
    playPromiseRef.current = null;
    setVideoData(null);

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, cookies: cookiesText }),
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to extract video');
      }

      const meta: VideoMetadata = result.data;
      setVideoData(meta);

      const popular = meta.qualities.find((q) => q.isPopular) || meta.qualities[0];
      setSelectedQuality(popular);

      setOptions({
        trimEnabled: false,
        trimStart: 0,
        trimEnd: meta.durationSeconds,
        muteAudio: false,
        customFilename: `${meta.platform}_${meta.title.replace(/[^a-zA-Z0-9_\u0590-\u05FF]/g, '_').replace(/_+/g, '_').substring(0, 35)}`,
      });
    } catch (err: unknown) {
      console.error('Extraction error:', err);
      const msg = err instanceof Error ? err.message : 'Analysis failed';
      setErrorMessage(msg);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Handle Real Download Execution
  const handleDownload = async (openStudioAfter = false) => {
    if (!videoData || !selectedQuality) return;

    setIsDownloading(true);
    setDownloadSuccess(false);
    setErrorMessage(null);
    setDownloadProgress({
      percent: 5,
      speedMbPerSec: 0,
      loadedMb: 0,
      totalMb: selectedQuality.fileSizeMb,
      etaSeconds: 5,
    });

    const titleToUse = options.customFilename.trim() || videoData.title;

    try {
      const { sizeMb: actualSizeMb, jobId } = await downloadVideoFile({
        url: videoData.url,
        directUrl: selectedQuality.directUrl,
        formatId: selectedQuality.formatId,
        title: titleToUse,
        platform: videoData.platform,
        qualityId: selectedQuality.id,
        format: selectedQuality.format,
        fileSizeMb: selectedQuality.fileSizeMb,
        trimStart: options.trimEnabled ? options.trimStart : 0,
        trimEnd: options.trimEnabled ? options.trimEnd : 0,
        muteAudio: options.muteAudio,
        onProgress: (p) => setDownloadProgress(p),
      });

      // Save to local storage history with real stream properties & jobId for Studio editing
      const savedItem = saveHistoryItem({
        jobId,
        title: titleToUse,
        platform: videoData.platform,
        platformName: videoData.platformName,
        qualityId: selectedQuality.id,
        qualityLabel: selectedQuality.label,
        formatId: selectedQuality.formatId,
        directUrl: selectedQuality.directUrl,
        format: selectedQuality.format,
        fileSizeMb: actualSizeMb || selectedQuality.fileSizeMb,
        durationSeconds: videoData.durationSeconds,
        thumbnail: videoData.thumbnail,
        originalUrl: videoData.url,
        streamUrl: videoData.streamUrl,
      });

      setLastSavedItem(savedItem);
      setDownloadSuccess(true);
      onDownloadFinished();

      if (openStudioAfter) {
        onOpenInStudio(savedItem);
      }
    } catch (err: unknown) {
      console.error('Download failed:', err);
      const msg = err instanceof Error ? err.message : 'Download error';
      setErrorMessage(msg);
    } finally {
      setIsDownloading(false);
    }
  };

  // Open analyzed video directly in the Studio & auto-transcribe to Hebrew
  const handleOpenAnalyzedInStudio = () => {
    if (!videoData || !selectedQuality) return;
    const titleToUse = options.customFilename.trim() || videoData.title;
    const savedItem = saveHistoryItem({
      title: titleToUse,
      platform: videoData.platform,
      platformName: videoData.platformName,
      qualityId: selectedQuality.id,
      qualityLabel: selectedQuality.label,
      formatId: selectedQuality.formatId,
      directUrl: selectedQuality.directUrl,
      format: selectedQuality.format,
      fileSizeMb: selectedQuality.fileSizeMb,
      durationSeconds: videoData.durationSeconds,
      thumbnail: videoData.thumbnail,
      originalUrl: videoData.url,
      streamUrl: videoData.streamUrl,
    });
    setLastSavedItem(savedItem);
    onDownloadFinished();
    onOpenInStudio(savedItem);
  };

  const toggleVideoPlayback = async () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused && !playPromiseRef.current) {
      try {
        const playPromise = video.play();
        if (playPromise !== undefined) {
          playPromiseRef.current = playPromise;
          await playPromise;
        }
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      } finally {
        playPromiseRef.current = null;
      }
    } else {
      if (playPromiseRef.current) {
        try {
          await playPromiseRef.current;
        } catch {
          // ignore interrupted play
        } finally {
          playPromiseRef.current = null;
        }
      }
      video.pause();
      setIsPlaying(false);
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = !videoRef.current.muted;
    setIsMuted(videoRef.current.muted);
  };

  const handleFullscreen = () => {
    if (!videoRef.current) return;
    if (videoRef.current.requestFullscreen) {
      videoRef.current.requestFullscreen();
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onEnded = () => setIsPlaying(false);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    video.addEventListener('ended', onEnded);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    return () => {
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
    };
  }, [videoData]);

  const badgeInfo = detectedType ? getPlatformBadge(detectedType) : null;

  return (
    <div className="space-y-8 pb-12">
      {/* Hero Header Area */}
      <div className="text-center max-w-3xl mx-auto space-y-3 pt-4">
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white" style={{ textWrap: 'balance' }}>
          {t.tagline}
        </h1>
        <p className="text-base sm:text-lg text-slate-600 dark:text-slate-400 max-w-2xl mx-auto" style={{ textWrap: 'balance' }}>
          {t.subTagline}
        </p>
      </div>

      {/* Main Link Input Card */}
      <div className="max-w-4xl mx-auto bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 sm:p-6 space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label htmlFor="video-url-input" className="block text-sm font-semibold text-slate-800 dark:text-slate-200">
              {lang === 'he' ? 'הדבק קישור אמיתי לסרטון' : 'Paste Real Video Link URL'}
            </label>
            <button
              type="button"
              onClick={() => setShowCookiesInput(!showCookiesInput)}
              className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-sky-500 transition-colors"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>{lang === 'he' ? 'אימות Cookies (אופציונלי)' : 'Auth Cookies (Optional)'}</span>
            </button>
          </div>

          <div className="relative flex flex-col sm:flex-row items-stretch gap-2">
            <div className="relative flex-1 flex items-center">
              <div className="absolute start-3.5 text-slate-400 flex items-center pointer-events-none">
                <Search className="w-5 h-5" />
              </div>

              <input
                id="video-url-input"
                type="url"
                value={inputUrl}
                onChange={(e) => {
                  setInputUrl(e.target.value);
                  setErrorMessage(null);
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
                placeholder={t.inputPlaceholder}
                className="w-full ps-11 pe-24 py-3.5 text-sm sm:text-base bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent transition-all"
              />

              {/* Action buttons inside input */}
              <div className="absolute end-2 flex items-center gap-1">
                {inputUrl && (
                  <button
                    onClick={() => {
                      setInputUrl('');
                      setVideoData(null);
                      setErrorMessage(null);
                    }}
                    title={t.clearButton}
                    className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-md hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={handlePaste}
                  title={t.pasteButton}
                  className="hidden sm:flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-200/70 dark:bg-slate-800 rounded-md transition-colors"
                >
                  <Clipboard className="w-3.5 h-3.5" />
                  <span>{lang === 'he' ? 'הדבק' : 'Paste'}</span>
                </button>
              </div>
            </div>

            {/* Analyze CTA */}
            <button
              onClick={() => handleAnalyze()}
              disabled={isAnalyzing || !inputUrl.trim()}
              className="px-6 py-3.5 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm sm:text-base rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isAnalyzing ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>{t.analyzing}</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>{t.analyzeButton}</span>
                </>
              )}
            </button>
          </div>

          {showCookiesInput && (
            <div className="pt-2 space-y-1">
              <label className="block text-xs text-slate-500 dark:text-slate-400">
                {lang === 'he'
                  ? 'עבור סרטונים מוגבלי גיל/אזור ביוטיוב או פייסבוק, ניתן להדביק כאן תוכן קובץ cookies.txt בפורמט Netscape:'
                  : 'For age/IP-restricted videos, paste Netscape format cookies.txt content here:'}
              </label>
              <textarea
                rows={3}
                value={cookiesText}
                onChange={(e) => setCookiesText(e.target.value)}
                placeholder="# Netscape HTTP Cookie File..."
                className="w-full p-2.5 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200"
              />
            </div>
          )}
        </div>

        {/* Platform identification indicator & quick real sample test links */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs">
          <div className="flex items-center gap-2">
            {detectedType && badgeInfo ? (
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-medium ${badgeInfo.bgLight} ${badgeInfo.bgDark} ${badgeInfo.borderLight} ${badgeInfo.borderDark}`}>
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: badgeInfo.color }} />
                <span>{t.platforms[detectedType]}</span>
              </span>
            ) : (
              <span className="text-slate-500 dark:text-slate-400">
                {lang === 'he' ? 'חילוץ ישיר בזמן אמת (ללא נתוני דמה)' : 'Real-time live stream extraction (Zero mock data)'}
              </span>
            )}
          </div>

          {/* Quick Real Verified Samples List */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-slate-500 dark:text-slate-400">{t.quickSamples}</span>
            {REAL_VERIFIED_SAMPLES.map((sample) => (
              <button
                key={sample.label}
                onClick={() => {
                  setInputUrl(sample.url);
                  handleAnalyze(sample.url);
                }}
                className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors whitespace-nowrap cursor-pointer"
              >
                {sample.category}
              </button>
            ))}
          </div>
        </div>

        {/* Error message notification */}
        {errorMessage && (
          <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-300 text-xs sm:text-sm leading-relaxed">
            {errorMessage}
          </div>
        )}
      </div>

      {/* Extracted Video Details & Interactive Quality Selector */}
      {videoData && (
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Main Media & Specs Card */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-0">
              {/* Media Preview Column */}
              <div className="md:col-span-5 bg-black relative flex items-center justify-center min-h-[260px] md:min-h-[340px]">
                <video
                  ref={videoRef}
                  src={videoData.streamUrl}
                  poster={videoData.thumbnail}
                  preload="metadata"
                  playsInline
                  controls={false}
                  className="w-full h-full max-h-[360px] object-contain"
                />

                {/* Overlaid player controls */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex flex-col justify-between p-3 pointer-events-none">
                  {/* Top bar info */}
                  <div className="flex items-center justify-between text-white text-xs pointer-events-auto">
                    <span className="bg-black/60 backdrop-blur-sm px-2 py-1 rounded font-mono font-medium">
                      {videoData.aspectRatio}
                    </span>
                    <span className="bg-black/60 backdrop-blur-sm px-2 py-1 rounded font-mono font-medium">
                      {videoData.durationFormatted}
                    </span>
                  </div>

                  {/* Bottom playback buttons */}
                  <div className="flex items-center justify-between pointer-events-auto text-white">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={toggleVideoPlayback}
                        className="p-2 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-sm transition-colors cursor-pointer"
                      >
                        {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-white" />}
                      </button>
                      <button
                        onClick={toggleMute}
                        className="p-2 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-sm transition-colors cursor-pointer"
                      >
                        {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
                      </button>
                    </div>

                    <button
                      onClick={handleFullscreen}
                      className="p-2 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-sm transition-colors cursor-pointer"
                    >
                      <Maximize2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Specs & Metadata Column */}
              <div className="md:col-span-7 p-5 sm:p-6 flex flex-col justify-between space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-semibold text-slate-900 dark:text-slate-200">{videoData.platformName}</span>
                    <span aria-hidden="true">·</span>
                    <span>{videoData.author} ({videoData.authorHandle})</span>
                    <span aria-hidden="true">·</span>
                    <a
                      href={videoData.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 hover:text-sky-500 transition-colors"
                    >
                      <span>{lang === 'he' ? 'פתח מקור' : 'Original link'}</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>

                  <h2 className="text-xl font-bold text-slate-900 dark:text-white leading-snug">
                    {videoData.title}
                  </h2>

                  {/* Clean unboxed metadata strip */}
                  <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 dark:text-slate-300 pt-1 font-mono-numbers">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      <span>{videoData.durationFormatted}</span>
                    </div>
                    {videoData.viewsFormatted !== '—' && (
                      <div className="flex items-center gap-1.5">
                        <Eye className="w-3.5 h-3.5 text-slate-400" />
                        <span>{videoData.viewsFormatted} {t.views}</span>
                      </div>
                    )}
                    {videoData.likesFormatted !== '—' && (
                      <div className="flex items-center gap-1.5">
                        <Heart className="w-3.5 h-3.5 text-slate-400" />
                        <span>{videoData.likesFormatted} {t.likes}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Real stream assurance */}
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between">
                  <span>
                    {lang === 'he'
                      ? `נמצאו ${videoData.qualities.length} איכויות זמינות מהמקור`
                      : `Found ${videoData.qualities.length} real streams from source`}
                  </span>
                  <span className="font-mono text-[11px] text-slate-400">ID: {videoData.id}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Quality Picker Section */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-5 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                  {t.selectQualityTitle}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t.selectQualityDesc}
                </p>
              </div>

              {selectedQuality && (
                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono-numbers">
                  {t.fileSizeEst}: <span className="font-semibold text-slate-900 dark:text-white">~{selectedQuality.fileSizeMb} MB</span>
                </div>
              )}
            </div>

            {/* Quality Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {videoData.qualities.map((q) => {
                const isSelected = selectedQuality?.id === q.id;
                const isAudio = q.format === 'mp3';

                return (
                  <button
                    key={q.id}
                    onClick={() => setSelectedQuality(q)}
                    className={`relative text-start p-3.5 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'border-sky-500 bg-sky-50/50 dark:bg-sky-950/30 ring-2 ring-sky-500/20'
                        : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-slate-50/50 dark:bg-slate-950/40'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className={`p-2 rounded-lg ${isAudio ? 'bg-amber-100 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400' : 'bg-sky-100 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400'}`}>
                          {isAudio ? <Music className="w-4 h-4" /> : <Film className="w-4 h-4" />}
                        </div>
                        <div>
                          <div className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-1.5">
                            <span>{q.label}</span>
                            {q.isPopular && (
                              <span className="text-[10px] uppercase font-semibold text-sky-600 dark:text-sky-400 bg-sky-100 dark:bg-sky-900/60 px-1.5 py-0.2 rounded">
                                {lang === 'he' ? 'מומלץ' : 'Best'}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 font-mono-numbers">
                            {q.resolution} {q.fps > 0 ? `· ${q.fps}fps` : ''} · {q.format.toUpperCase()}
                          </div>
                        </div>
                      </div>

                      {/* Selected radio check */}
                      <div className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${
                        isSelected
                          ? 'border-sky-500 bg-sky-500 text-white'
                          : 'border-slate-300 dark:border-slate-700'
                      }`}>
                        {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>
                    </div>

                    <div className="mt-3 pt-2 border-t border-slate-200/60 dark:border-slate-800/80 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 font-mono-numbers">
                      <span>{q.bitrate}</span>
                      <span className="font-semibold text-slate-900 dark:text-slate-200">~{q.fileSizeMb} MB</span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Advanced Trimming & Mute Settings */}
            <div className="pt-2">
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-sky-600 dark:hover:text-sky-400 transition-colors cursor-pointer"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>{t.advancedOptions}</span>
                <span className="text-slate-400">({showAdvanced ? (lang === 'he' ? 'הסתר' : 'Hide') : (lang === 'he' ? 'הצג' : 'Show')})</span>
              </button>

              {showAdvanced && (
                <div className="mt-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-4">
                  {/* Custom Filename */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      {t.customFilename}
                    </label>
                    <input
                      type="text"
                      value={options.customFilename}
                      onChange={(e) => setOptions({ ...options, customFilename: e.target.value })}
                      placeholder="my_video"
                      className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white"
                    />
                  </div>

                  {/* Mute Audio Option */}
                  <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={options.muteAudio}
                      onChange={(e) => setOptions({ ...options, muteAudio: e.target.checked })}
                      className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                    />
                    <span>{t.muteAudio}</span>
                  </label>

                  {/* Enable Trim Checkbox + Range */}
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={options.trimEnabled}
                        onChange={(e) => setOptions({ ...options, trimEnabled: e.target.checked })}
                        className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                      />
                      <span>{t.trimVideo} (FFmpeg)</span>
                    </label>

                    {options.trimEnabled && (
                      <div className="flex items-center gap-3 pt-1">
                        <div className="flex-1 space-y-1">
                          <span className="text-[11px] text-slate-500">{t.fromTime} (שניות): {options.trimStart}s</span>
                          <input
                            type="range"
                            min="0"
                            max={Math.max(1, videoData.durationSeconds - 1)}
                            value={options.trimStart}
                            onChange={(e) =>
                              setOptions({
                                ...options,
                                trimStart: Math.min(Number(e.target.value), options.trimEnd - 1),
                              })
                            }
                            className="w-full accent-sky-500"
                          />
                        </div>
                        <div className="flex-1 space-y-1">
                          <span className="text-[11px] text-slate-500">{t.toTime} (שניות): {options.trimEnd}s</span>
                          <input
                            type="range"
                            min="1"
                            max={videoData.durationSeconds}
                            value={options.trimEnd}
                            onChange={(e) =>
                              setOptions({
                                ...options,
                                trimEnd: Math.max(Number(e.target.value), options.trimStart + 1),
                              })
                            }
                            className="w-full accent-sky-500"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Download Progress Bar & Speed Indicator */}
            {isDownloading && downloadProgress && (
              <div className="p-4 rounded-xl bg-sky-50/70 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-900/50 space-y-2">
                <div className="flex items-center justify-between text-xs font-medium text-sky-900 dark:text-sky-200 font-mono-numbers">
                  <span className="font-semibold">{t.downloadingProgress}</span>
                  <span>{downloadProgress.percent}%</span>
                </div>

                <div className="w-full h-2 bg-sky-200/60 dark:bg-sky-900/60 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-sky-500 transition-all duration-150 rounded-full"
                    style={{ width: `${downloadProgress.percent}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 font-mono-numbers">
                  <span>
                    {downloadProgress.loadedMb} MB / {downloadProgress.totalMb} MB
                  </span>
                  <span>
                    {downloadProgress.speedMbPerSec > 0 ? `${downloadProgress.speedMbPerSec} MB/s · ETA: ${downloadProgress.etaSeconds}s` : (lang === 'he' ? 'ממיר ומוריד מהמקור...' : 'Converting & streaming...')}
                  </span>
                </div>
              </div>
            )}

            {/* Success Banner + Direct Open in Video & Subtitle Studio CTA */}
            {downloadSuccess && (
              <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-emerald-800 dark:text-emerald-300 text-sm">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                  <span className="font-semibold">{t.downloadComplete}</span>
                </div>
                <div className="flex items-center gap-2">
                  {lastSavedItem && (
                    <button
                      onClick={() => onOpenInStudio(lastSavedItem)}
                      className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm"
                    >
                      <Subtitles className="w-4 h-4" />
                      <span>{t.openInStudio}</span>
                    </button>
                  )}
                  <button
                    onClick={() => setDownloadSuccess(false)}
                    className="text-xs text-emerald-700 dark:text-emerald-400 hover:underline px-2"
                  >
                    {lang === 'he' ? 'סגור' : 'Dismiss'}
                  </button>
                </div>
              </div>
            )}

            {/* Primary Download & Studio CTA Buttons */}
            <div className="pt-2 grid grid-cols-1 sm:grid-cols-12 gap-3">
              <button
                onClick={() => handleDownload(false)}
                disabled={isDownloading || !selectedQuality}
                className="sm:col-span-7 py-4 px-6 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white font-bold text-base rounded-xl shadow-sm transition-all flex items-center justify-center gap-3 cursor-pointer"
              >
                {isDownloading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>{t.preparingDownload}</span>
                  </>
                ) : (
                  <>
                    <Download className="w-5 h-5" />
                    <span>
                      {t.downloadNow} ({selectedQuality?.label} · ~{selectedQuality?.fileSizeMb} MB)
                    </span>
                  </>
                )}
              </button>

              <button
                onClick={() => handleDownload(true)}
                disabled={isDownloading || !selectedQuality}
                className="sm:col-span-5 py-4 px-4 bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 disabled:opacity-50 text-white font-bold text-sm rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer border border-slate-700"
              >
                <Subtitles className="w-4 h-4 text-sky-400 shrink-0" />
                <span>
                  {lang === 'he'
                    ? 'הורד וערוך כתוביות בעברית (Cartesia)'
                    : 'Download & Edit Subtitles (Cartesia)'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

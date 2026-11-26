import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Subtitles,
  Wand2,
  Plus,
  Trash2,
  Download,
  FileText,
  Palette,
  Sliders,
  Upload,
  CheckCircle2,
  Languages,
  Scissors,
  Clock,
  Film,
  RotateCcw,
  Volume1,
  SkipBack,
  SkipForward,
  Search,
  Crop,
  Square,
} from 'lucide-react';
import {
  DownloadHistoryItem,
  SubtitleCue,
  SubtitleStyleConfig,
  VideoStudioAdjustments,
  CropAspectRatio,
} from '../types/video';
import { Language } from '../constants/translations';
import {
  pollAndDownloadJob,
  saveBlobLocally,
  DownloadProgress,
} from '../utils/downloader';
import { updateHistoryItem } from '../utils/storage';

interface VideoStudioViewProps {
  lang: Language;
  activeVideo: DownloadHistoryItem | null;
  history: DownloadHistoryItem[];
  autoTranscribeRequested?: boolean;
  onClearAutoTranscribe?: () => void;
  onSelectVideo: (item: DownloadHistoryItem) => void;
  onHistoryUpdated: () => void;
  onGoToDownloader: () => void;
}

const DEFAULT_STYLE: SubtitleStyleConfig = {
  preset: 'cinema',
  fontSize: 26,
  primaryColor: '#FFFFFF',
  outlineColor: '#000000',
  bgOpacity: 0.55,
  position: 'bottom',
  displayMode: 'hebrew',
  rtl: true,
  bold: true,
};

const STYLE_PRESETS: Array<{
  id: SubtitleStyleConfig['preset'];
  labelHe: string;
  labelEn: string;
  config: Partial<SubtitleStyleConfig>;
}> = [
  {
    id: 'cinema',
    labelHe: 'קולנוע קלאסי',
    labelEn: 'Cinema Classic',
    config: {
      primaryColor: '#FFFFFF',
      outlineColor: '#000000',
      bgOpacity: 0.55,
      bold: true,
      fontSize: 26,
    },
  },
  {
    id: 'reels_yellow',
    labelHe: 'רילס / טיקטוק בולט',
    labelEn: 'Reels Yellow Bold',
    config: {
      primaryColor: '#FACC15',
      outlineColor: '#000000',
      bgOpacity: 0,
      bold: true,
      fontSize: 30,
    },
  },
  {
    id: 'modern_box',
    labelHe: 'תיבה כהה מודרנית',
    labelEn: 'Modern Dark Box',
    config: {
      primaryColor: '#F8FAFC',
      outlineColor: '#0F172A',
      bgOpacity: 0.8,
      bold: true,
      fontSize: 24,
    },
  },
  {
    id: 'minimal_outline',
    labelHe: 'קו מתאר נקי',
    labelEn: 'Clean Outline',
    config: {
      primaryColor: '#FFFFFF',
      outlineColor: '#090D16',
      bgOpacity: 0,
      bold: true,
      fontSize: 27,
    },
  },
  {
    id: 'neon_sky',
    labelHe: 'סטודיו תכלת',
    labelEn: 'Studio Sky',
    config: {
      primaryColor: '#38BDF8',
      outlineColor: '#020617',
      bgOpacity: 0.65,
      bold: true,
      fontSize: 27,
    },
  },
];

function formatTimecode(sec: number): string {
  const safe = Math.max(0, Number(sec) || 0);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const tenths = Math.floor((safe % 1) * 10);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${tenths}`;
}

function formatSrtTimestamp(seconds: number): string {
  const msTotal = Math.max(0, Math.round((seconds || 0) * 1000));
  const ms = msTotal % 1000;
  const totalSec = Math.floor(msTotal / 1000);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s
    .toString()
    .padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

export const VideoStudioView: React.FC<VideoStudioViewProps> = ({
  lang,
  activeVideo,
  history,
  autoTranscribeRequested = false,
  onClearAutoTranscribe,
  onSelectVideo,
  onHistoryUpdated,
  onGoToDownloader,
}) => {
  const isHe = lang === 'he';

  // Local uploaded file support
  const [localBlobUrl, setLocalBlobUrl] = useState<string | null>(null);
  const [localFileTitle, setLocalFileTitle] = useState<string>('');
  const [isUploadingLocal, setIsUploadingLocal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Active video state
  const currentVideo = activeVideo || (history.length > 0 ? history[0] : null);
  const [currentJobId, setCurrentJobId] = useState<string | undefined>(currentVideo?.jobId);

  // Subtitles & Transcription State
  const [cues, setCues] = useState<SubtitleCue[]>(currentVideo?.subtitles || []);
  const [searchQuery, setSearchQuery] = useState('');
  const [languageHint, setLanguageHint] = useState<'auto' | 'he' | 'en' | 'es'>('auto');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeProgress, setTranscribeProgress] = useState<number>(0);
  const [transcribeStep, setTranscribeStep] = useState<string>('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [speakingCueId, setSpeakingCueId] = useState<string | null>(null);
  const [transcriptionMeta, setTranscriptionMeta] = useState<{
    engine: string;
    detectedLanguage: string;
  } | null>(null);

  // Inspector Panel Tab
  const [inspectorTab, setInspectorTab] = useState<'subtitles' | 'style' | 'adjust'>('subtitles');

  // Subtitle Styling
  const [styleConfig, setStyleConfig] = useState<SubtitleStyleConfig>(DEFAULT_STYLE);

  // Video Adjustments (Trim, Crop & Color)
  const [duration, setDuration] = useState<number>(currentVideo?.durationSeconds || 60);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [adjustments, setAdjustments] = useState<VideoStudioAdjustments>({
    trimStart: 0,
    trimEnd: currentVideo?.durationSeconds || 60,
    brightness: 0,
    contrast: 1,
    saturation: 1,
    muteOriginalAudio: false,
    cropAspect: 'original',
    cropOffsetX: 0,
    cropOffsetY: 0,
  });
  const [isDraggingCrop, setIsDraggingCrop] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; startOffsetX: number; startOffsetY: number } | null>(null);

  // Render & Export State
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState<DownloadProgress | null>(null);
  const [renderSuccess, setRenderSuccess] = useState(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Video Player Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const playPromiseRef = useRef<Promise<void> | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  // Sync state when selected video changes
  useEffect(() => {
    if (!currentVideo) return;
    setCurrentJobId(currentVideo.jobId);
    setCues(currentVideo.subtitles || []);
    setErrorBanner(null);
    setRenderSuccess(false);
    setIsPlaying(false);
    setCurrentTime(0);
    const dur = currentVideo.durationSeconds || 60;
    setDuration(dur);
    setAdjustments({
      trimStart: 0,
      trimEnd: dur,
      brightness: 0,
      contrast: 1,
      saturation: 1,
      muteOriginalAudio: false,
      cropAspect: 'original',
      cropOffsetX: 0,
      cropOffsetY: 0,
    });
  }, [currentVideo?.id]);

  // Persist subtitles to localStorage history whenever cues change
  const updateCuesAndSave = (nextCues: SubtitleCue[], nextJobId?: string) => {
    setCues(nextCues);
    if (currentVideo?.id && !localBlobUrl) {
      updateHistoryItem(currentVideo.id, {
        subtitles: nextCues,
        jobId: nextJobId || currentJobId || currentVideo.jobId,
      });
      onHistoryUpdated();
    }
  };

  // Determine optimal video source URL for the studio player
  const videoSrc = localBlobUrl
    ? localBlobUrl
    : currentJobId
    ? `/api/studio/video-stream?jobId=${encodeURIComponent(currentJobId)}`
    : currentVideo?.streamUrl || '';

  const togglePlayback = async () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused && !playPromiseRef.current) {
      try {
        const p = video.play();
        if (p !== undefined) {
          playPromiseRef.current = p;
          await p;
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
          // ignore
        } finally {
          playPromiseRef.current = null;
        }
      }
      video.pause();
      setIsPlaying(false);
    }
  };

  const seekTo = (timeSec: number) => {
    const video = videoRef.current;
    const clamped = Math.max(0, Math.min(duration, timeSec));
    setCurrentTime(clamped);
    if (video) {
      video.currentTime = clamped;
    }
  };

  // Handle Cartesia STT Transcription + Automatic Hebrew Subtitles (Async Job + Polling)
  const handleCartesiaTranscribe = async () => {
    if (!currentVideo && !localBlobUrl) return;
    if (isUploadingLocal) return;

    setIsTranscribing(true);
    setTranscribeProgress(10);
    setTranscribeStep(
      isHe
        ? 'מתחיל חילוץ ערוץ שמע ותמלול לכתוביות בעברית...'
        : 'Starting audio extraction & Hebrew subtitle transcription...'
    );
    setErrorBanner(null);
    setStatusBanner(null);

    try {
      const startRes = await fetch('/api/studio/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'async',
          jobId: currentJobId || (!localBlobUrl ? currentVideo?.jobId : undefined),
          url: !localBlobUrl ? currentVideo?.originalUrl : undefined,
          directUrl: !localBlobUrl ? currentVideo?.directUrl : undefined,
          formatId: !localBlobUrl ? currentVideo?.formatId : undefined,
          quality: (!localBlobUrl && currentVideo?.qualityId) || '720p',
          title: localBlobUrl ? localFileTitle : currentVideo?.title || 'video',
          languageHint: languageHint === 'auto' ? undefined : languageHint,
        }),
      });

      const startData = await startRes.json();
      if (!startRes.ok || !startData.success) {
        throw new Error(startData.error || 'שגיאה בהתחלת תמלול הסרטון');
      }

      // Poll async transcription job until ready
      const sttJobId: string = startData.transcribeJobId;
      let resolvedCues: SubtitleCue[] = [];
      let resolvedVideoJobId: string | undefined;
      let resolvedLang = 'auto';
      let resolvedEngine = 'cartesia-ink-whisper';

      const maxWaitMs = 180000;
      const t0 = Date.now();
      while (Date.now() - t0 < maxWaitMs) {
        await new Promise((r) => setTimeout(r, 750));
        const pollRes = await fetch(
          `/api/studio/transcribe-status?jobId=${encodeURIComponent(sttJobId)}`
        );
        const pollData = await pollRes.json();
        if (!pollRes.ok || !pollData.success) {
          throw new Error(pollData.error || 'שגיאה בבדיקת סטטוס התמלול');
        }

        if (typeof pollData.progress === 'number') {
          setTranscribeProgress(pollData.progress);
        }
        if (pollData.step) {
          setTranscribeStep(pollData.step);
        }

        if (pollData.status === 'error') {
          throw new Error(pollData.error || 'שגיאה בתמלול הסרטון והפקת הכתוביות בעברית');
        }

        if (pollData.status === 'ready') {
          resolvedCues = Array.isArray(pollData.cues) ? pollData.cues : [];
          resolvedVideoJobId = pollData.jobId;
          resolvedLang = pollData.detectedLanguage || 'auto';
          resolvedEngine = pollData.engine || 'cartesia-ink-whisper';
          break;
        }
      }

      if (resolvedVideoJobId) {
        setCurrentJobId(resolvedVideoJobId);
      }

      // Ensure displayMode shows Hebrew subtitles if it was set to 'original'
      if (styleConfig.displayMode === 'original') {
        setStyleConfig((prev) => ({ ...prev, displayMode: 'hebrew', rtl: true }));
      }

      if (resolvedCues.length > 0) {
        const maxCueEnd = Math.ceil(Math.max(...resolvedCues.map((c) => Number(c.end) || 0)));
        if (maxCueEnd > duration) {
          setDuration(maxCueEnd);
          setAdjustments((prev) => ({
            ...prev,
            trimEnd: prev.trimEnd >= duration - 2 ? maxCueEnd : prev.trimEnd,
          }));
        }
      }

      updateCuesAndSave(resolvedCues, resolvedVideoJobId);
      setTranscriptionMeta({
        engine:
          resolvedEngine === 'cartesia-ink-whisper'
            ? 'Cartesia ink-whisper'
            : 'Cartesia Hybrid Audio STT',
        detectedLanguage: resolvedLang,
      });
      setStatusBanner(
        isHe
          ? `התמלול הושלם בהצלחה! זוהתה שפת מקור (${resolvedLang.toUpperCase()}) ונוצרו ${resolvedCues.length} כתוביות מסונכרנות בעברית.`
          : `Transcription complete! Detected (${resolvedLang.toUpperCase()}) and generated ${resolvedCues.length} synchronized Hebrew subtitles.`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Transcription error';
      setErrorBanner(msg);
      setStatusBanner(null);
    } finally {
      setIsTranscribing(false);
    }
  };

  // Auto-start transcription when opened via "הורד וערוך כתוביות בעברית"
  useEffect(() => {
    if (
      autoTranscribeRequested &&
      currentVideo &&
      (!currentVideo.subtitles || currentVideo.subtitles.length === 0) &&
      !isTranscribing
    ) {
      if (onClearAutoTranscribe) onClearAutoTranscribe();
      handleCartesiaTranscribe();
    } else if (autoTranscribeRequested && onClearAutoTranscribe) {
      onClearAutoTranscribe();
    }
  }, [autoTranscribeRequested, currentVideo?.id]);

  // Handle AI Hebrew Translation / Refinement of existing cues
  const handleTranslateAllToHebrew = async () => {
    if (cues.length === 0) return;
    setIsTranslating(true);
    setErrorBanner(null);

    try {
      const res = await fetch('/api/studio/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cues,
          title: currentVideo?.title || localFileTitle || '',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'שגיאה בתרגום הכתוביות לעברית');
      }
      updateCuesAndSave(data.cues);
      setStatusBanner(
        isHe ? 'כל הכתוביות תורגמו ולוטשו לעברית בהצלחה!' : 'All subtitles translated to Hebrew!'
      );
    } catch (err: unknown) {
      setErrorBanner(err instanceof Error ? err.message : 'Translation failed');
    } finally {
      setIsTranslating(false);
    }
  };

  // Speak a subtitle cue via Cartesia TTS
  const handleSpeakCue = async (cue: SubtitleCue) => {
    const textToSpeak = (cue.hebrewText || cue.originalText || '').trim();
    if (!textToSpeak) return;

    setSpeakingCueId(cue.id);
    setErrorBanner(null);
    try {
      const res = await fetch('/api/studio/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: textToSpeak,
          lang: 'he',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success || !data.audioBase64) {
        throw new Error(data.error || 'שגיאה בהפקת קריינות');
      }
      const audio = new Audio(`data:${data.mimeType || 'audio/wav'};base64,${data.audioBase64}`);
      await audio.play();
    } catch (err: unknown) {
      setErrorBanner(err instanceof Error ? err.message : 'TTS failed');
    } finally {
      setSpeakingCueId(null);
    }
  };

  // Add a new subtitle cue at the current playhead timestamp
  const handleAddCueAtPlayhead = () => {
    const start = Number(currentTime.toFixed(2));
    const end = Number(Math.min(duration, start + 3.0).toFixed(2));
    const newCue: SubtitleCue = {
      id: `cue_${Date.now()}`,
      start,
      end: Math.max(start + 1.0, end),
      originalText: '',
      hebrewText: isHe ? 'כתובית חדשה בעברית' : 'כתובית חדשה',
    };
    const next = [...cues, newCue].sort((a, b) => a.start - b.start);
    updateCuesAndSave(next);
  };

  // Split the currently active subtitle cue at the playhead
  const handleSplitActiveCue = () => {
    const idx = cues.findIndex((c) => currentTime > c.start + 0.4 && currentTime < c.end - 0.4);
    if (idx === -1) return;
    const target = cues[idx];
    const splitPoint = Number(currentTime.toFixed(2));

    const firstHalf: SubtitleCue = {
      ...target,
      end: splitPoint,
    };
    const secondHalf: SubtitleCue = {
      id: `cue_${Date.now()}`,
      start: splitPoint,
      end: target.end,
      originalText: target.originalText,
      hebrewText: target.hebrewText,
    };

    const next = [...cues.slice(0, idx), firstHalf, secondHalf, ...cues.slice(idx + 1)];
    updateCuesAndSave(next);
  };

  // Shift all subtitle timestamps by offsetSec (e.g. -0.5s or +0.5s)
  const handleShiftAllTimestamps = (offsetSec: number) => {
    if (cues.length === 0) return;
    const next = cues.map((c) => {
      const nextStart = Number(Math.max(0, c.start + offsetSec).toFixed(2));
      const nextEnd = Number(Math.max(nextStart + 0.5, c.end + offsetSec).toFixed(2));
      return {
        ...c,
        start: nextStart,
        end: nextEnd,
      };
    });
    updateCuesAndSave(next);
  };

  const handleUpdateCueField = (
    id: string,
    field: 'start' | 'end' | 'hebrewText' | 'originalText',
    value: string | number
  ) => {
    const next = cues.map((c) => (c.id === id ? { ...c, [field]: value } : c));
    updateCuesAndSave(next);
  };

  const handleDeleteCue = (id: string) => {
    updateCuesAndSave(cues.filter((c) => c.id !== id));
  };

  // Export SRT or VTT subtitle file
  const handleExportSubtitlesFile = (format: 'srt' | 'vtt') => {
    if (cues.length === 0) return;
    const safeTitle = (currentVideo?.title || localFileTitle || 'subtitles')
      .replace(/[^a-zA-Z0-9_\u0590-\u05FF-]/g, '_')
      .substring(0, 40);

    if (format === 'srt') {
      const srtLines = cues.map((c, idx) => {
        const text =
          styleConfig.displayMode === 'original'
            ? c.originalText || c.hebrewText
            : styleConfig.displayMode === 'bilingual' && c.hebrewText && c.originalText && c.hebrewText !== c.originalText
            ? `${c.hebrewText}\n${c.originalText}`
            : c.hebrewText || c.originalText;
        return `${idx + 1}\n${formatSrtTimestamp(c.start)} --> ${formatSrtTimestamp(
          c.end
        )}\n${text}\n`;
      });
      const blob = new Blob(['\uFEFF' + srtLines.join('\n')], {
        type: 'text/plain;charset=utf-8',
      });
      saveBlobLocally(blob, `${safeTitle}_hebrew.srt`);
    } else {
      const vttLines = [
        'WEBVTT',
        '',
        ...cues.map((c, idx) => {
          const startVtt = formatSrtTimestamp(c.start).replace(',', '.');
          const endVtt = formatSrtTimestamp(c.end).replace(',', '.');
          const text = c.hebrewText || c.originalText;
          return `${idx + 1}\n${startVtt} --> ${endVtt}\n${text}\n`;
        }),
      ];
      const blob = new Blob(['\uFEFF' + vttLines.join('\n')], {
        type: 'text/vtt;charset=utf-8',
      });
      saveBlobLocally(blob, `${safeTitle}_hebrew.vtt`);
    }
  };

  // Burn-in Hebrew subtitles & export edited MP4 via FFmpeg on server
  const handleBurnAndExportVideo = async () => {
    if (!currentVideo && !localBlobUrl) return;
    setIsRendering(true);
    setRenderSuccess(false);
    setErrorBanner(null);
    const estSize = (!localBlobUrl && currentVideo?.fileSizeMb) || 10;
    const activeTitle = localBlobUrl ? localFileTitle || 'video' : currentVideo?.title || 'video';
    setRenderProgress({
      percent: 8,
      speedMbPerSec: 0,
      loadedMb: 0,
      totalMb: estSize,
      etaSeconds: 8,
    });

    try {
      const res = await fetch('/api/studio/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: currentJobId || (!localBlobUrl ? currentVideo?.jobId : undefined),
          url: !localBlobUrl ? currentVideo?.originalUrl : undefined,
          directUrl: !localBlobUrl ? currentVideo?.directUrl : undefined,
          formatId: !localBlobUrl ? currentVideo?.formatId : undefined,
          quality: (!localBlobUrl && currentVideo?.qualityId) || '720p',
          title: activeTitle,
          platform: (!localBlobUrl && currentVideo?.platform) || 'studio',
          cues,
          styleConfig,
          adjustments,
        }),
      });

      const prepData = await res.json();
      if (!res.ok || !prepData.success || !prepData.jobId) {
        throw new Error(prepData.error || 'שגיאה בהתחלת צריבת הכתוביות לסרטון');
      }

      const { blob, filename } = await pollAndDownloadJob({
        jobId: prepData.jobId,
        initialStatus: prepData.status,
        fallbackFilename: prepData.filename || `${activeTitle}_subtitled.mp4`,
        mimeType: 'video/mp4',
        estTotalMb: estSize,
        deleteAfterDownload: true,
        onProgress: (p) => setRenderProgress(p),
      });

      saveBlobLocally(blob, filename);
      setRenderSuccess(true);
      setStatusBanner(
        isHe
          ? 'הסרטון הערוך עם הכתוביות הצרובות בעברית נשמר במכשירך בהצלחה!'
          : 'Edited video with burned-in Hebrew subtitles saved to your device!'
      );
    } catch (err: unknown) {
      setErrorBanner(err instanceof Error ? err.message : 'שגיאה בייצוא הסרטון הערוך');
    } finally {
      setIsRendering(false);
    }
  };

  // Handle local video file upload for immediate preview, server upload & Hebrew subtitle transcription
  const handleLocalFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (localBlobUrl) URL.revokeObjectURL(localBlobUrl);
    const url = URL.createObjectURL(file);
    setLocalBlobUrl(url);
    setLocalFileTitle(file.name.replace(/\.[^.]+$/, ''));
    setCues([]);
    setCurrentJobId(undefined);
    setErrorBanner(null);

    setIsUploadingLocal(true);
    setStatusBanner(
      isHe
        ? 'טוען את קובץ הווידאו לסטודיו לצורך תמלול ועריכה...'
        : 'Uploading local video file to Studio for transcription & editing...'
    );
    try {
      const buf = await file.arrayBuffer();
      const upRes = await fetch(
        `/api/studio/upload-local?filename=${encodeURIComponent(file.name)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: buf,
        }
      );
      const upData = await upRes.json();
      if (!upRes.ok || !upData.success || !upData.jobId) {
        throw new Error(upData.error || 'שגיאה בטעינת קובץ הווידאו לשרת');
      }
      setCurrentJobId(upData.jobId);
      setStatusBanner(
        isHe
          ? 'הקובץ נטען בהצלחה! לחץ על "תמלול אוטומטי וכתוביות בעברית" להתחלת התמלול.'
          : 'Local video uploaded! Click "Auto-Transcribe & Hebrew Subtitles" to transcribe.'
      );
    } catch (err: unknown) {
      setErrorBanner(err instanceof Error ? err.message : 'שגיאה בטעינת קובץ הווידאו');
      setStatusBanner(null);
    } finally {
      setIsUploadingLocal(false);
    }
  };

  // Find active subtitle cue at current video playback time
  const activeCue = cues.find((c) => currentTime >= c.start && currentTime <= c.end) || null;

  const filteredCues = cues.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.hebrewText.toLowerCase().includes(q) || c.originalText.toLowerCase().includes(q)
    );
  });

  // Empty state when no video has been downloaded or selected yet
  if (!currentVideo && !localBlobUrl) {
    return (
      <div className="max-w-4xl mx-auto py-12">
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 sm:p-12 text-center space-y-5 shadow-sm">
          <div className="w-14 h-14 rounded-2xl bg-sky-50 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400 flex items-center justify-center mx-auto">
            <Subtitles className="w-7 h-7" />
          </div>
          <div className="space-y-2 max-w-lg mx-auto">
            <h2 className="text-2xl font-extrabold text-slate-900 dark:text-white">
              {isHe
                ? 'סטודיו לעריכת וידאו, תמלול Cartesia וכתוביות בעברית'
                : 'Video Editing Studio, Cartesia Transcription & Hebrew Subtitles'}
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              {isHe
                ? 'הורד סרטון מכל רשת חברתית בלשונית ההורדה או בחר קובץ וידאו מהמחשב כדי לתמלל אוטומטית דרך Cartesia, לערוך כתוביות בעברית ולצרוב אותן ישירות לגוף הסרטון.'
                : 'Download a video first or upload a local video file to transcribe with Cartesia, edit Hebrew subtitles, and burn them into your MP4.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              onClick={onGoToDownloader}
              className="px-5 py-3 bg-sky-500 hover:bg-sky-600 text-white font-semibold text-sm rounded-xl transition-colors flex items-center gap-2 cursor-pointer"
            >
              <Film className="w-4 h-4" />
              <span>{isHe ? 'הורד סרטון מרשת חברתית' : 'Download a Social Video'}</span>
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-5 py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-semibold text-sm rounded-xl transition-colors flex items-center gap-2 cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              <span>{isHe ? 'טען קובץ וידאו מהמחשב' : 'Open Local Video File'}</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              onChange={handleLocalFileUpload}
              className="hidden"
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-14">
      {/* Top Studio Header & Video Switcher Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 shadow-sm">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-sky-600 dark:text-sky-400">
              {isHe ? 'סטודיו עריכת וידאו וכתוביות · Cartesia AI' : 'Video & Hebrew Subtitle Studio · Cartesia AI'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-numbers">
              {cues.length} {isHe ? 'כתוביות' : 'subtitles'}
            </span>
            {transcriptionMeta && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  {transcriptionMeta.engine} ({transcriptionMeta.detectedLanguage.toUpperCase()})
                </span>
              </>
            )}
          </div>
          <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white truncate">
            {localBlobUrl ? localFileTitle : currentVideo?.title}
          </h1>
        </div>

        {/* Video Selector from Downloaded History + Upload */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {history.length > 0 && (
            <select
              value={currentVideo?.id || ''}
              onChange={(e) => {
                const found = history.find((h) => h.id === e.target.value);
                if (found) {
                  setLocalBlobUrl(null);
                  onSelectVideo(found);
                }
              }}
              className="px-3 py-2 text-xs font-medium bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-200 max-w-[240px] truncate"
            >
              {history.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.title} ({h.qualityLabel})
                </option>
              ))}
            </select>
          )}

          <button
            onClick={handleCartesiaTranscribe}
            disabled={isTranscribing || isUploadingLocal}
            className="px-4 py-2 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white font-semibold text-xs sm:text-sm rounded-xl transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer shadow-sm"
          >
            {isTranscribing ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>
                  {isHe
                    ? `מתמלל ומתרגם לעברית (${transcribeProgress}%)...`
                    : `Transcribing (${transcribeProgress}%)...`}
                </span>
              </>
            ) : (
              <>
                <Wand2 className="w-4 h-4" />
                <span>
                  {isHe ? 'תמלול אוטומטי וכתוביות בעברית (Cartesia)' : 'Auto-Transcribe & Hebrew Subtitles (Cartesia)'}
                </span>
              </>
            )}
          </button>

          <button
            onClick={handleBurnAndExportVideo}
            disabled={isRendering || (!currentVideo && !localBlobUrl)}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-xs sm:text-sm rounded-xl transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer shadow-sm"
          >
            {isRendering ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>{isHe ? 'צורב כתוביות...' : 'Rendering MP4...'}</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>{isHe ? 'צרוב כתוביות וייצא MP4' : 'Burn Subtitles & Export MP4'}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Live Transcription Progress Bar */}
      {isTranscribing && (
        <div className="p-4 rounded-xl bg-sky-50/90 dark:bg-sky-950/50 border border-sky-200 dark:border-sky-800/70 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-sky-900 dark:text-sky-200 font-mono-numbers">
            <span className="flex items-center gap-2">
              <div className="w-3.5 h-3.5 border-2 border-sky-500/30 border-t-sky-500 rounded-full animate-spin" />
              <span>{transcribeStep || (isHe ? 'מתמלל דיבור ומתרגם לכתוביות בעברית...' : 'Transcribing audio to Hebrew subtitles...')}</span>
            </span>
            <span>{transcribeProgress}%</span>
          </div>
          <div className="w-full h-2 bg-sky-200/70 dark:bg-sky-900/60 rounded-full overflow-hidden">
            <div
              className="h-full bg-sky-500 transition-all duration-300 rounded-full"
              style={{ width: `${Math.max(8, transcribeProgress)}%` }}
            />
          </div>
        </div>
      )}

      {/* Status / Error Banners */}
      {statusBanner && (
        <div className="p-3.5 rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800/60 flex items-center justify-between gap-3 text-sky-900 dark:text-sky-200 text-xs sm:text-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-sky-500 shrink-0" />
            <span>{statusBanner}</span>
          </div>
          <button
            onClick={() => setStatusBanner(null)}
            className="text-xs text-sky-600 dark:text-sky-400 hover:underline shrink-0"
          >
            {isHe ? 'סגור' : 'Dismiss'}
          </button>
        </div>
      )}

      {errorBanner && (
        <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-red-700 dark:text-red-300 text-xs sm:text-sm">
          {errorBanner}
        </div>
      )}

      {/* Render Progress Bar */}
      {isRendering && renderProgress && (
        <div className="p-4 rounded-xl bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-emerald-900 dark:text-emerald-200 font-mono-numbers">
            <span>
              {isHe
                ? 'צורב כתוביות בעברית לגוף הסרטון ב-FFmpeg ומוריד...'
                : 'Burning Hebrew subtitles into video frames via FFmpeg...'}
            </span>
            <span>{renderProgress.percent}%</span>
          </div>
          <div className="w-full h-2 bg-emerald-200/60 dark:bg-emerald-900/60 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-150 rounded-full"
              style={{ width: `${renderProgress.percent}%` }}
            />
          </div>
        </div>
      )}

      {/* Main 12-Column Studio Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left/Center Column (7 cols): Video Canvas + Live Hebrew Subtitle Overlay + Timeline */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
            {/* Quick Aspect Ratio & 1:1 Square Crop Toolbar */}
            <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/70 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
                <Crop className="w-3.5 h-3.5 text-sky-500" />
                <span>{isHe ? 'חיתוך מסגרת (Cropping):' : 'Crop Aspect Ratio:'}</span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { id: 'original', labelHe: 'מקורי', labelEn: 'Original' },
                    { id: '1:1', labelHe: '1:1 מרובע (Square)', labelEn: '1:1 Square' },
                    { id: '9:16', labelHe: '9:16 אנכי', labelEn: '9:16 Vertical' },
                    { id: '4:5', labelHe: '4:5 פורטרט', labelEn: '4:5 Portrait' },
                    { id: '16:9', labelHe: '16:9 רוחבי', labelEn: '16:9 Wide' },
                  ] as Array<{ id: CropAspectRatio; labelHe: string; labelEn: string }>
                ).map((opt) => {
                  const isSelected = adjustments.cropAspect === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() =>
                        setAdjustments((prev) => ({
                          ...prev,
                          cropAspect: opt.id,
                          cropOffsetX: opt.id === 'original' ? 0 : prev.cropOffsetX,
                          cropOffsetY: opt.id === 'original' ? 0 : prev.cropOffsetY,
                        }))
                      }
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 whitespace-nowrap ${
                        isSelected
                          ? 'bg-sky-500 text-white shadow-sm'
                          : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-sky-500/60'
                      }`}
                    >
                      {opt.id === '1:1' && <Square className="w-3 h-3" />}
                      <span>{isHe ? opt.labelHe : opt.labelEn}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Video Viewport with Live Cropping Frame & Live Subtitle Overlay */}
            <div className="relative bg-slate-950 h-[360px] sm:h-[420px] flex items-center justify-center overflow-hidden select-none p-2">
              <div
                onMouseDown={(e) => {
                  if (adjustments.cropAspect === 'original') return;
                  setIsDraggingCrop(true);
                  dragStartRef.current = {
                    x: e.clientX,
                    y: e.clientY,
                    startOffsetX: adjustments.cropOffsetX,
                    startOffsetY: adjustments.cropOffsetY,
                  };
                }}
                onMouseMove={(e) => {
                  if (!isDraggingCrop || !dragStartRef.current) return;
                  const dx = e.clientX - dragStartRef.current.x;
                  const dy = e.clientY - dragStartRef.current.y;
                  const nextX = Math.max(
                    -50,
                    Math.min(50, Math.round(dragStartRef.current.startOffsetX - dx * 0.25))
                  );
                  const nextY = Math.max(
                    -50,
                    Math.min(50, Math.round(dragStartRef.current.startOffsetY - dy * 0.25))
                  );
                  setAdjustments((prev) => ({
                    ...prev,
                    cropOffsetX: nextX,
                    cropOffsetY: nextY,
                  }));
                }}
                onMouseUp={() => {
                  setIsDraggingCrop(false);
                  dragStartRef.current = null;
                }}
                onMouseLeave={() => {
                  setIsDraggingCrop(false);
                  dragStartRef.current = null;
                }}
                style={
                  adjustments.cropAspect === '1:1'
                    ? { aspectRatio: '1 / 1', height: '100%' }
                    : adjustments.cropAspect === '9:16'
                    ? { aspectRatio: '9 / 16', height: '100%' }
                    : adjustments.cropAspect === '4:5'
                    ? { aspectRatio: '4 / 5', height: '100%' }
                    : adjustments.cropAspect === '16:9'
                    ? { aspectRatio: '16 / 9', width: '100%', maxHeight: '100%' }
                    : { width: '100%', height: '100%' }
                }
                className={`relative bg-black overflow-hidden flex items-center justify-center transition-all ${
                  adjustments.cropAspect !== 'original'
                    ? 'ring-2 ring-sky-400/90 shadow-2xl rounded-lg cursor-grab active:cursor-grabbing'
                    : 'w-full h-full'
                }`}
              >
                <video
                  ref={videoRef}
                  src={videoSrc}
                  poster={currentVideo?.thumbnail}
                  preload="metadata"
                  playsInline
                  onLoadedMetadata={(e) => {
                    const vidDur = e.currentTarget.duration;
                    if (vidDur && isFinite(vidDur) && vidDur > 0) {
                      const fullDur = Math.ceil(vidDur);
                      setDuration((prev) => Math.max(prev, fullDur));
                      setAdjustments((prev) => ({
                        ...prev,
                        trimEnd:
                          prev.trimEnd === 60 ||
                          Math.abs(prev.trimEnd - (currentVideo?.durationSeconds || 60)) <= 2
                            ? fullDur
                            : prev.trimEnd,
                      }));
                    }
                  }}
                  onTimeUpdate={(e) => {
                    const t = e.currentTarget.currentTime;
                    setCurrentTime(t);
                    if (
                      adjustments.trimEnd > adjustments.trimStart &&
                      adjustments.trimEnd < duration - 0.5 &&
                      t >= adjustments.trimEnd
                    ) {
                      e.currentTarget.pause();
                      setIsPlaying(false);
                    }
                  }}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => setIsPlaying(false)}
                  style={{
                    filter: `brightness(${1 + adjustments.brightness}) contrast(${adjustments.contrast}) saturate(${adjustments.saturation})`,
                    objectPosition:
                      adjustments.cropAspect !== 'original'
                        ? `${50 + adjustments.cropOffsetX}% ${50 + adjustments.cropOffsetY}%`
                        : '50% 50%',
                  }}
                  className={`w-full h-full ${
                    adjustments.cropAspect !== 'original' ? 'object-cover' : 'object-contain'
                  }`}
                />

                {/* Rule-of-thirds Crop Grid Overlay when Cropping is Active */}
                {adjustments.cropAspect !== 'original' && (
                  <div className="absolute inset-0 pointer-events-none">
                    <div className="w-full h-full grid grid-cols-3 grid-rows-3">
                      <div className="border-e border-b border-white/20" />
                      <div className="border-e border-b border-white/20" />
                      <div className="border-b border-white/20" />
                      <div className="border-e border-b border-white/20" />
                      <div className="border-e border-b border-white/20" />
                      <div className="border-b border-white/20" />
                      <div className="border-e border-white/20" />
                      <div className="border-e border-white/20" />
                      <div />
                    </div>
                    <div className="absolute top-2.5 start-2.5 px-2 py-0.5 rounded bg-black/70 text-sky-300 text-[11px] font-mono font-semibold backdrop-blur-sm">
                      Crop {adjustments.cropAspect} · {isHe ? 'גרור להזזת מיקוד' : 'Drag to pan'}
                    </div>
                  </div>
                )}

                {/* Live Synchronized Hebrew Subtitle Overlay (rendered inside the cropped frame!) */}
                {activeCue && (
                  <div
                    className={`absolute inset-x-3 pointer-events-none flex flex-col items-center text-center transition-all ${
                      styleConfig.position === 'top'
                        ? 'top-5'
                        : styleConfig.position === 'middle'
                        ? 'top-1/2 -translate-y-1/2'
                        : 'bottom-6'
                    }`}
                  >
                    <div
                      dir={styleConfig.displayMode === 'original' && !styleConfig.rtl ? 'ltr' : 'rtl'}
                      style={{
                        fontSize: `${Math.max(14, Math.round(styleConfig.fontSize * 0.75))}px`,
                        color: styleConfig.primaryColor,
                        fontWeight: styleConfig.bold ? 700 : 500,
                        backgroundColor:
                          styleConfig.bgOpacity > 0.05
                            ? `rgba(2, 6, 23, ${styleConfig.bgOpacity})`
                            : 'transparent',
                        textShadow:
                          styleConfig.bgOpacity <= 0.05
                            ? `0 2px 6px ${styleConfig.outlineColor}, -1.5px -1.5px 0 ${styleConfig.outlineColor}, 1.5px -1.5px 0 ${styleConfig.outlineColor}, -1.5px 1.5px 0 ${styleConfig.outlineColor}, 1.5px 1.5px 0 ${styleConfig.outlineColor}`
                            : 'none',
                      }}
                      className="px-3.5 py-1.5 rounded-lg max-w-[92%] leading-snug tracking-tight"
                    >
                      {styleConfig.displayMode === 'original' ? (
                        <span>{activeCue.originalText || activeCue.hebrewText}</span>
                      ) : styleConfig.displayMode === 'bilingual' ? (
                        <div className="space-y-0.5">
                          <div>{activeCue.hebrewText || activeCue.originalText}</div>
                          {activeCue.originalText &&
                            activeCue.originalText !== activeCue.hebrewText && (
                              <div
                                dir="ltr"
                                className="text-xs text-slate-200/90 font-normal"
                              >
                                {activeCue.originalText}
                              </div>
                            )}
                        </div>
                      ) : (
                        <span>{activeCue.hebrewText || activeCue.originalText}</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Playback Controls & Quick Timeline Actions */}
            <div className="p-4 space-y-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/60">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={togglePlayback}
                    className="p-2.5 rounded-xl bg-sky-500 hover:bg-sky-600 text-white transition-colors cursor-pointer"
                    title={isPlaying ? 'Pause' : 'Play'}
                  >
                    {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-white" />}
                  </button>

                  <button
                    onClick={() => seekTo(currentTime - 2)}
                    className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    title="-2s"
                  >
                    <SkipBack className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => seekTo(currentTime + 2)}
                    className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    title="+2s"
                  >
                    <SkipForward className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => {
                      if (!videoRef.current) return;
                      videoRef.current.muted = !videoRef.current.muted;
                      setIsMuted(videoRef.current.muted);
                    }}
                    className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    {isMuted ? <VolumeX className="w-4 h-4 text-red-500" /> : <Volume2 className="w-4 h-4" />}
                  </button>

                  <span className="text-xs font-mono-numbers text-slate-700 dark:text-slate-300 ps-2">
                    {formatTimecode(currentTime)} / {formatTimecode(duration)}
                  </span>
                </div>

                {/* Quick Subtitle Timeline Tools */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    onClick={handleAddCueAtPlayhead}
                    className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:border-sky-500 transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5 text-sky-500" />
                    <span>{isHe ? 'הוסף כתובית כאן' : 'Add Cue Here'}</span>
                  </button>

                  <button
                    onClick={handleSplitActiveCue}
                    disabled={!activeCue}
                    className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 disabled:opacity-40 hover:border-sky-500 transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <Scissors className="w-3.5 h-3.5 text-amber-500" />
                    <span>{isHe ? 'פצל כתובית' : 'Split Cue'}</span>
                  </button>

                  <button
                    onClick={() => handleShiftAllTimestamps(-0.3)}
                    disabled={cues.length === 0}
                    className="px-2 py-1.5 text-xs font-mono-numbers rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    title={isHe ? 'הקדם כתוביות ב-0.3 שניות' : 'Shift -0.3s'}
                  >
                    -0.3s
                  </button>

                  <button
                    onClick={() => handleShiftAllTimestamps(0.3)}
                    disabled={cues.length === 0}
                    className="px-2 py-1.5 text-xs font-mono-numbers rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 disabled:opacity-40 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    title={isHe ? 'אחר כתוביות ב-0.3 שניות' : 'Shift +0.3s'}
                  >
                    +0.3s
                  </button>
                </div>
              </div>

              {/* Interactive Timeline Scrubber + Subtitle Track Visualization */}
              <div className="space-y-1.5 pt-1">
                <input
                  type="range"
                  min={0}
                  max={Math.max(1, duration)}
                  step={0.1}
                  value={currentTime}
                  onChange={(e) => seekTo(Number(e.target.value))}
                  className="w-full accent-sky-500 cursor-pointer h-1.5"
                />

                {/* Visual Subtitle Track Bar */}
                <div
                  className="relative h-8 w-full rounded-lg bg-slate-200/70 dark:bg-slate-900 border border-slate-300/60 dark:border-slate-800 overflow-hidden cursor-pointer"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const clickX = e.clientX - rect.left;
                    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
                    // Respect RTL direction if document is RTL
                    const effectiveRatio = isHe ? 1 - ratio : ratio;
                    seekTo(effectiveRatio * duration);
                  }}
                >
                  {cues.map((cue) => {
                    const startPct = Math.min(100, Math.max(0, (cue.start / Math.max(1, duration)) * 100));
                    const widthPct = Math.max(
                      1.2,
                      Math.min(100 - startPct, ((cue.end - cue.start) / Math.max(1, duration)) * 100)
                    );
                    const isActive = activeCue?.id === cue.id;
                    return (
                      <div
                        key={cue.id}
                        style={
                          isHe
                            ? { right: `${startPct}%`, width: `${widthPct}%` }
                            : { left: `${startPct}%`, width: `${widthPct}%` }
                        }
                        title={`${formatTimecode(cue.start)} - ${formatTimecode(cue.end)}: ${
                          cue.hebrewText || cue.originalText
                        }`}
                        className={`absolute top-1 bottom-1 rounded px-1 flex items-center overflow-hidden text-[10px] font-medium transition-colors ${
                          isActive
                            ? 'bg-sky-500 text-white z-10'
                            : 'bg-sky-500/25 dark:bg-sky-400/25 text-sky-900 dark:text-sky-200 border border-sky-500/40'
                        }`}
                      >
                        <span className="truncate">{cue.hebrewText || cue.originalText}</span>
                      </div>
                    );
                  })}

                  {/* Playhead vertical line */}
                  <div
                    style={
                      isHe
                        ? { right: `${Math.min(100, (currentTime / Math.max(1, duration)) * 100)}%` }
                        : { left: `${Math.min(100, (currentTime / Math.max(1, duration)) * 100)}%` }
                    }
                    className="absolute top-0 bottom-0 w-0.5 bg-amber-500 pointer-events-none z-20"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Subtitle File Export Strip (.SRT / .VTT) */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 flex flex-wrap items-center justify-between gap-3 shadow-sm">
            <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
              <FileText className="w-4 h-4 text-sky-500 shrink-0" />
              <span>
                {isHe
                  ? 'ייצוא קובץ כתוביות נפרד (UTF-8 בעברית) לתוכנות עריכה ונגנים:'
                  : 'Export standalone Hebrew subtitle file (UTF-8):'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleExportSubtitlesFile('srt')}
                disabled={cues.length === 0}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-800 dark:text-slate-200 transition-colors cursor-pointer"
              >
                {isHe ? 'הורד קובץ .SRT בעברית' : 'Download Hebrew .SRT'}
              </button>
              <button
                onClick={() => handleExportSubtitlesFile('vtt')}
                disabled={cues.length === 0}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-800 dark:text-slate-200 transition-colors cursor-pointer"
              >
                {isHe ? 'הורד קובץ .VTT' : 'Download .VTT'}
              </button>
            </div>
          </div>
        </div>

        {/* Right Column (5 cols): 3-Tab Studio Inspector (Cartesia Subtitles | Styling | Adjustments) */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col">
          {/* Segmented Inspector Tabs */}
          <div className="grid grid-cols-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-1.5 gap-1">
            <button
              onClick={() => setInspectorTab('subtitles')}
              className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
                inspectorTab === 'subtitles'
                  ? 'bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Subtitles className="w-3.5 h-3.5" />
              <span>{isHe ? 'כתוביות ותמלול' : 'Subtitles & STT'}</span>
            </button>

            <button
              onClick={() => setInspectorTab('style')}
              className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
                inspectorTab === 'style'
                  ? 'bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Palette className="w-3.5 h-3.5" />
              <span>{isHe ? 'עיצוב כתוביות' : 'Caption Style'}</span>
            </button>

            <button
              onClick={() => setInspectorTab('adjust')}
              className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
                inspectorTab === 'adjust'
                  ? 'bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>{isHe ? 'חיתוך וצבע' : 'Trim & Color'}</span>
            </button>
          </div>

          {/* TAB 1: Cartesia STT & Hebrew Subtitle Editor */}
          {inspectorTab === 'subtitles' && (
            <div className="p-4 space-y-4 flex-1 flex flex-col">
              {/* Cartesia Transcription Controls */}
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    {isHe ? 'מנוע תמלול Cartesia (ink-whisper)' : 'Cartesia Speech-to-Text (ink-whisper)'}
                  </span>
                  <select
                    value={languageHint}
                    onChange={(e) => setLanguageHint(e.target.value as 'auto' | 'he' | 'en' | 'es')}
                    className="px-2.5 py-1 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-300"
                  >
                    <option value="auto">{isHe ? 'זיהוי שפה אוטומטי' : 'Auto-detect language'}</option>
                    <option value="he">{isHe ? 'שמע בעברית (he)' : 'Hebrew Audio (he)'}</option>
                    <option value="en">{isHe ? 'שמע באנגלית -> תרגום לעברית' : 'English Audio -> Hebrew'}</option>
                    <option value="es">{isHe ? 'שמע בספרדית -> תרגום לעברית' : 'Spanish Audio -> Hebrew'}</option>
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    onClick={handleCartesiaTranscribe}
                    disabled={isTranscribing}
                    className="py-2.5 px-3 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white font-semibold text-xs rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Wand2 className="w-3.5 h-3.5" />
                    <span>
                      {isTranscribing
                        ? isHe
                          ? 'מתמלל שמע...'
                          : 'Transcribing...'
                        : isHe
                        ? 'תמלל סרטון ב-Cartesia'
                        : 'Transcribe via Cartesia'}
                    </span>
                  </button>

                  <button
                    onClick={handleTranslateAllToHebrew}
                    disabled={isTranslating || cues.length === 0}
                    className="py-2.5 px-3 bg-slate-200/80 dark:bg-slate-800 hover:bg-slate-300/70 dark:hover:bg-slate-700 disabled:opacity-40 text-slate-800 dark:text-slate-200 font-semibold text-xs rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Languages className="w-3.5 h-3.5 text-sky-500" />
                    <span>
                      {isTranslating
                        ? isHe
                          ? 'מתרגם לעברית...'
                          : 'Translating...'
                        : isHe
                        ? 'תרגם / לטש הכל לעברית'
                        : 'Translate All to Hebrew'}
                    </span>
                  </button>
                </div>
              </div>

              {/* Search Filter + Add Cue Button */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={isHe ? 'חפש מילה בכתוביות...' : 'Search subtitles...'}
                    className="w-full ps-8 pe-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200"
                  />
                </div>
                <button
                  onClick={handleAddCueAtPlayhead}
                  className="px-3 py-1.5 text-xs font-semibold bg-sky-50 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-800/60 rounded-lg hover:bg-sky-100 transition-colors flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{isHe ? 'שורה חדשה' : 'New Line'}</span>
                </button>
              </div>

              {/* Cues Scrollable List */}
              <div className="space-y-2.5 max-h-[470px] overflow-y-auto pe-1">
                {filteredCues.length === 0 ? (
                  <div className="py-12 px-4 text-center space-y-2 text-xs text-slate-500 dark:text-slate-400">
                    <Subtitles className="w-6 h-6 mx-auto text-slate-400" />
                    <p className="font-semibold text-slate-700 dark:text-slate-300">
                      {isHe ? 'אין עדיין כתוביות בסרטון זה' : 'No subtitles yet'}
                    </p>
                    <p>
                      {isHe
                        ? 'לחץ על "תמלל סרטון ב-Cartesia" למעלה לחילוץ אוטומטי של הדיבור והמרתו לכתוביות בעברית, או הוסף שורות ידנית.'
                        : 'Click "Transcribe via Cartesia" above to automatically transcribe audio into Hebrew subtitles.'}
                    </p>
                  </div>
                ) : (
                  filteredCues.map((cue, idx) => {
                    const isCueActive = activeCue?.id === cue.id;
                    return (
                      <div
                        key={cue.id}
                        className={`p-3 rounded-xl border transition-all space-y-2 ${
                          isCueActive
                            ? 'border-sky-500 bg-sky-50/40 dark:bg-sky-950/30'
                            : 'border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/40'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-1.5 font-mono-numbers">
                            <button
                              onClick={() => seekTo(cue.start)}
                              className="px-1.5 py-0.5 rounded bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-sky-500 hover:text-white transition-colors cursor-pointer"
                              title={isHe ? 'קפוץ לזמן זה בנגן' : 'Jump to time'}
                            >
                              #{String(idx + 1).padStart(2, '0')}
                            </button>
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              value={cue.start}
                              onChange={(e) =>
                                handleUpdateCueField(cue.id, 'start', Number(e.target.value))
                              }
                              className="w-16 px-1.5 py-0.5 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded text-slate-800 dark:text-slate-200"
                            />
                            <span className="text-slate-400">→</span>
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              value={cue.end}
                              onChange={(e) =>
                                handleUpdateCueField(cue.id, 'end', Number(e.target.value))
                              }
                              className="w-16 px-1.5 py-0.5 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded text-slate-800 dark:text-slate-200"
                            />
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleSpeakCue(cue)}
                              disabled={speakingCueId === cue.id}
                              title={isHe ? 'השמע קריינות (Cartesia TTS)' : 'Speak cue (Cartesia TTS)'}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-sky-500 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                            >
                              <Volume1 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteCue(cue.id)}
                              title={isHe ? 'מחק כתובית' : 'Delete cue'}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Editable Hebrew Subtitle Line */}
                        <div>
                          <label className="block text-[10px] font-semibold text-sky-600 dark:text-sky-400 mb-0.5">
                            {isHe ? 'כתובית בעברית (תוצג ותיצרב בסרטון):' : 'Hebrew Subtitle (RTL):'}
                          </label>
                          <input
                            type="text"
                            dir="rtl"
                            value={cue.hebrewText}
                            onChange={(e) =>
                              handleUpdateCueField(cue.id, 'hebrewText', e.target.value)
                            }
                            placeholder={isHe ? 'הקלד כתובית בעברית...' : 'Enter Hebrew subtitle...'}
                            className="w-full px-2.5 py-1.5 text-xs font-medium bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-sky-500"
                          />
                        </div>

                        {/* Original Cartesia Transcript Line */}
                        <div>
                          <label className="block text-[10px] text-slate-400 mb-0.5">
                            {isHe ? 'תמלול מקור (Cartesia):' : 'Original Transcript:'}
                          </label>
                          <input
                            type="text"
                            value={cue.originalText}
                            onChange={(e) =>
                              handleUpdateCueField(cue.id, 'originalText', e.target.value)
                            }
                            placeholder={isHe ? 'טקסט בשפת המקור...' : 'Original transcript...'}
                            className="w-full px-2.5 py-1 text-[11px] bg-slate-100/70 dark:bg-slate-950 border border-slate-200/70 dark:border-slate-800/80 rounded-lg text-slate-600 dark:text-slate-400"
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* TAB 2: Subtitle Styling & Presets */}
          {inspectorTab === 'style' && (
            <div className="p-4 space-y-5">
              {/* Presets Grid */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                  {isHe ? 'ערכות עיצוב מוכנות לכתוביות' : 'Subtitle Style Presets'}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {STYLE_PRESETS.map((p) => {
                    const active = styleConfig.preset === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() =>
                          setStyleConfig((prev) => ({
                            ...prev,
                            ...p.config,
                            preset: p.id,
                          }))
                        }
                        className={`p-2.5 rounded-xl border text-start text-xs font-semibold transition-all cursor-pointer ${
                          active
                            ? 'border-sky-500 bg-sky-50/50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400'
                            : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-slate-300'
                        }`}
                      >
                        {isHe ? p.labelHe : p.labelEn}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Display Mode: Hebrew Only | Bilingual | Original */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                  {isHe ? 'שפת תצוגת כתוביות על המסך' : 'Subtitle Display Mode'}
                </label>
                <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800">
                  {(
                    [
                      { id: 'hebrew', label: isHe ? 'עברית בלבד' : 'Hebrew Only' },
                      { id: 'bilingual', label: isHe ? 'דו-לשוני' : 'Bilingual' },
                      { id: 'original', label: isHe ? 'מקור בלבד' : 'Original' },
                    ] as const
                  ).map((mode) => (
                    <button
                      key={mode.id}
                      onClick={() => setStyleConfig({ ...styleConfig, displayMode: mode.id })}
                      className={`py-1.5 px-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                        styleConfig.displayMode === mode.id
                          ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Vertical Position */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                  {isHe ? 'מיקום אנכי של הכתוביות' : 'Vertical Alignment'}
                </label>
                <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800">
                  {(
                    [
                      { id: 'bottom', label: isHe ? 'למטה' : 'Bottom' },
                      { id: 'middle', label: isHe ? 'מרכז' : 'Middle' },
                      { id: 'top', label: isHe ? 'למעלה' : 'Top' },
                    ] as const
                  ).map((pos) => (
                    <button
                      key={pos.id}
                      onClick={() => setStyleConfig({ ...styleConfig, position: pos.id })}
                      className={`py-1.5 px-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                        styleConfig.position === pos.id
                          ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {pos.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Font Size & Background Opacity Sliders */}
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-xs mb-1 font-mono-numbers">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      {isHe ? 'גודל גופן' : 'Font Size'}
                    </span>
                    <span>{styleConfig.fontSize}px</span>
                  </div>
                  <input
                    type="range"
                    min={18}
                    max={44}
                    value={styleConfig.fontSize}
                    onChange={(e) =>
                      setStyleConfig({ ...styleConfig, fontSize: Number(e.target.value) })
                    }
                    className="w-full accent-sky-500"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1 font-mono-numbers">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      {isHe ? 'אטימות רקע מאחורי הטקסט' : 'Background Box Opacity'}
                    </span>
                    <span>{Math.round(styleConfig.bgOpacity * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={0.9}
                    step={0.05}
                    value={styleConfig.bgOpacity}
                    onChange={(e) =>
                      setStyleConfig({ ...styleConfig, bgOpacity: Number(e.target.value) })
                    }
                    className="w-full accent-sky-500"
                  />
                </div>
              </div>

              {/* Colors */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {isHe ? 'צבע טקסט ראשי' : 'Primary Text Color'}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={styleConfig.primaryColor}
                      onChange={(e) =>
                        setStyleConfig({ ...styleConfig, primaryColor: e.target.value })
                      }
                      className="w-9 h-9 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer"
                    />
                    <span className="text-xs font-mono text-slate-500">
                      {styleConfig.primaryColor}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {isHe ? 'צבע קו מתאר (Stroke)' : 'Outline Color'}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={styleConfig.outlineColor}
                      onChange={(e) =>
                        setStyleConfig({ ...styleConfig, outlineColor: e.target.value })
                      }
                      className="w-9 h-9 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer"
                    />
                    <span className="text-xs font-mono text-slate-500">
                      {styleConfig.outlineColor}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Video Cropping (1:1 Square), Trim, Color Grading & Burn-in Export */}
          {inspectorTab === 'adjust' && (
            <div className="p-4 space-y-5">
              {/* Cropping & 1:1 Square Export Controls */}
              <div className="space-y-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <Crop className="w-3.5 h-3.5 text-sky-500" />
                    <span>{isHe ? 'חיתוך יחס מסך (Cropping 1:1)' : 'Video Aspect Ratio Cropping'}</span>
                  </span>
                  {adjustments.cropAspect !== 'original' && (
                    <button
                      onClick={() =>
                        setAdjustments({
                          ...adjustments,
                          cropOffsetX: 0,
                          cropOffsetY: 0,
                        })
                      }
                      className="text-[11px] text-slate-500 hover:text-sky-500 flex items-center gap-1 cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>{isHe ? 'מרכז מסגרת' : 'Center Frame'}</span>
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                  {(
                    [
                      { id: 'original', labelHe: 'מקורי', labelEn: 'Original' },
                      { id: '1:1', labelHe: '1:1 מרובע', labelEn: '1:1 Square' },
                      { id: '9:16', labelHe: '9:16 רילס', labelEn: '9:16 Reels' },
                      { id: '4:5', labelHe: '4:5 פורטרט', labelEn: '4:5 Post' },
                      { id: '16:9', labelHe: '16:9 רחב', labelEn: '16:9 Wide' },
                    ] as Array<{ id: CropAspectRatio; labelHe: string; labelEn: string }>
                  ).map((item) => {
                    const active = adjustments.cropAspect === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() =>
                          setAdjustments({
                            ...adjustments,
                            cropAspect: item.id,
                            cropOffsetX: item.id === 'original' ? 0 : adjustments.cropOffsetX,
                            cropOffsetY: item.id === 'original' ? 0 : adjustments.cropOffsetY,
                          })
                        }
                        className={`py-2 px-2 rounded-lg text-xs font-semibold border transition-all cursor-pointer text-center ${
                          active
                            ? 'border-sky-500 bg-sky-500 text-white shadow-sm'
                            : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-sky-400'
                        }`}
                      >
                        {isHe ? item.labelHe : item.labelEn}
                      </button>
                    );
                  })}
                </div>

                {adjustments.cropAspect !== 'original' && (
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <div className="flex justify-between text-[11px] text-slate-500 font-mono-numbers mb-1">
                        <span>{isHe ? 'מיקוד אופקי (X)' : 'Horizontal Pan (X)'}</span>
                        <span>{adjustments.cropOffsetX}%</span>
                      </div>
                      <input
                        type="range"
                        min={-50}
                        max={50}
                        step={1}
                        value={adjustments.cropOffsetX}
                        onChange={(e) =>
                          setAdjustments({
                            ...adjustments,
                            cropOffsetX: Number(e.target.value),
                          })
                        }
                        className="w-full accent-sky-500"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-[11px] text-slate-500 font-mono-numbers mb-1">
                        <span>{isHe ? 'מיקוד אנכי (Y)' : 'Vertical Pan (Y)'}</span>
                        <span>{adjustments.cropOffsetY}%</span>
                      </div>
                      <input
                        type="range"
                        min={-50}
                        max={50}
                        step={1}
                        value={adjustments.cropOffsetY}
                        onChange={(e) =>
                          setAdjustments({
                            ...adjustments,
                            cropOffsetY: Number(e.target.value),
                          })
                        }
                        className="w-full accent-sky-500"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Trim Video Range */}
              <div className="space-y-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-sky-500" />
                    <span>{isHe ? 'חיתוך התחלה וסיום (Trim)' : 'Trim Video Start & End'}</span>
                  </span>
                  <span className="text-xs font-mono-numbers text-slate-500">
                    {formatTimecode(adjustments.trimStart)} → {formatTimecode(adjustments.trimEnd)}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1 font-mono-numbers">
                      {isHe ? 'התחלה (שניות)' : 'Start (s)'}: {adjustments.trimStart}s
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(1, adjustments.trimEnd - 1)}
                      value={adjustments.trimStart}
                      onChange={(e) =>
                        setAdjustments({
                          ...adjustments,
                          trimStart: Number(e.target.value),
                        })
                      }
                      className="w-full accent-sky-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1 font-mono-numbers">
                      {isHe ? 'סיום (שניות)' : 'End (s)'}: {adjustments.trimEnd}s
                    </label>
                    <input
                      type="range"
                      min={Math.min(duration, adjustments.trimStart + 1)}
                      max={Math.max(1, duration)}
                      value={adjustments.trimEnd}
                      onChange={(e) =>
                        setAdjustments({
                          ...adjustments,
                          trimEnd: Number(e.target.value),
                        })
                      }
                      className="w-full accent-sky-500"
                    />
                  </div>
                </div>
              </div>

              {/* Color Grading Sliders */}
              <div className="space-y-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    {isHe ? 'תיקון צבע ותאורה (FFmpeg)' : 'Color & Lighting Grading'}
                  </span>
                  <button
                    onClick={() =>
                      setAdjustments({
                        ...adjustments,
                        brightness: 0,
                        contrast: 1,
                        saturation: 1,
                      })
                    }
                    className="text-[11px] text-slate-500 hover:text-sky-500 flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>{isHe ? 'אפס' : 'Reset'}</span>
                  </button>
                </div>

                <div>
                  <div className="flex justify-between text-[11px] text-slate-500 font-mono-numbers">
                    <span>{isHe ? 'בהירות (Brightness)' : 'Brightness'}</span>
                    <span>{Math.round(adjustments.brightness * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={-0.25}
                    max={0.25}
                    step={0.02}
                    value={adjustments.brightness}
                    onChange={(e) =>
                      setAdjustments({ ...adjustments, brightness: Number(e.target.value) })
                    }
                    className="w-full accent-sky-500"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-[11px] text-slate-500 font-mono-numbers">
                    <span>{isHe ? 'ניגודיות (Contrast)' : 'Contrast'}</span>
                    <span>{Math.round(adjustments.contrast * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0.75}
                    max={1.35}
                    step={0.05}
                    value={adjustments.contrast}
                    onChange={(e) =>
                      setAdjustments({ ...adjustments, contrast: Number(e.target.value) })
                    }
                    className="w-full accent-sky-500"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-[11px] text-slate-500 font-mono-numbers">
                    <span>{isHe ? 'רוויית צבע (Saturation)' : 'Saturation'}</span>
                    <span>{Math.round(adjustments.saturation * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1.8}
                    step={0.05}
                    value={adjustments.saturation}
                    onChange={(e) =>
                      setAdjustments({ ...adjustments, saturation: Number(e.target.value) })
                    }
                    className="w-full accent-sky-500"
                  />
                </div>
              </div>

              {/* Mute Audio Option */}
              <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={adjustments.muteOriginalAudio}
                  onChange={(e) =>
                    setAdjustments({ ...adjustments, muteOriginalAudio: e.target.checked })
                  }
                  className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                />
                <span>{isHe ? 'השתק את ערוץ השמע המקורי בייצוא' : 'Mute original audio on export'}</span>
              </label>

              {/* Final Render CTA */}
              <button
                onClick={handleBurnAndExportVideo}
                disabled={isRendering || !currentVideo}
                className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-sm rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>
                  {isHe
                    ? 'צרוב כתוביות בעברית וייצא סרטון (MP4)'
                    : 'Burn Hebrew Subtitles & Export MP4'}
                </span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

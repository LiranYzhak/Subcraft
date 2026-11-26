import JSZip from 'jszip';
import { PlatformType } from '../types/video';

export interface DownloadProgress {
  percent: number;
  speedMbPerSec: number;
  loadedMb: number;
  totalMb: number;
  etaSeconds: number;
}

export function getPlatformBadge(platform: PlatformType): {
  color: string;
  bgLight: string;
  bgDark: string;
  borderLight: string;
  borderDark: string;
} {
  switch (platform) {
    case 'youtube':
      return {
        color: '#FF0000',
        bgLight: 'bg-red-50 text-red-600',
        bgDark: 'dark:bg-red-950/40 dark:text-red-400',
        borderLight: 'border-red-200',
        borderDark: 'dark:border-red-800/50',
      };
    case 'tiktok':
      return {
        color: '#00F2FE',
        bgLight: 'bg-cyan-50 text-cyan-700',
        bgDark: 'dark:bg-cyan-950/40 dark:text-cyan-300',
        borderLight: 'border-cyan-200',
        borderDark: 'dark:border-cyan-800/50',
      };
    case 'instagram':
      return {
        color: '#E1306C',
        bgLight: 'bg-pink-50 text-pink-600',
        bgDark: 'dark:bg-pink-950/40 dark:text-pink-400',
        borderLight: 'border-pink-200',
        borderDark: 'dark:border-pink-800/50',
      };
    case 'twitter':
      return {
        color: '#1D9BF0',
        bgLight: 'bg-sky-50 text-sky-600',
        bgDark: 'dark:bg-sky-950/40 dark:text-sky-400',
        borderLight: 'border-sky-200',
        borderDark: 'dark:border-sky-800/50',
      };
    case 'facebook':
      return {
        color: '#1877F2',
        bgLight: 'bg-blue-50 text-blue-600',
        bgDark: 'dark:bg-blue-950/40 dark:text-blue-400',
        borderLight: 'border-blue-200',
        borderDark: 'dark:border-blue-800/50',
      };
    case 'threads':
      return {
        color: '#000000',
        bgLight: 'bg-neutral-100 text-neutral-800',
        bgDark: 'dark:bg-neutral-800 dark:text-neutral-200',
        borderLight: 'border-neutral-300',
        borderDark: 'dark:border-neutral-700',
      };
    case 'reddit':
      return {
        color: '#FF4500',
        bgLight: 'bg-orange-50 text-orange-600',
        bgDark: 'dark:bg-orange-950/40 dark:text-orange-400',
        borderLight: 'border-orange-200',
        borderDark: 'dark:border-orange-800/50',
      };
    case 'vimeo':
      return {
        color: '#1AB7EA',
        bgLight: 'bg-cyan-50 text-cyan-600',
        bgDark: 'dark:bg-cyan-950/40 dark:text-cyan-400',
        borderLight: 'border-cyan-200',
        borderDark: 'dark:border-cyan-800/50',
      };
    default:
      return {
        color: '#6366F1',
        bgLight: 'bg-indigo-50 text-indigo-600',
        bgDark: 'dark:bg-indigo-950/40 dark:text-indigo-400',
        borderLight: 'border-indigo-200',
        borderDark: 'dark:border-indigo-800/50',
      };
  }
}

async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  maxRetries = 3
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(input, init);
      if (res.status >= 502 && res.status <= 504 && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 450 * attempt));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Failed to fetch');
}

export async function pollAndDownloadJob(params: {
  jobId: string;
  initialStatus?: 'preparing' | 'ready' | 'error';
  initialTotalBytes?: number;
  fallbackFilename: string;
  mimeType: string;
  estTotalMb?: number;
  deleteAfterDownload?: boolean;
  onProgress?: (p: DownloadProgress) => void;
}): Promise<{ blob: Blob; filename: string; jobId: string }> {
  const {
    jobId,
    initialStatus = 'preparing',
    initialTotalBytes = 0,
    fallbackFilename,
    estTotalMb = 5,
    deleteAfterDownload = false,
    onProgress,
  } = params;

  let totalBytes = initialTotalBytes;
  let filename = fallbackFilename;
  let mimeType = params.mimeType || 'video/mp4';

  // Step 2: Poll /api/download-status until status === 'ready'
  if (initialStatus !== 'ready' || !totalBytes) {
    const pollStart = Date.now();
    const maxWaitMs = 5 * 60 * 1000; // 5 minutes max

    while (Date.now() - pollStart < maxWaitMs) {
      await new Promise((r) => setTimeout(r, 450));

      const statusRes = await fetchWithRetry(
        `/api/download-status?jobId=${encodeURIComponent(jobId)}`
      );
      if (!statusRes.ok) {
        let errText = 'שגיאה בבדיקת סטטוס ההורדה';
        try {
          const errJson = await statusRes.json();
          if (errJson.error) errText = errJson.error;
        } catch {
          // ignore
        }
        throw new Error(errText);
      }

      const statusData: {
        success?: boolean;
        status?: 'preparing' | 'ready' | 'error';
        progress?: number;
        totalBytes?: number;
        filename?: string;
        mimeType?: string;
        error?: string;
      } = await statusRes.json();

      if (statusData.status === 'error' || !statusData.success) {
        throw new Error(statusData.error || 'שגיאה בעיבוד קובץ הווידאו בשרת');
      }

      if (statusData.filename) filename = statusData.filename;
      if (statusData.mimeType) mimeType = statusData.mimeType;

      const serverProgress = Math.max(8, Math.min(99, statusData.progress || 10));
      const uiPercent = Math.min(48, Math.max(6, Math.round((serverProgress / 100) * 48)));

      if (onProgress) {
        onProgress({
          percent: uiPercent,
          speedMbPerSec: 0,
          loadedMb: Number(((estTotalMb * uiPercent) / 100).toFixed(2)),
          totalMb: Number(estTotalMb.toFixed(2)),
          etaSeconds: Math.max(1, Math.round(((100 - serverProgress) / 100) * 6)),
        });
      }

      if (statusData.status === 'ready' && statusData.totalBytes && statusData.totalBytes > 0) {
        totalBytes = statusData.totalBytes;
        break;
      }
    }
  }

  if (!totalBytes || totalBytes <= 0) {
    throw new Error('הקובץ שהוכן בשרת ריק או שחרג מזמן ההמתנה');
  }

  // Step 3: Download prepared file in 4MB slices (well below Cloud Run's 32MiB response cap)
  const CHUNK_SIZE = 4 * 1024 * 1024;
  const chunks: BlobPart[] = [];
  let receivedBytes = 0;
  const transferStartTime = Date.now();

  for (let start = 0; start < totalBytes; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE - 1, totalBytes - 1);
    const isLast = end >= totalBytes - 1;

    const chunkUrl = `/api/download-chunk?jobId=${encodeURIComponent(jobId)}&start=${start}&end=${end}&done=${
      isLast && deleteAfterDownload ? '1' : '0'
    }`;

    const chunkRes = await fetchWithRetry(chunkUrl);
    if (!chunkRes.ok) {
      throw new Error(`שגיאה בהורדת מקטע קובץ (${chunkRes.status})`);
    }

    const arrayBuf = await chunkRes.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuf);
    chunks.push(uint8);
    receivedBytes += uint8.byteLength;

    if (onProgress) {
      const elapsedSec = Math.max(0.1, (Date.now() - transferStartTime) / 1000);
      const speedMbPerSec = receivedBytes / (1024 * 1024) / elapsedSec;
      const ratio = receivedBytes / totalBytes;
      const percent = Math.min(99, Math.round(48 + ratio * 51));
      const remainingBytes = Math.max(0, totalBytes - receivedBytes);
      const etaSeconds =
        speedMbPerSec > 0 ? Math.round(remainingBytes / (1024 * 1024) / speedMbPerSec) : 1;

      onProgress({
        percent,
        speedMbPerSec: Number(speedMbPerSec.toFixed(1)),
        loadedMb: Number((receivedBytes / (1024 * 1024)).toFixed(2)),
        totalMb: Number((totalBytes / (1024 * 1024)).toFixed(2)),
        etaSeconds,
      });
    }
  }

  if (onProgress) {
    onProgress({
      percent: 100,
      speedMbPerSec: 0,
      loadedMb: Number((receivedBytes / (1024 * 1024)).toFixed(2)),
      totalMb: Number((totalBytes / (1024 * 1024)).toFixed(2)),
      etaSeconds: 0,
    });
  }

  const blob = new Blob(chunks, { type: mimeType });

  if (blob.size < 100) {
    throw new Error('הקובץ שהתקבל ריק או לא תקין');
  }

  return { blob, filename, jobId };
}

export async function fetchRealVideoBlob(params: {
  url: string;
  directUrl?: string;
  formatId?: string;
  title: string;
  platform: PlatformType;
  qualityId: string;
  format: 'mp4' | 'webm' | 'mp3';
  fileSizeMb: number;
  trimStart?: number;
  trimEnd?: number;
  muteAudio?: boolean;
  onProgress?: (p: DownloadProgress) => void;
}): Promise<{ blob: Blob; filename: string; jobId: string }> {
  const {
    url,
    directUrl = '',
    formatId = '',
    title,
    platform,
    qualityId,
    format,
    fileSizeMb,
    trimStart = 0,
    trimEnd = 0,
    muteAudio = false,
    onProgress,
  } = params;

  const safeTitle = (title || 'video')
    .replace(/[^a-zA-Z0-9_\u0590-\u05FF-]/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 50);
  const ext = format;
  const fallbackFilename = `${platform}_${safeTitle}_${qualityId}.${ext}`;
  const estTotalMb = Math.max(0.5, fileSizeMb || 5);

  if (onProgress) {
    onProgress({
      percent: 5,
      speedMbPerSec: 0,
      loadedMb: 0,
      totalMb: Number(estTotalMb.toFixed(2)),
      etaSeconds: 5,
    });
  }

  // Step 1: Enqueue preparation job on server (returns immediately in <5ms)
  const prepRes = await fetchWithRetry('/api/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      directUrl,
      formatId,
      quality: qualityId,
      title,
      platform,
      format,
      trimStart,
      trimEnd,
      muteAudio,
      mode: 'prepare',
    }),
  });

  if (!prepRes.ok) {
    let errText = 'שגיאה בהורדת הקובץ מהשרת';
    try {
      const errJson = await prepRes.json();
      if (errJson.error) errText = errJson.error;
    } catch {
      // ignore json parse error
    }
    throw new Error(errText);
  }

  const prepResult: {
    success?: boolean;
    jobId?: string;
    status?: 'preparing' | 'ready' | 'error';
    totalBytes?: number;
    filename?: string;
    mimeType?: string;
    error?: string;
  } = await prepRes.json();

  if (!prepResult.success || !prepResult.jobId) {
    throw new Error(prepResult.error || 'שגיאה בהכנת קובץ הווידאו להורדה');
  }

  return pollAndDownloadJob({
    jobId: prepResult.jobId,
    initialStatus: prepResult.status,
    initialTotalBytes: prepResult.totalBytes || 0,
    fallbackFilename: prepResult.filename || fallbackFilename,
    mimeType:
      prepResult.mimeType ||
      (format === 'mp3' ? 'audio/mpeg' : format === 'webm' ? 'video/webm' : 'video/mp4'),
    estTotalMb,
    deleteAfterDownload: false, // Keep on server for Video Studio editing & Cartesia transcription!
    onProgress,
  });
}

export async function downloadVideoFile(params: {
  url: string;
  directUrl?: string;
  formatId?: string;
  title: string;
  platform: PlatformType;
  qualityId: string;
  format: 'mp4' | 'webm' | 'mp3';
  fileSizeMb: number;
  trimStart?: number;
  trimEnd?: number;
  muteAudio?: boolean;
  onProgress: (p: DownloadProgress) => void;
}): Promise<{ sizeMb: number; jobId: string; blob: Blob }> {
  const { blob, filename, jobId } = await fetchRealVideoBlob(params);
  saveBlobLocally(blob, filename);
  return {
    sizeMb: Number((blob.size / (1024 * 1024)).toFixed(2)),
    jobId,
    blob,
  };
}

export function saveBlobLocally(blob: Blob, filename: string): void {
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  }, 1500);
}

export async function packageBatchZip(
  items: Array<{
    url: string;
    directUrl?: string;
    formatId?: string;
    title: string;
    platform: PlatformType;
    qualityId: string;
    format: 'mp4' | 'webm' | 'mp3';
    fileSizeMb: number;
  }>,
  onProgress: (percent: number, currentItem: string) => void
): Promise<void> {
  const zip = new JSZip();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    onProgress(Math.round((i / items.length) * 100), item.title);

    const { blob, filename } = await fetchRealVideoBlob({
      url: item.url,
      directUrl: item.directUrl,
      formatId: item.formatId,
      title: item.title,
      platform: item.platform,
      qualityId: item.qualityId,
      format: item.format,
      fileSizeMb: item.fileSizeMb,
    });

    zip.file(filename, blob);
    onProgress(Math.round(((i + 1) / items.length) * 100), item.title);
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
    onProgress(Math.round(metadata.percent), 'אורז קובץ ZIP...');
  });

  saveBlobLocally(zipBlob, `SubCraft_Batch_${Date.now()}.zip`);
}

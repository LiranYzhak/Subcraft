import express, { type Request, type Response } from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import {
  transcribeMediaToHebrewSubtitles,
  translateCuesToHebrew,
  synthesizeSubtitleVoiceover,
  renderStudioVideoWithSubtitles,
} from './src/server/studioEngine.ts';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const YTDLP_PATH = path.join(os.tmpdir(), 'subcraft_bin', 'yt-dlp');
const MIN_STANDALONE_BINARY_SIZE = 15_000_000; // Standalone PyInstaller binary is ~39MB (zipapp is ~3MB)

interface VideoQualityOption {
  id: string;
  formatId?: string;
  directUrl?: string;
  audioUrl?: string;
  label: string;
  resolution: string;
  fps: number;
  format: 'mp4' | 'webm' | 'mp3';
  fileSizeMb: number;
  bitrate: string;
  hasAudio: boolean;
  needsMerge?: boolean;
  isPopular?: boolean;
}

interface VideoMetadata {
  id: string;
  url: string;
  platform: 'youtube' | 'tiktok' | 'instagram' | 'twitter' | 'facebook' | 'threads' | 'reddit' | 'vimeo' | 'other';
  platformName: string;
  title: string;
  author: string;
  authorHandle: string;
  authorAvatar?: string;
  thumbnail: string;
  durationSeconds: number;
  durationFormatted: string;
  viewsFormatted: string;
  likesFormatted: string;
  aspectRatio: '16:9' | '9:16' | '1:1';
  streamUrl: string;
  qualities: VideoQualityOption[];
}

interface ZeemoFormat {
  ext: string;
  width?: number;
  height?: number;
  fps?: number;
  vbr?: number;
  abr?: number;
  vcodec?: string;
  acodec?: string;
  containsVideo?: boolean;
  containsAudio?: boolean;
  url: string;
}

interface ZeemoVideoData {
  id: string;
  videoName: string;
  duration: number;
  videoWidth: number;
  videoHeight: number;
  thumbnailUrl: string;
  downloadUrl: string;
  audioDownloadUrl: string;
  formats: ZeemoFormat[];
  fetchedAt: number;
}

// Cache resolved direct download URLs from notube server pool for 20 minutes
const resolvedStreamCache = new Map<string, { downloadUrl: string; expiresAt: number }>();
// Cache non-IP-locked WEB_EMBEDDED_PLAYER streams from Zeemo for 45 minutes
const zeemoStreamCache = new Map<string, ZeemoVideoData>();

interface PreparedFileEntry {
  status: 'preparing' | 'ready' | 'error';
  progress: number;
  filePath: string;
  filename: string;
  mimeType: string;
  size: number;
  error?: string;
  createdAt: number;
}
const preparedFilesMap = new Map<string, PreparedFileEntry>();

async function ensureYtDlpBinary(): Promise<string> {
  if (fs.existsSync(YTDLP_PATH)) {
    try {
      const stat = fs.statSync(YTDLP_PATH);
      if (stat.size > MIN_STANDALONE_BINARY_SIZE) {
        fs.chmodSync(YTDLP_PATH, 0o755);
        return YTDLP_PATH;
      }
    } catch {
      // proceed to re-install standalone binary
    }
  }

  const binDir = path.dirname(YTDLP_PATH);
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  // Check if /tmp/yt-dlp_linux is already cached locally
  const tmpCached = '/tmp/yt-dlp_linux';
  if (fs.existsSync(tmpCached)) {
    try {
      const stat = fs.statSync(tmpCached);
      if (stat.size > MIN_STANDALONE_BINARY_SIZE) {
        fs.copyFileSync(tmpCached, YTDLP_PATH);
        fs.chmodSync(YTDLP_PATH, 0o755);
        return YTDLP_PATH;
      }
    } catch {
      // fall through to download
    }
  }

  console.log('Downloading standalone yt-dlp_linux binary...');
  const res = await fetch('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux');
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download yt-dlp binary: ${res.status}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  fs.writeFileSync(YTDLP_PATH, Buffer.from(arrayBuffer));
  fs.chmodSync(YTDLP_PATH, 0o755);
  console.log('yt-dlp_linux standalone binary ready.');
  return YTDLP_PATH;
}

function formatDuration(seconds: number): string {
  const totalSecs = Math.max(0, Math.round(seconds || 0));
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatCount(count?: number | null): string {
  if (count === undefined || count === null || isNaN(count)) return '—';
  if (count >= 1_000_000_000) return `${(count / 1_000_000_000).toFixed(1)}B`;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

function detectPlatform(urlStr: string): {
  platform: VideoMetadata['platform'];
  platformName: string;
} {
  const lower = urlStr.toLowerCase();
  if (lower.includes('youtube.com/shorts')) {
    return { platform: 'youtube', platformName: 'YouTube Shorts' };
  }
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) {
    return { platform: 'youtube', platformName: 'YouTube' };
  }
  if (lower.includes('tiktok.com')) {
    return { platform: 'tiktok', platformName: 'TikTok' };
  }
  if (lower.includes('instagram.com/reel') || lower.includes('instagr.am/reel')) {
    return { platform: 'instagram', platformName: 'Instagram Reels' };
  }
  if (lower.includes('instagram.com')) {
    return { platform: 'instagram', platformName: 'Instagram' };
  }
  if (lower.includes('twitter.com') || lower.includes('x.com')) {
    return { platform: 'twitter', platformName: 'X (Twitter)' };
  }
  if (lower.includes('facebook.com') || lower.includes('fb.watch') || lower.includes('fb.com')) {
    return { platform: 'facebook', platformName: 'Facebook Video' };
  }
  if (lower.includes('threads.net') || lower.includes('threads.com')) {
    return { platform: 'threads', platformName: 'Threads' };
  }
  if (lower.includes('reddit.com') || lower.includes('redd.it')) {
    return { platform: 'reddit', platformName: 'Reddit Video' };
  }
  if (lower.includes('vimeo.com')) {
    return { platform: 'vimeo', platformName: 'Vimeo' };
  }
  return { platform: 'other', platformName: 'Web Video' };
}

function extractYouTubeId(urlStr: string): string | null {
  const patterns = [
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /\/shorts\/([a-zA-Z0-9_-]{11})/,
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /\/embed\/([a-zA-Z0-9_-]{11})/,
    /\/live\/([a-zA-Z0-9_-]{11})/,
    /\/v\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = urlStr.match(p);
    if (m && m[1]) return m[1];
  }
  return null;
}

function normalizeYouTubeUrl(urlStr: string): string {
  const ytId = extractYouTubeId(urlStr);
  if (ytId) {
    return `https://www.youtube.com/watch?v=${ytId}`;
  }
  return urlStr.trim();
}

// Resolve a direct downloadable MP4 stream from the NoTube CDN server pool
async function resolveNotubeStreamUrl(
  rawUrl: string,
  targetHeight = 1080
): Promise<string> {
  const cleanUrl = normalizeYouTubeUrl(rawUrl);
  const ntFormat = targetHeight >= 720 ? 'mp4hd' : 'mp4';
  const cacheKey = `${cleanUrl}::${ntFormat}`;

  const cached = resolvedStreamCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.downloadUrl;
  }

  const serverPool = [63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 56, 57, 58, 59, 60, 61, 62];
  const candidates = [63, ...serverPool.filter((n) => n !== 63).sort(() => Math.random() - 0.5).slice(0, 3)];

  let lastError = 'Failed to resolve stream from CDN pool';

  for (const srv of candidates) {
    try {
      const baseHeaders = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Origin: 'https://notube.net',
        Referer: 'https://notube.net/',
      };

      // Step 1: recover_weight.php
      const r1 = await fetch(`https://s${srv}.notube.net/recover_weight.php`, {
        method: 'POST',
        headers: baseHeaders,
        body: new URLSearchParams({
          url: cleanUrl,
          format: ntFormat,
          lang: 'en',
          subscribed: 'false',
        }).toString(),
        signal: AbortSignal.timeout(15000),
      });

      if (!r1.ok) continue;
      const j1 = (await r1.json()) as any;
      if (!j1 || !j1.token) continue;

      // Step 2: recover_file.php
      const r2 = await fetch(`https://s${srv}.notube.net/recover_file.php`, {
        method: 'POST',
        headers: baseHeaders,
        body: new URLSearchParams({
          url: cleanUrl,
          format: ntFormat,
          name_mp4: j1.name_mp4 || 'video.mp4',
          lang: 'en',
          token: j1.token,
          subscribed: 'false',
          playlist: 'false',
          adblock: 'false',
        }).toString(),
        signal: AbortSignal.timeout(45000),
      });

      if (!r2.ok) continue;
      const t2 = await r2.text();
      let finalToken = String(j1.token);
      try {
        const parsed2 = JSON.parse(t2);
        if (parsed2.retour && parsed2.retour !== 'OK') {
          continue;
        }
        if (parsed2.token) finalToken = String(parsed2.token);
      } catch {
        if (t2.trim() !== 'OK') continue;
      }

      // Step 3: Fetch download page to get signed key URL
      const r3 = await fetch(`https://notube.net/en/download?token=${encodeURIComponent(finalToken)}`, {
        headers: {
          'User-Agent': baseHeaders['User-Agent'],
          Referer: 'https://notube.net/',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!r3.ok) continue;
      const html3 = await r3.text();
      const dlMatch =
        html3.match(/href="(https:\/\/[^"]*download\.php\?token=[^"]+)"/i) ||
        html3.match(/(https:\/\/s\d+\.notube\.net\/download\.php\?[^\s"'<>]+)/i);

      if (dlMatch && dlMatch[1]) {
        const downloadUrl = dlMatch[1];
        resolvedStreamCache.set(cacheKey, {
          downloadUrl,
          expiresAt: Date.now() + 20 * 60 * 1000,
        });
        return downloadUrl;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new Error(lastError);
}

// 1. Real TikTok Extraction via TikWM API
async function extractTikTokReal(url: string): Promise<VideoMetadata | null> {
  try {
    const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`;
    const res = await fetch(apiUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    if (json.code !== 0 || !json.data) return null;

    const d = json.data;
    const durationSeconds = Number(d.duration) || 15;
    const qualities: VideoQualityOption[] = [];

    if (d.hdplay) {
      const sizeMb = d.hd_size
        ? Number((d.hd_size / (1024 * 1024)).toFixed(1))
        : Number((durationSeconds * 0.45).toFixed(1));
      qualities.push({
        id: '1080p_hd',
        directUrl: d.hdplay,
        label: '1080p Full HD (ללא סימן מים)',
        resolution: '1080 × 1920',
        fps: 60,
        format: 'mp4',
        fileSizeMb: Math.max(0.5, sizeMb),
        bitrate: 'HD Original',
        hasAudio: true,
        isPopular: true,
      });
    }

    if (d.play) {
      const sizeMb = d.size
        ? Number((d.size / (1024 * 1024)).toFixed(1))
        : Number((durationSeconds * 0.25).toFixed(1));
      qualities.push({
        id: '720p_clean',
        directUrl: d.play,
        label: '720p HD (ללא סימן מים)',
        resolution: '720 × 1280',
        fps: 30,
        format: 'mp4',
        fileSizeMb: Math.max(0.3, sizeMb),
        bitrate: 'Standard HD',
        hasAudio: true,
        isPopular: qualities.length === 0,
      });
    }

    if (d.wmplay) {
      const sizeMb = d.wm_size
        ? Number((d.wm_size / (1024 * 1024)).toFixed(1))
        : Number((durationSeconds * 0.25).toFixed(1));
      qualities.push({
        id: 'watermark_mp4',
        directUrl: d.wmplay,
        label: 'MP4 (עם סימן מים מקורי)',
        resolution: '720 × 1280',
        fps: 30,
        format: 'mp4',
        fileSizeMb: Math.max(0.3, sizeMb),
        bitrate: 'Watermarked',
        hasAudio: true,
      });
    }

    const audioUrl = d.music || d.play || d.hdplay;
    if (audioUrl) {
      qualities.push({
        id: 'mp3_audio',
        directUrl: audioUrl,
        label: 'אודיו בלבד (MP3 Original)',
        resolution: 'Audio Stereo',
        fps: 0,
        format: 'mp3',
        fileSizeMb: Number(Math.max(0.4, (durationSeconds * 192) / (8 * 1024)).toFixed(1)),
        bitrate: '192 kbps',
        hasAudio: true,
      });
    }

    const rawCover = d.origin_cover || d.cover || '';
    const previewStream = d.play || d.hdplay || d.wmplay;

    return {
      id: String(d.id || Date.now()),
      url,
      platform: 'tiktok',
      platformName: 'TikTok',
      title: d.title || `TikTok Video by @${d.author?.unique_id || 'user'}`,
      author: d.author?.nickname || d.author?.unique_id || 'TikTok Creator',
      authorHandle: `@${d.author?.unique_id || 'tiktok'}`,
      authorAvatar: d.author?.avatar ? `/api/proxy-image?url=${encodeURIComponent(d.author.avatar)}` : undefined,
      thumbnail: rawCover ? `/api/proxy-image?url=${encodeURIComponent(rawCover)}` : '',
      durationSeconds,
      durationFormatted: formatDuration(durationSeconds),
      viewsFormatted: formatCount(d.play_count),
      likesFormatted: formatCount(d.digg_count),
      aspectRatio: '9:16',
      streamUrl: `/api/proxy-stream?url=${encodeURIComponent(previewStream)}`,
      qualities,
    };
  } catch (err) {
    console.warn('TikWM extraction error, falling back:', err);
    return null;
  }
}

// 2. Real X / Twitter Extraction via FxTwitter API
async function extractTwitterReal(url: string): Promise<VideoMetadata | null> {
  try {
    const match = url.match(/(?:twitter\.com|x\.com)\/(?:[^/]+)\/status\/(\d+)/i);
    if (!match) return null;
    const statusId = match[1];

    const apiUrl = `https://api.fxtwitter.com/i/status/${statusId}`;
    const res = await fetch(apiUrl, {
      headers: { 'User-Agent': 'OmniDropVideoExtractor/2.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    const tweet = json?.tweet;
    const videos = tweet?.media?.videos;
    if (!tweet || !Array.isArray(videos) || videos.length === 0) {
      return null;
    }

    const vid = videos[0];
    const durationSeconds = Math.max(1, Math.round(Number(vid.duration) || 15));
    const width = Number(vid.width) || 1280;
    const height = Number(vid.height) || 720;
    const aspectRatio: '16:9' | '9:16' | '1:1' =
      height > width ? '9:16' : width === height ? '1:1' : '16:9';

    const mp4Variants = (vid.variants || [])
      .filter((v: any) => v.content_type === 'video/mp4' && v.url)
      .sort((a: any, b: any) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0));

    if (mp4Variants.length === 0 && vid.url) {
      mp4Variants.push({ url: vid.url, bitrate: 2000000 });
    }

    const qualities: VideoQualityOption[] = mp4Variants.map((v: any, index: number) => {
      const bitrateBps = Number(v.bitrate) || 1500000;
      const kbps = Math.round(bitrateBps / 1000);
      const sizeMb = Number(Math.max(0.2, (bitrateBps * durationSeconds) / (8 * 1024 * 1024)).toFixed(1));

      const resMatch = String(v.url).match(/\/(\d{3,4})x(\d{3,4})\//);
      const vWidth = resMatch ? Number(resMatch[1]) : width;
      const vHeight = resMatch ? Number(resMatch[2]) : height;
      const shortSide = Math.min(vWidth, vHeight);

      let qualityTag = `${shortSide}p`;
      if (shortSide >= 1080) qualityTag = '1080p Full HD';
      else if (shortSide >= 720) qualityTag = '720p HD';
      else if (shortSide >= 480) qualityTag = '480p SD';
      else qualityTag = `${shortSide}p Compact`;

      return {
        id: `tw_${index}_${shortSide}p`,
        directUrl: v.url,
        label: qualityTag,
        resolution: `${vWidth} × ${vHeight}`,
        fps: 30,
        format: 'mp4',
        fileSizeMb: sizeMb,
        bitrate: `${kbps} kbps`,
        hasAudio: true,
        isPopular: index === 0,
      };
    });

    if (mp4Variants[0]?.url) {
      qualities.push({
        id: 'mp3_320',
        directUrl: mp4Variants[0].url,
        label: 'אודיו בלבד (MP3 320kbps)',
        resolution: 'Audio Stereo HQ',
        fps: 0,
        format: 'mp3',
        fileSizeMb: Number(Math.max(0.2, (durationSeconds * 320) / (8 * 1024)).toFixed(1)),
        bitrate: '320 kbps',
        hasAudio: true,
      });
    }

    const bestStreamUrl = mp4Variants[0]?.url || vid.url;
    const rawThumb = vid.thumbnail_url || tweet.author?.avatar_url || '';

    return {
      id: String(tweet.id || statusId),
      url,
      platform: 'twitter',
      platformName: 'X (Twitter)',
      title: (tweet.text || `X Video by @${tweet.author?.screen_name || 'user'}`).split('\n')[0].substring(0, 120),
      author: tweet.author?.name || 'X User',
      authorHandle: `@${tweet.author?.screen_name || 'x_user'}`,
      authorAvatar: tweet.author?.avatar_url ? `/api/proxy-image?url=${encodeURIComponent(tweet.author.avatar_url)}` : undefined,
      thumbnail: rawThumb ? `/api/proxy-image?url=${encodeURIComponent(rawThumb)}` : '',
      durationSeconds,
      durationFormatted: formatDuration(durationSeconds),
      viewsFormatted: formatCount(tweet.views),
      likesFormatted: formatCount(tweet.likes),
      aspectRatio,
      streamUrl: `/api/proxy-stream?url=${encodeURIComponent(bestStreamUrl)}`,
      qualities,
    };
  } catch (err) {
    console.warn('FxTwitter extraction error, falling back:', err);
    return null;
  }
}

// Fetch non-IP-locked WEB_EMBEDDED_PLAYER YouTube streams via signed Zeemo API
async function fetchZeemoVideoData(rawUrl: string): Promise<ZeemoVideoData | null> {
  const cleanUrl = normalizeYouTubeUrl(rawUrl);
  const cached = zeemoStreamCache.get(cleanUrl);
  if (cached && Date.now() - cached.fetchedAt < 45 * 60 * 1000) {
    return cached;
  }

  try {
    const md5 = (str: string) => crypto.createHash('md5').update(str).digest('hex');
    const timestamp = Date.now();
    const salt = 'qiluomite_XYZ_654321^&';
    const tempSecret = md5(md5(String(timestamp) + salt) + salt);

    const res = await fetch(
      'https://api.zeemo.ai/hy-caption-front/api/v1/video-download/yt-dlp-video-info',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Origin: 'https://zeemo.ai',
          Referer: 'https://zeemo.ai/',
        },
        body: JSON.stringify({
          url: cleanUrl,
          videoSource: 3,
          action: 1,
          timestamp,
          tempSecret,
        }),
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!res.ok) return null;
    const json = (await res.json()) as any;
    if (!json || json.code !== 0 || !json.data || !Array.isArray(json.data.formats)) {
      return null;
    }

    const d = json.data;
    const result: ZeemoVideoData = {
      id: String(d.id || extractYouTubeId(cleanUrl) || Date.now()),
      videoName: String(d.videoName || 'YouTube Video'),
      duration: Number(d.duration) || 30,
      videoWidth: Number(d.videoWidth) || 1280,
      videoHeight: Number(d.videoHeight) || 720,
      thumbnailUrl: String(d.thumbnailUrl || ''),
      downloadUrl: String(d.downloadUrl || ''),
      audioDownloadUrl: String(d.audioDownloadUrl || ''),
      formats: d.formats as ZeemoFormat[],
      fetchedAt: Date.now(),
    };

    zeemoStreamCache.set(cleanUrl, result);
    return result;
  } catch (err) {
    console.warn('Zeemo stream resolution warning:', err);
    return null;
  }
}

// Download a stream URL using bounded-concurrency (max 4) 4MB HTTP Range chunks written directly to disk (zero RAM spike)
async function downloadFastChunked(
  streamUrl: string,
  destPath: string,
  onProgress?: (ratio: number) => void
): Promise<void> {
  const clenMatch = streamUrl.match(/[?&]clen=(\d+)/);
  let totalSize = clenMatch ? Number(clenMatch[1]) : 0;

  const baseHeaders = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  };

  if (!totalSize) {
    const probe = await fetch(streamUrl, {
      headers: { ...baseHeaders, Range: 'bytes=0-0' },
      signal: AbortSignal.timeout(10000),
    });
    const cr = probe.headers.get('content-range');
    if (cr && cr.includes('/')) {
      totalSize = Number(cr.split('/')[1]) || 0;
    } else {
      totalSize = Number(probe.headers.get('content-length')) || 0;
    }
  }

  if (!totalSize || isNaN(totalSize)) {
    const res = await fetch(streamUrl, { headers: baseHeaders, signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fs.writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
    if (onProgress) onProgress(1);
    return;
  }

  const chunkSize = 4 * 1024 * 1024; // 4MB per Range chunk
  const ranges: Array<[number, number]> = [];
  for (let start = 0; start < totalSize; start += chunkSize) {
    ranges.push([start, Math.min(start + chunkSize - 1, totalSize - 1)]);
  }

  const fileHandle = await fs.promises.open(destPath, 'w');
  let completedBytes = 0;
  let nextIdx = 0;
  const concurrency = Math.min(4, ranges.length);

  try {
    const workers = Array.from({ length: concurrency }, async () => {
      while (nextIdx < ranges.length) {
        const idx = nextIdx++;
        const [start, end] = ranges[idx];

        let lastErr: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const r = await fetch(streamUrl, {
              headers: { ...baseHeaders, Range: `bytes=${start}-${end}` },
              signal: AbortSignal.timeout(30000),
            });
            if (!r.ok && r.status !== 206) {
              throw new Error(`Chunk HTTP ${r.status}`);
            }
            const buf = Buffer.from(await r.arrayBuffer());
            await fileHandle.write(buf, 0, buf.length, start);
            completedBytes += buf.length;
            if (onProgress) {
              onProgress(Math.min(1, completedBytes / totalSize));
            }
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err;
            await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
          }
        }
        if (lastErr) {
          throw lastErr;
        }
      }
    });

    await Promise.all(workers);
  } finally {
    await fileHandle.close();
  }
}

// 3. Real YouTube & Social Extraction via Clipto / Submagic / Zeemo + YouTube oEmbed (Immune to Datacenter Bot Checks)
async function extractViaCliptoOrSubmagic(url: string): Promise<VideoMetadata | null> {
  const { platform, platformName } = detectPlatform(url);
  const cleanUrl = platform === 'youtube' ? normalizeYouTubeUrl(url) : url.trim();

  if (platform === 'youtube') {
    // Pre-warm non-IP-locked WEB_EMBEDDED_PLAYER stream URLs in parallel so preview & download are instant
    fetchZeemoVideoData(cleanUrl).catch(() => null);
  }

  try {
    // Fetch YouTube oEmbed in parallel for exact author/channel metadata
    const oembedPromise =
      platform === 'youtube'
        ? fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(cleanUrl)}&format=json`, {
            signal: AbortSignal.timeout(5000),
          })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null)
        : Promise.resolve(null);

    let apiData: any = null;

    // Primary: Clipto API
    try {
      const cRes = await fetch('https://www.clipto.com/api/youtube', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Origin: 'https://www.clipto.com',
          Referer: 'https://www.clipto.com/media-downloader/youtube-downloader',
        },
        body: JSON.stringify({ url: cleanUrl }),
        signal: AbortSignal.timeout(12000),
      });
      if (cRes.ok) {
        const cJson = (await cRes.json()) as any;
        if (cJson && cJson.success && Array.isArray(cJson.medias) && cJson.medias.length > 0) {
          apiData = {
            title: cJson.title,
            duration: Number(cJson.duration) || 30,
            thumbnail: cJson.thumbnail,
            author: cJson.author,
            medias: cJson.medias,
          };
        }
      }
    } catch {
      // Fallback to Submagic below
    }

    // Secondary: Submagic API
    if (!apiData && platform === 'youtube') {
      try {
        const sRes = await fetch('https://submagic-free-tools.fly.dev/api/youtube-info', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          },
          body: JSON.stringify({ url: cleanUrl }),
          signal: AbortSignal.timeout(12000),
        });
        if (sRes.ok) {
          const sJson = (await sRes.json()) as any;
          if (sJson && Array.isArray(sJson.formats) && sJson.formats.length > 0) {
            apiData = {
              title: sJson.title,
              duration: Number(sJson.duration) || 30,
              thumbnail: sJson.thumbnailUrl || sJson.thumbnail,
              author: sJson.author,
              medias: sJson.formats,
            };
          }
        }
      } catch {
        // ignore
      }
    }

    // Tertiary: Zeemo API fallback if both Clipto and Submagic timed out
    if (!apiData && platform === 'youtube') {
      const zData = await fetchZeemoVideoData(cleanUrl);
      if (zData && zData.formats.length > 0) {
        apiData = {
          title: zData.videoName,
          duration: zData.duration,
          thumbnail: zData.thumbnailUrl,
          author: undefined,
          medias: zData.formats.map((f) => ({
            type: f.containsVideo ? 'video' : 'audio',
            ext: f.ext,
            width: f.width,
            height: f.height,
            fps: f.fps,
            bitrate: Math.round((Number(f.vbr || f.abr || 1500) || 1500) * 1000),
            is_audio: Boolean(f.containsAudio),
            url: f.url,
          })),
        };
      }
    }

    if (!apiData) return null;

    const oembed = (await oembedPromise) as any;
    const durationSeconds = Math.max(1, Math.round(Number(apiData.duration) || 30));
    const rawMedias: any[] = apiData.medias || [];

    const videoMedias = rawMedias.filter(
      (m) =>
        (m.type === 'video' || String(m.type || '').toLowerCase().includes('video')) &&
        (m.ext === 'mp4' || m.extension === 'mp4' || m.ext === 'webm' || m.extension === 'webm')
    );

    const heightMap = new Map<number, any>();
    for (const m of videoMedias) {
      const h = Number(m.height) || 0;
      const w = Number(m.width) || 0;
      const resKey = Math.min(h, w) || h || 720;
      const ext = m.ext || m.extension || 'mp4';

      const existing = heightMap.get(resKey);
      if (!existing) {
        heightMap.set(resKey, m);
      } else {
        const existingExt = existing.ext || existing.extension || 'mp4';
        if (ext === 'mp4' && existingExt !== 'mp4') {
          heightMap.set(resKey, m);
        } else if (ext === existingExt && (Number(m.bitrate) || 0) > (Number(existing.bitrate) || 0)) {
          heightMap.set(resKey, m);
        }
      }
    }

    const sortedHeights = Array.from(heightMap.keys()).sort((a, b) => b - a);
    const qualities: VideoQualityOption[] = [];

    for (const resKey of sortedHeights) {
      const m = heightMap.get(resKey)!;
      const w = Number(m.width) || 1280;
      const h = Number(m.height) || 720;
      const fps = Math.round(Number(m.fps) || 30);
      const bitrateBps = Number(m.bitrate) || (resKey >= 1080 ? 4500000 : resKey >= 720 ? 2200000 : 1000000);
      const kbps = Math.round(bitrateBps / 1000);

      // Add ~128kbps audio overhead to video-only streams for accurate size estimation
      const totalBps = m.is_audio ? bitrateBps : bitrateBps + 128000;
      const exactBytes = Number(m.clen || m.contentLength || m.filesize || 0);
      const estimatedMb =
        exactBytes > 0
          ? Number((exactBytes / (1024 * 1024)).toFixed(1))
          : Number(Math.max(0.4, (totalBps * durationSeconds) / (8 * 1024 * 1024)).toFixed(1));

      let label = `${resKey}p`;
      if (resKey >= 2160) label = '4K Ultra HD (2160p)';
      else if (resKey >= 1440) label = '2K QHD (1440p)';
      else if (resKey >= 1080) label = '1080p Full HD';
      else if (resKey >= 720) label = '720p HD';
      else if (resKey >= 480) label = '480p SD';
      else if (resKey >= 360) label = '360p Compact';
      else label = `${resKey}p Lite`;

      const isIpLockedGoogleVideo =
        platform === 'youtube' || String(m.url || '').includes('googlevideo.com');

      qualities.push({
        id: `fmt_${m.formatId || resKey}_${resKey}p`,
        formatId: String(m.formatId || resKey),
        directUrl: !isIpLockedGoogleVideo && m.url ? m.url : undefined,
        label,
        resolution: `${w} × ${h}`,
        fps,
        format: 'mp4',
        fileSizeMb: estimatedMb,
        bitrate: `${kbps} kbps`,
        hasAudio: true,
        needsMerge: !m.is_audio,
        isPopular: resKey === 1080 || (qualities.length === 0 && resKey <= 1080),
      });
    }

    // Add real MP3 320kbps Audio Extraction option
    qualities.push({
      id: 'mp3_320',
      formatId: 'bestaudio/best',
      label: 'אודיו בלבד (MP3 320kbps)',
      resolution: 'Audio Stereo HQ',
      fps: 0,
      format: 'mp3',
      fileSizeMb: Number(Math.max(0.3, (durationSeconds * 320) / (8 * 1024)).toFixed(1)),
      bitrate: '320 kbps',
      hasAudio: true,
    });

    const firstVid = videoMedias[0] || {};
    const width = Number(firstVid.width) || 1280;
    const height = Number(firstVid.height) || 720;
    const aspectRatio: '16:9' | '9:16' | '1:1' =
      height > width ? '9:16' : width === height ? '1:1' : '16:9';

    const ytId = extractYouTubeId(cleanUrl);
    const rawThumbnail =
      apiData.thumbnail ||
      oembed?.thumbnail_url ||
      (ytId ? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg` : '');

    const authorName =
      oembed?.author_name || apiData.author || (platform === 'youtube' ? 'YouTube Creator' : platformName);
    const authorHandleFromUrl = oembed?.author_url
      ? decodeURIComponent(String(oembed.author_url).split('/').pop() || '')
      : '';
    const authorHandle = authorHandleFromUrl.startsWith('@')
      ? authorHandleFromUrl
      : `@${(authorHandleFromUrl || authorName).replace(/\s+/g, '')}`;

    const streamUrl =
      platform === 'youtube'
        ? `/api/proxy-stream?videoUrl=${encodeURIComponent(cleanUrl)}`
        : firstVid.url
        ? `/api/proxy-stream?url=${encodeURIComponent(firstVid.url)}`
        : '';

    return {
      id: ytId || String(Date.now()),
      url: cleanUrl,
      platform,
      platformName,
      title: apiData.title || oembed?.title || `${platformName} Video`,
      author: authorName,
      authorHandle,
      thumbnail: rawThumbnail ? `/api/proxy-image?url=${encodeURIComponent(rawThumbnail)}` : '',
      durationSeconds,
      durationFormatted: formatDuration(durationSeconds),
      viewsFormatted: '—',
      likesFormatted: '—',
      aspectRatio,
      streamUrl,
      qualities,
    };
  } catch (err) {
    console.warn('Clipto/Submagic extraction error:', err);
    return null;
  }
}

// 4. Universal Real yt-dlp Extractor (Instagram, Facebook, Reddit, Vimeo, YouTube, TikTok, etc.)
async function extractWithYtDlp(url: string, cookiesText?: string): Promise<VideoMetadata> {
  const ytdlpBin = await ensureYtDlpBinary();
  const { platform, platformName } = detectPlatform(url);

  const args: string[] = [
    '--js-runtimes',
    'node',
    '--dump-json',
    '--no-playlist',
    '--no-warnings',
    '--geo-bypass',
  ];

  if (platform === 'youtube') {
    // Do NOT include web_music here as it causes non-music videos to fail with "Video unavailable"
    args.push(
      '--extractor-args',
      'youtube:player-client=default,mweb,ios,android,tv;formats=missing_pot'
    );
  }

  let tempCookieFile: string | null = null;
  if (cookiesText && cookiesText.trim().length > 10) {
    tempCookieFile = path.join(os.tmpdir(), `cookies_${Date.now()}.txt`);
    fs.writeFileSync(tempCookieFile, cookiesText, 'utf8');
    args.push('--cookies', tempCookieFile);
  }

  args.push(url);

  try {
    const { stdout } = await execFileAsync(ytdlpBin, args, {
      maxBuffer: 25 * 1024 * 1024,
      timeout: 30000,
    });

    const info = JSON.parse(stdout.trim().split('\n')[0]);
    const durationSeconds = Math.max(1, Math.round(Number(info.duration) || 30));
    const rawFormats: any[] = Array.isArray(info.formats) ? info.formats : [];

    const videoFormats = rawFormats.filter(
      (f) =>
        f.vcodec &&
        f.vcodec !== 'none' &&
        f.url &&
        !String(f.format_note || '').toLowerCase().includes('storyboard') &&
        (f.ext === 'mp4' || f.ext === 'webm')
    );

    const heightMap = new Map<number, any>();

    for (const f of videoFormats) {
      const h = Number(f.height) || 0;
      const w = Number(f.width) || 0;
      const resKey = Math.min(h, w) || h || 720;
      const hasAudio = Boolean(f.acodec && f.acodec !== 'none');

      const existing = heightMap.get(resKey);
      if (!existing) {
        heightMap.set(resKey, f);
      } else {
        const existingHasAudio = Boolean(existing.acodec && existing.acodec !== 'none');
        if (hasAudio && !existingHasAudio) {
          heightMap.set(resKey, f);
        } else if (hasAudio === existingHasAudio && f.ext === 'mp4' && existing.ext !== 'mp4') {
          heightMap.set(resKey, f);
        } else if (
          hasAudio === existingHasAudio &&
          f.ext === existing.ext &&
          (Number(f.tbr) || 0) > (Number(existing.tbr) || 0)
        ) {
          heightMap.set(resKey, f);
        }
      }
    }

    const sortedHeights = Array.from(heightMap.keys()).sort((a, b) => b - a);
    const qualities: VideoQualityOption[] = [];

    for (const resKey of sortedHeights) {
      const f = heightMap.get(resKey)!;
      const w = Number(f.width) || 1280;
      const h = Number(f.height) || 720;
      const fps = Math.round(Number(f.fps) || 30);
      const hasAudio = Boolean(f.acodec && f.acodec !== 'none');
      const tbrKbps = Math.round(Number(f.tbr || f.vbr || 2500));

      const exactBytes = Number(f.filesize || f.filesize_approx || 0);
      const estimatedMb =
        exactBytes > 0
          ? Number((exactBytes / (1024 * 1024)).toFixed(1))
          : Number(Math.max(0.3, (tbrKbps * 1000 * durationSeconds) / (8 * 1024 * 1024)).toFixed(1));

      let label = `${resKey}p`;
      if (resKey >= 2160) label = '4K Ultra HD (2160p)';
      else if (resKey >= 1440) label = '2K QHD (1440p)';
      else if (resKey >= 1080) label = '1080p Full HD';
      else if (resKey >= 720) label = '720p HD';
      else if (resKey >= 480) label = '480p SD';
      else if (resKey >= 360) label = '360p Compact';
      else label = `${resKey}p Lite`;

      const isDirectProgressive =
        hasAudio &&
        !String(f.protocol || '').includes('m3u8') &&
        !String(f.protocol || '').includes('dash');

      qualities.push({
        id: `fmt_${f.format_id}`,
        formatId: String(f.format_id),
        directUrl: isDirectProgressive ? f.url : undefined,
        label,
        resolution: `${w} × ${h}`,
        fps,
        format: f.ext === 'webm' ? 'webm' : 'mp4',
        fileSizeMb: estimatedMb,
        bitrate: `${tbrKbps} kbps`,
        hasAudio: true,
        needsMerge: !hasAudio,
        isPopular: resKey === 1080 || (qualities.length === 0 && resKey <= 1080),
      });
    }

    if (qualities.length === 0 && info.url) {
      const w = Number(info.width) || 1280;
      const h = Number(info.height) || 720;
      qualities.push({
        id: 'best_mp4',
        formatId: 'best',
        directUrl: info.url,
        label: 'איכות מקורית (Original HD)',
        resolution: `${w} × ${h}`,
        fps: 30,
        format: 'mp4',
        fileSizeMb: Number(Math.max(1.0, durationSeconds * 0.35).toFixed(1)),
        bitrate: 'Original',
        hasAudio: true,
        isPopular: true,
      });
    }

    qualities.push({
      id: 'mp3_320',
      formatId: 'bestaudio/best',
      label: 'אודיו בלבד (MP3 320kbps)',
      resolution: 'Audio Stereo HQ',
      fps: 0,
      format: 'mp3',
      fileSizeMb: Number(Math.max(0.3, (durationSeconds * 320) / (8 * 1024)).toFixed(1)),
      bitrate: '320 kbps',
      hasAudio: true,
    });

    const progressiveFormats = videoFormats
      .filter(
        (f) =>
          f.acodec &&
          f.acodec !== 'none' &&
          f.ext === 'mp4' &&
          !String(f.protocol || '').includes('m3u8')
      )
      .sort((a, b) => (Number(b.height) || 0) - (Number(a.height) || 0));

    const previewTargetUrl =
      progressiveFormats[0]?.url || videoFormats[0]?.url || info.url || '';

    const width = Number(info.width) || Number(videoFormats[0]?.width) || 1280;
    const height = Number(info.height) || Number(videoFormats[0]?.height) || 720;
    const aspectRatio: '16:9' | '9:16' | '1:1' =
      height > width ? '9:16' : width === height ? '1:1' : '16:9';

    const rawThumbnail =
      info.thumbnail ||
      (Array.isArray(info.thumbnails) && info.thumbnails[info.thumbnails.length - 1]?.url) ||
      '';
    const uploader = info.uploader || info.channel || info.creator || platformName;
    const uploaderId = info.uploader_id || info.channel_id || uploader.toLowerCase().replace(/\s+/g, '');

    return {
      id: String(info.id || Date.now()),
      url,
      platform,
      platformName: info.extractor_key || platformName,
      title: info.title || info.fulltitle || `${platformName} Video`,
      author: uploader,
      authorHandle: String(uploaderId).startsWith('@') ? String(uploaderId) : `@${uploaderId}`,
      thumbnail: rawThumbnail ? `/api/proxy-image?url=${encodeURIComponent(rawThumbnail)}` : '',
      durationSeconds,
      durationFormatted: formatDuration(durationSeconds),
      viewsFormatted: formatCount(info.view_count),
      likesFormatted: formatCount(info.like_count),
      aspectRatio,
      streamUrl: previewTargetUrl ? `/api/proxy-stream?url=${encodeURIComponent(previewTargetUrl)}` : '',
      qualities,
    };
  } finally {
    if (tempCookieFile && fs.existsSync(tempCookieFile)) {
      try {
        fs.unlinkSync(tempCookieFile);
      } catch {
        // ignore
      }
    }
  }
}

async function extractVideoDetails(url: string, cookiesText?: string): Promise<VideoMetadata> {
  const { platform } = detectPlatform(url);

  // 1. For TikTok, try TikWM API first (fast, provides both HD no-watermark and watermarked streams)
  if (platform === 'tiktok') {
    const tikData = await extractTikTokReal(url);
    if (tikData && tikData.qualities.length > 0) {
      return tikData;
    }
  }

  // 2. For X / Twitter, try FxTwitter API first
  if (platform === 'twitter') {
    const twData = await extractTwitterReal(url);
    if (twData && twData.qualities.length > 0) {
      return twData;
    }
  }

  // 3. For YouTube, use Clipto/Submagic + oEmbed first (instant <1s and bypasses datacenter bot checks),
  //    or yt-dlp if user explicitly provided custom cookies
  if (platform === 'youtube') {
    if (!cookiesText || cookiesText.trim().length <= 10) {
      const apiMeta = await extractViaCliptoOrSubmagic(url);
      if (apiMeta && apiMeta.qualities.length > 0) {
        return apiMeta;
      }
    }
    try {
      return await extractWithYtDlp(url, cookiesText);
    } catch (ytErr) {
      const fallbackMeta = await extractViaCliptoOrSubmagic(url);
      if (fallbackMeta && fallbackMeta.qualities.length > 0) {
        return fallbackMeta;
      }
      throw ytErr;
    }
  }

  // 4. For Instagram, Facebook, Reddit, Vimeo, etc.: try yt-dlp first, then Clipto fallback
  try {
    return await extractWithYtDlp(url, cookiesText);
  } catch (err) {
    const fallbackMeta = await extractViaCliptoOrSubmagic(url);
    if (fallbackMeta && fallbackMeta.qualities.length > 0) {
      return fallbackMeta;
    }
    throw err;
  }
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(express.json({ limit: '5mb' }));

  // API 1: Analyze real social video link
  app.post('/api/analyze', async (req: Request, res: Response) => {
    try {
      const { url, cookies } = req.body;
      if (!url || typeof url !== 'string' || !url.trim().startsWith('http')) {
        return res.status(400).json({
          error: 'כתובת קישור לא תקינה. אנא הזן קישור תקין המתחיל ב-http:// או https://',
        });
      }

      const meta = await extractVideoDetails(url.trim(), cookies);
      return res.json({ success: true, data: meta });
    } catch (err: unknown) {
      console.error('Error analyzing real link:', err);
      const rawMsg = err instanceof Error ? err.message : String(err);

      let userFriendlyError = 'לא ניתן היה לחלץ את הסרטון מהקישור שהוזן. ודא שהסרטון ציבורי ושהקישור תקין.';
      if (rawMsg.includes('Sign in to confirm you’re not a bot')) {
        userFriendlyError =
          'יוטיוב דורש אימות עבור סרטון זה מכתובת השרת. ניתן להדביק Cookies בהגדרות המתקדמות או לנסות קישור אחר.';
      } else if (rawMsg.includes('Private video') || rawMsg.includes('only available for registered users')) {
        userFriendlyError =
          'סרטון זה מוגדר כפרטי או דורש התחברות לחשבון ברשת החברתית.';
      } else if (rawMsg.includes('No video could be found')) {
        userFriendlyError = 'לא נמצא קובץ וידאו בפוסט זה.';
      }

      return res.status(422).json({
        error: userFriendlyError,
        details: rawMsg.split('\n').slice(-2).join(' '),
      });
    }
  });

  // API 2: Verified real working social links for quick testing
  app.get('/api/samples', (_req: Request, res: Response) => {
    res.json({
      samples: [
        {
          label: 'YouTube Animated Trailer',
          url: 'https://youtu.be/6HEVkzXSih0?si=O71ldR9pt_DTpu2W',
          platform: 'youtube',
          category: 'YouTube 4K/HD',
        },
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
          label: 'X / Twitter Video (@historyinmemes)',
          url: 'https://x.com/historyinmemes/status/1790637656616943991',
          platform: 'twitter',
          category: 'X (Twitter)',
        },
      ],
    });
  });

  // API 3: Proxy Thumbnail Images (bypasses Instagram/TikTok Cross-Origin-Resource-Policy blocks)
  app.get('/api/proxy-image', async (req: Request, res: Response) => {
    try {
      const targetUrl = String(req.query.url || '');
      if (!targetUrl.startsWith('http')) {
        return res.status(400).end();
      }
      const upstream = await fetch(targetUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Referer: new URL(targetUrl).origin + '/',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!upstream.ok || !upstream.body) {
        return res.status(upstream.status).end();
      }
      const ct = upstream.headers.get('content-type') || 'image/jpeg';
      res.setHeader('Content-Type', ct);
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Cache-Control', 'public, max-age=3600');

      const reader = upstream.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    } catch {
      if (!res.headersSent) res.status(502).end();
    }
  });

  // API 4: Proxy Video Preview Stream (supports Range requests and on-demand YouTube stream resolution)
  app.get('/api/proxy-stream', async (req: Request, res: Response) => {
    try {
      let targetUrl = String(req.query.url || '');
      const videoUrl = String(req.query.videoUrl || '');

      if (!targetUrl.startsWith('http') && videoUrl.startsWith('http')) {
        const zData = await fetchZeemoVideoData(videoUrl);
        if (zData && zData.downloadUrl) {
          targetUrl = zData.downloadUrl;
        } else {
          targetUrl = await resolveNotubeStreamUrl(videoUrl, 720);
        }
      }

      if (!targetUrl.startsWith('http')) {
        return res.status(400).end();
      }

      const headers: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Referer: targetUrl.includes('notube.net') ? 'https://notube.net/' : new URL(targetUrl).origin + '/',
      };
      if (req.headers.range) {
        headers['Range'] = req.headers.range;
      }

      const upstream = await fetch(targetUrl, { headers });
      if (!upstream.ok && upstream.status !== 206) {
        return res.status(upstream.status).end();
      }

      res.status(upstream.status);
      const forwardHeaders = ['content-length', 'content-range', 'accept-ranges'];
      for (const h of forwardHeaders) {
        const val = upstream.headers.get(h);
        if (val) res.setHeader(h, val);
      }
      const rawCt = upstream.headers.get('content-type') || 'video/mp4';
      res.setHeader(
        'Content-Type',
        rawCt === 'application/octet-stream' ? 'video/mp4' : rawCt
      );
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

      if (!upstream.body) return res.end();
      const reader = upstream.body.getReader();
      req.on('close', () => {
        reader.cancel().catch(() => {});
      });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    } catch {
      if (!res.headersSent) res.status(502).end();
    }
  });

  function finalizePreparedOrStream(
    res: Response | null,
    jobId: string | null,
    filePath: string,
    filename: string,
    mimeType: string
  ) {
    const stat = fs.statSync(filePath);
    if (jobId) {
      const existing = preparedFilesMap.get(jobId);
      if (existing) {
        existing.status = 'ready';
        existing.progress = 100;
        existing.filePath = filePath;
        existing.filename = filename;
        existing.mimeType = mimeType;
        existing.size = stat.size;
      }
      return;
    }

    if (!res) return;
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', String(stat.size));

    const readStream = fs.createReadStream(filePath);
    readStream.pipe(res);
    const cleanup = () => fs.unlink(filePath, () => {});
    readStream.on('close', cleanup);
    res.on('close', cleanup);
  }

  // API 4a: Poll preparation job status (returns tiny JSON in <2ms so client never blocks on long POST requests)
  app.get('/api/download-status', (req: Request, res: Response) => {
    const jobId = String(req.query.jobId || '');
    const entry = preparedFilesMap.get(jobId);
    if (!entry) {
      return res.status(404).json({ success: false, error: 'משימת ההורדה לא נמצאה' });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      success: entry.status !== 'error',
      jobId,
      status: entry.status,
      progress: entry.progress,
      totalBytes: entry.size,
      filename: entry.filename,
      mimeType: entry.mimeType,
      error: entry.error,
    });
  });

  // API 4b: Download Chunk Endpoint (serves <=4MB slices so large 1080p/2K/4K files never hit Cloud Run's 32MiB response cap)
  app.get('/api/download-chunk', (req: Request, res: Response) => {
    const jobId = String(req.query.jobId || '');
    const entry = preparedFilesMap.get(jobId);
    if (!entry || entry.status !== 'ready' || !fs.existsSync(entry.filePath)) {
      return res.status(404).json({ error: 'קובץ ההורדה לא נמצא או שפג תוקפו' });
    }

    const start = Math.max(0, Number(req.query.start) || 0);
    const end = Math.min(entry.size - 1, Number(req.query.end) || entry.size - 1);
    const isFinalChunk = req.query.done === '1';

    if (start > end || start >= entry.size) {
      return res.status(416).end();
    }

    const chunkLen = end - start + 1;
    res.status(200);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(chunkLen));
    res.setHeader('Cache-Control', 'no-store');

    const stream = fs.createReadStream(entry.filePath, { start, end });
    stream.pipe(res);
    stream.on('close', () => {
      if (isFinalChunk) {
        preparedFilesMap.delete(jobId);
        fs.unlink(entry.filePath, () => {});
      }
    });
  });

  function updateJobProgress(jobId: string | null, progress: number) {
    if (!jobId) return;
    const entry = preparedFilesMap.get(jobId);
    if (entry && entry.status === 'preparing') {
      entry.progress = Math.max(entry.progress, Math.min(99, Math.round(progress)));
    }
  }

  // Helper to download or ffmpeg-process a direct HTTP stream URL
  async function processDirectStreamToFile(
    sourceStreamUrl: string,
    ext: 'mp4' | 'webm' | 'mp3',
    needsFfmpegTransform: boolean,
    startSec: number,
    endSec: number,
    shouldMute: boolean,
    jobId: string | null
  ): Promise<string | null> {
    const referer = sourceStreamUrl.includes('notube.net')
      ? 'https://notube.net/'
      : new URL(sourceStreamUrl).origin + '/';

    const tmpOut = path.join(
      os.tmpdir(),
      `omnidrop_direct_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
    );

    if (!needsFfmpegTransform) {
      updateJobProgress(jobId, 20);
      const streamRes = await fetch(sourceStreamUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Referer: referer,
        },
        signal: AbortSignal.timeout(90000),
      });

      if (!streamRes.ok || !streamRes.body) {
        return null;
      }

      const fileStream = fs.createWriteStream(tmpOut);
      const reader = streamRes.body.getReader();
      const totalLen = Number(streamRes.headers.get('content-length')) || 0;
      let loaded = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fileStream.write(Buffer.from(value));
        loaded += value.length;
        if (totalLen > 0) {
          updateJobProgress(jobId, 20 + (loaded / totalLen) * 75);
        }
      }
      await new Promise<void>((resolve, reject) => {
        fileStream.end(() => resolve());
        fileStream.on('error', reject);
      });
      return tmpOut;
    }

    updateJobProgress(jobId, 30);
    const ffArgs: string[] = ['-y', '-headers', `Referer: ${referer}\r\nUser-Agent: Mozilla/5.0\r\n`];
    if (startSec > 0) ffArgs.push('-ss', String(startSec));
    if (endSec > startSec) ffArgs.push('-to', String(endSec));
    ffArgs.push('-i', sourceStreamUrl);

    if (ext === 'mp3') {
      ffArgs.push('-vn', '-acodec', 'libmp3lame', '-b:a', '320k');
    } else {
      if (shouldMute) {
        ffArgs.push('-an');
      } else {
        ffArgs.push('-c:a', 'aac');
      }
      ffArgs.push('-c:v', 'libx264', '-preset', 'ultrafast', '-movflags', '+faststart');
    }
    ffArgs.push(tmpOut);

    await execFileAsync('/usr/bin/ffmpeg', ffArgs, { timeout: 120000 });
    return tmpOut;
  }

  // Core download & mux pipeline (runs asynchronously for mode=prepare or inline for direct GET/POST)
  async function executeDownloadPipeline(
    params: {
      url: string;
      directUrl: string;
      formatId: string;
      requestedHeight: number;
      filename: string;
      ext: 'mp4' | 'webm' | 'mp3';
      mimeType: string;
      needsFfmpegTransform: boolean;
      startSec: number;
      endSec: number;
      shouldMute: boolean;
      shouldTrim: boolean;
    },
    res: Response | null,
    jobId: string | null
  ): Promise<void> {
    const {
      url,
      directUrl,
      formatId,
      requestedHeight,
      filename,
      ext,
      mimeType,
      needsFfmpegTransform,
      startSec,
      endSec,
      shouldMute,
      shouldTrim,
    } = params;

    // 1. If a non-IP-locked directUrl is available (TikTok, X/Twitter, Instagram, etc.), download/transcode it
    if (
      directUrl &&
      String(directUrl).startsWith('http') &&
      !String(directUrl).includes('googlevideo.com')
    ) {
      const filePath = await processDirectStreamToFile(
        String(directUrl),
        ext,
        needsFfmpegTransform,
        startSec,
        endSec,
        shouldMute,
        jobId
      );
      if (filePath) {
        finalizePreparedOrStream(res, jobId, filePath, filename, mimeType);
        return;
      }
    }

    if (!url || !String(url).startsWith('http')) {
      throw new Error('חסר קישור מקור להורדה');
    }

    const isYouTube =
      String(url).toLowerCase().includes('youtube.com') ||
      String(url).toLowerCase().includes('youtu.be');

    // 2. For YouTube links, resolve via Zeemo WEB_EMBEDDED_PLAYER streams + bounded Range chunk downloader + ffmpeg mux
    if (isYouTube) {
      try {
        updateJobProgress(jobId, 12);
        const zData = await fetchZeemoVideoData(String(url));
        if (zData && zData.formats.length > 0) {
          updateJobProgress(jobId, 20);
          const audioStreamUrl =
            zData.audioDownloadUrl ||
            zData.formats.find((f) => !f.containsVideo && f.containsAudio)?.url ||
            zData.downloadUrl;

          // Case A: MP3 320kbps audio download
          if (ext === 'mp3' && audioStreamUrl) {
            const tmpAudioIn = path.join(os.tmpdir(), `omnidrop_zin_a_${Date.now()}.m4a`);
            const tmpMp3Out = path.join(os.tmpdir(), `omnidrop_zout_${Date.now()}.mp3`);
            try {
              await downloadFastChunked(audioStreamUrl, tmpAudioIn, (r) =>
                updateJobProgress(jobId, 20 + r * 50)
              );
              updateJobProgress(jobId, 75);
              const ffArgs: string[] = ['-y'];
              if (startSec > 0) ffArgs.push('-ss', String(startSec));
              if (endSec > startSec) ffArgs.push('-to', String(endSec));
              ffArgs.push('-i', tmpAudioIn, '-vn', '-acodec', 'libmp3lame', '-b:a', '320k', tmpMp3Out);
              await execFileAsync('/usr/bin/ffmpeg', ffArgs, { timeout: 90000 });
              fs.unlink(tmpAudioIn, () => {});

              finalizePreparedOrStream(res, jobId, tmpMp3Out, filename, 'audio/mpeg');
              return;
            } catch (mp3Err) {
              fs.unlink(tmpAudioIn, () => {});
              fs.unlink(tmpMp3Out, () => {});
              throw mp3Err;
            }
          }

          // Case B: Video download (select exact requested resolution or closest available)
          const videoCandidates = zData.formats.filter((f) => f.containsVideo && f.url);
          const matchingHeight = videoCandidates
            .filter((f) => {
              const shortSide =
                Math.min(Number(f.height) || 720, Number(f.width) || 1280) || Number(f.height) || 720;
              return shortSide === requestedHeight || Number(f.height) === requestedHeight;
            })
            .sort((a, b) => {
              const aAvc = String(a.vcodec || '').startsWith('avc1') ? 1 : 0;
              const bAvc = String(b.vcodec || '').startsWith('avc1') ? 1 : 0;
              if (aAvc !== bAvc) return bAvc - aAvc;
              const aMp4 = a.ext === 'mp4' ? 1 : 0;
              const bMp4 = b.ext === 'mp4' ? 1 : 0;
              if (aMp4 !== bMp4) return bMp4 - aMp4;
              return (Number(b.vbr) || 0) - (Number(a.vbr) || 0);
            });

          const chosenFormat =
            matchingHeight[0] ||
            videoCandidates.sort((a, b) => (Number(b.height) || 0) - (Number(a.height) || 0))[0];

          if (chosenFormat && chosenFormat.url) {
            if (chosenFormat.containsAudio && !needsFfmpegTransform) {
              const tmpProg = path.join(os.tmpdir(), `omnidrop_zprog_${Date.now()}.mp4`);
              try {
                await downloadFastChunked(chosenFormat.url, tmpProg, (r) =>
                  updateJobProgress(jobId, 20 + r * 75)
                );
                finalizePreparedOrStream(res, jobId, tmpProg, filename, 'video/mp4');
                return;
              } catch (progErr) {
                fs.unlink(tmpProg, () => {});
                throw progErr;
              }
            }

            // Adaptive stream (e.g. 4K, 2K, 1080p, 720p, 480p): download video + audio in bounded chunks and mux
            const idSuffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
            const tmpVidIn = path.join(
              os.tmpdir(),
              `omnidrop_zvid_${idSuffix}.${chosenFormat.ext || 'mp4'}`
            );
            const tmpAudIn = path.join(os.tmpdir(), `omnidrop_zaud_${idSuffix}.m4a`);
            const tmpMuxOut = path.join(os.tmpdir(), `omnidrop_zmux_${idSuffix}.${ext}`);

            try {
              if (shouldMute || !audioStreamUrl) {
                await downloadFastChunked(chosenFormat.url, tmpVidIn, (r) =>
                  updateJobProgress(jobId, 20 + r * 60)
                );
              } else {
                await Promise.all([
                  downloadFastChunked(chosenFormat.url, tmpVidIn, (r) =>
                    updateJobProgress(jobId, 20 + r * 55)
                  ),
                  downloadFastChunked(audioStreamUrl, tmpAudIn),
                ]);
              }

              updateJobProgress(jobId, 82);
              const ffArgs: string[] = ['-y'];
              if (startSec > 0) ffArgs.push('-ss', String(startSec));
              if (endSec > startSec) ffArgs.push('-to', String(endSec));
              ffArgs.push('-i', tmpVidIn);

              if (!shouldMute && audioStreamUrl && fs.existsSync(tmpAudIn)) {
                if (startSec > 0) ffArgs.push('-ss', String(startSec));
                if (endSec > startSec) ffArgs.push('-to', String(endSec));
                ffArgs.push('-i', tmpAudIn);
              }

              if (shouldMute) {
                ffArgs.push('-an');
              } else {
                ffArgs.push('-c:a', 'aac');
              }

              if (shouldTrim) {
                ffArgs.push('-c:v', 'libx264', '-preset', 'ultrafast');
              } else {
                ffArgs.push('-c:v', 'copy');
              }

              ffArgs.push('-movflags', '+faststart', tmpMuxOut);
              await execFileAsync('/usr/bin/ffmpeg', ffArgs, { timeout: 120000 });

              fs.unlink(tmpVidIn, () => {});
              fs.unlink(tmpAudIn, () => {});

              finalizePreparedOrStream(res, jobId, tmpMuxOut, filename, mimeType);
              return;
            } catch (muxErr) {
              fs.unlink(tmpVidIn, () => {});
              fs.unlink(tmpAudIn, () => {});
              fs.unlink(tmpMuxOut, () => {});
              throw muxErr;
            }
          }
        }
      } catch (zeemoErr) {
        console.warn('Zeemo YouTube download failed, trying NoTube / yt-dlp fallback:', zeemoErr);
      }

      try {
        const ntStreamUrl = await resolveNotubeStreamUrl(String(url), requestedHeight);
        const filePath = await processDirectStreamToFile(
          ntStreamUrl,
          ext,
          needsFfmpegTransform,
          startSec,
          endSec,
          shouldMute,
          jobId
        );
        if (filePath) {
          finalizePreparedOrStream(res, jobId, filePath, filename, mimeType);
          return;
        }
      } catch (ntErr) {
        console.warn('NoTube stream resolution failed, trying yt-dlp fallback:', ntErr);
      }
    }

    // 3. Universal yt-dlp + ffmpeg download & merge
    updateJobProgress(jobId, 25);
    const ytdlpBin = await ensureYtDlpBinary();
    const tmpId = `omnidrop_yt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const tmpOutTemplate = path.join(os.tmpdir(), `${tmpId}.%(ext)s`);

    const ytArgs: string[] = [
      '--js-runtimes',
      'node',
      '--no-playlist',
      '--no-warnings',
      '--geo-bypass',
    ];

    if (isYouTube) {
      ytArgs.push(
        '--extractor-args',
        'youtube:player-client=default,mweb,ios,android,tv;formats=missing_pot'
      );
    }

    if (ext === 'mp3') {
      ytArgs.push('-x', '--audio-format', 'mp3', '--audio-quality', '320K');
    } else if (formatId && formatId !== 'best') {
      ytArgs.push('-f', `${formatId}+bestaudio/best`, '--merge-output-format', ext);
    } else {
      ytArgs.push('-f', 'bestvideo+bestaudio/best', '--merge-output-format', ext);
    }

    if (shouldTrim || shouldMute) {
      const postArgs: string[] = [];
      if (startSec > 0) postArgs.push(`-ss ${startSec}`);
      if (endSec > startSec) postArgs.push(`-to ${endSec}`);
      if (shouldMute) postArgs.push('-an');
      if (postArgs.length > 0) {
        ytArgs.push('--postprocessor-args', `ffmpeg:${postArgs.join(' ')}`);
      }
    }

    ytArgs.push('-o', tmpOutTemplate, String(url));

    try {
      await execFileAsync(ytdlpBin, ytArgs, { timeout: 180000 });
    } catch (ytDownloadErr) {
      if (!isYouTube) {
        const ntStreamUrl = await resolveNotubeStreamUrl(String(url), requestedHeight);
        const filePath = await processDirectStreamToFile(
          ntStreamUrl,
          ext,
          needsFfmpegTransform,
          startSec,
          endSec,
          shouldMute,
          jobId
        );
        if (filePath) {
          finalizePreparedOrStream(res, jobId, filePath, filename, mimeType);
          return;
        }
      }
      throw ytDownloadErr;
    }

    const tmpFiles = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith(tmpId));
    if (tmpFiles.length === 0) {
      throw new Error('לא נוצר קובץ פלט מההורדה');
    }

    const finalFilePath = path.join(os.tmpdir(), tmpFiles[0]);
    finalizePreparedOrStream(res, jobId, finalFilePath, filename, mimeType);
  }

  // API 5: Real Download & Conversion Endpoint
  app.all('/api/download', async (req: Request, res: Response) => {
    const params = req.method === 'POST' ? req.body : req.query;
    const {
      url = '',
      directUrl = '',
      formatId = '',
      quality = '1080p',
      title = 'video',
      platform = 'social',
      format = 'mp4',
      trimStart = '0',
      trimEnd = '0',
      muteAudio = 'false',
      mode = '',
    } = params;

    const prepareMode = String(mode) === 'prepare';
    const safeTitle = (String(title) || 'video')
      .replace(/[^a-zA-Z0-9_\u0590-\u05FF-]/g, '_')
      .replace(/_+/g, '_')
      .substring(0, 60);
    const ext: 'mp4' | 'webm' | 'mp3' =
      format === 'mp3' ? 'mp3' : format === 'webm' ? 'webm' : 'mp4';
    const mimeType = ext === 'mp3' ? 'audio/mpeg' : ext === 'webm' ? 'video/webm' : 'video/mp4';
    const filename = `${platform}_${safeTitle}_${quality}.${ext}`;

    const startSec = Number(trimStart) || 0;
    const endSec = Number(trimEnd) || 0;
    const shouldMute = String(muteAudio) === 'true';
    const shouldTrim = startSec > 0 && endSec > startSec;
    const needsFfmpegTransform = ext === 'mp3' || shouldMute || shouldTrim;

    const endHeightMatch = String(quality).match(/(2160|1440|1080|720|480|360|240|144)p?$/i);
    const anyHeightMatch = String(quality).match(/(2160|1440|1080|720|480|360|240|144)/);
    const requestedHeight = endHeightMatch
      ? Number(endHeightMatch[1])
      : anyHeightMatch
      ? Number(anyHeightMatch[1])
      : 1080;

    const pipelineParams = {
      url: String(url),
      directUrl: String(directUrl),
      formatId: String(formatId),
      requestedHeight,
      filename,
      ext,
      mimeType,
      needsFfmpegTransform,
      startSec,
      endSec,
      shouldMute,
      shouldTrim,
    };

    // In prepareMode, respond IMMEDIATELY (<5ms) with a jobId and run the download/mux pipeline in the background!
    if (prepareMode) {
      const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      preparedFilesMap.set(jobId, {
        status: 'preparing',
        progress: 8,
        filePath: '',
        filename,
        mimeType,
        size: 0,
        createdAt: Date.now(),
      });

      setTimeout(() => {
        const entry = preparedFilesMap.get(jobId);
        if (entry) {
          preparedFilesMap.delete(jobId);
          if (entry.filePath) fs.unlink(entry.filePath, () => {});
        }
      }, 15 * 60 * 1000);

      executeDownloadPipeline(pipelineParams, null, jobId).catch((err) => {
        console.error('Background prepare job error:', err);
        const entry = preparedFilesMap.get(jobId);
        if (entry) {
          entry.status = 'error';
          entry.error = err instanceof Error ? err.message : 'שגיאה בהכנת הקובץ';
        }
      });

      return res.json({
        success: true,
        jobId,
        status: 'preparing',
        filename,
        mimeType,
      });
    }

    try {
      await executeDownloadPipeline(pipelineParams, res, null);
    } catch (err: unknown) {
      console.error('Real download error:', err);
      if (!res.headersSent) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        res.status(500).json({ error: `שגיאה בהורדת קובץ הווידאו: ${msg}` });
      }
    }
  });

  // Helper: ensure media file exists on disk for Studio operations (reuses jobId if available, or prepares it)
  async function ensureStudioSourceFile(params: {
    jobId?: string;
    url?: string;
    directUrl?: string;
    formatId?: string;
    quality?: string;
  }): Promise<{ jobId: string; filePath: string }> {
    const existingId = String(params.jobId || '');
    const existing = existingId ? preparedFilesMap.get(existingId) : undefined;
    if (existing && existing.status === 'ready' && existing.filePath && fs.existsSync(existing.filePath)) {
      return { jobId: existingId, filePath: existing.filePath };
    }

    const newJobId = `job_studio_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    preparedFilesMap.set(newJobId, {
      status: 'preparing',
      progress: 10,
      filePath: '',
      filename: 'studio_source.mp4',
      mimeType: 'video/mp4',
      size: 0,
      createdAt: Date.now(),
    });

    await executeDownloadPipeline(
      {
        url: String(params.url || ''),
        directUrl: String(params.directUrl || ''),
        formatId: String(params.formatId || ''),
        requestedHeight: 720,
        filename: 'studio_source.mp4',
        ext: 'mp4',
        mimeType: 'video/mp4',
        needsFfmpegTransform: false,
        startSec: 0,
        endSec: 0,
        shouldMute: false,
        shouldTrim: false,
      },
      null,
      newJobId
    );

    const prepared = preparedFilesMap.get(newJobId);
    if (!prepared || prepared.status !== 'ready' || !fs.existsSync(prepared.filePath)) {
      throw new Error('לא ניתן היה להכין את קובץ הווידאו לעריכה בסטודיו');
    }
    return { jobId: newJobId, filePath: prepared.filePath };
  }

  // API 6a: Stream local studio video file with Express native Range support
  app.get('/api/studio/video-stream', (req: Request, res: Response) => {
    const jobId = String(req.query.jobId || '');
    const entry = preparedFilesMap.get(jobId);
    if (!entry || entry.status !== 'ready' || !fs.existsSync(entry.filePath)) {
      return res.status(404).json({ error: 'קובץ וידאו מקומי לא נמצא' });
    }
    res.sendFile(entry.filePath);
  });

  // API 6a-2: Upload local video file from user's computer into Studio preparedFilesMap
  app.post(
    '/api/studio/upload-local',
    express.raw({ type: '*/*', limit: '150mb' }),
    async (req: Request, res: Response) => {
      try {
        const rawFilename = String(req.query.filename || 'local_video.mp4');
        const safeExt = path.extname(rawFilename).replace(/[^a-zA-Z0-9.]/g, '') || '.mp4';
        const jobId = `job_local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const tmpFilePath = path.join(os.tmpdir(), `omnidrop_local_${jobId}${safeExt}`);

        const bodyBuf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
        if (bodyBuf.length < 100) {
          return res.status(400).json({ success: false, error: 'קובץ הווידאו שהועלה ריק או לא תקין' });
        }

        await fs.promises.writeFile(tmpFilePath, bodyBuf);

        preparedFilesMap.set(jobId, {
          status: 'ready',
          progress: 100,
          filePath: tmpFilePath,
          filename: rawFilename,
          mimeType: 'video/mp4',
          size: bodyBuf.length,
          createdAt: Date.now(),
        });

        setTimeout(() => {
          const entry = preparedFilesMap.get(jobId);
          if (entry) {
            preparedFilesMap.delete(jobId);
            if (entry.filePath) fs.unlink(entry.filePath, () => {});
          }
        }, 30 * 60 * 1000);

        return res.json({
          success: true,
          jobId,
          size: bodyBuf.length,
        });
      } catch (err: unknown) {
        console.error('Local studio upload error:', err);
        const msg = err instanceof Error ? err.message : 'שגיאה בהעלאת קובץ הווידאו לסטודיו';
        return res.status(500).json({ success: false, error: msg });
      }
    }
  );

  // Track background transcription jobs so long videos never time out over HTTP proxy
  const transcriptionJobsMap = new Map<
    string,
    {
      status: 'transcribing' | 'ready' | 'error';
      progress: number;
      step: string;
      videoJobId?: string;
      cues?: unknown[];
      detectedLanguage?: string;
      engine?: string;
      error?: string;
      createdAt: number;
    }
  >();

  // API 6b: Transcribe video audio via Cartesia ink-whisper / Gemini Audio STT & generate Hebrew subtitles
  app.post('/api/studio/transcribe', async (req: Request, res: Response) => {
    const { jobId, url, directUrl, formatId, quality, title, languageHint, mode } = req.body || {};

    if (mode === 'async') {
      const transcribeJobId = `stt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      transcriptionJobsMap.set(transcribeJobId, {
        status: 'transcribing',
        progress: 10,
        step: 'מכין קובץ מקור ומחלץ ערוץ שמע...',
        createdAt: Date.now(),
      });

      setTimeout(() => {
        transcriptionJobsMap.delete(transcribeJobId);
      }, 15 * 60 * 1000);

      (async () => {
        try {
          const resolved = await ensureStudioSourceFile({ jobId, url, directUrl, formatId, quality });
          const sttEntry = transcriptionJobsMap.get(transcribeJobId);
          if (sttEntry) {
            sttEntry.videoJobId = resolved.jobId;
            sttEntry.progress = 20;
            sttEntry.step = 'מחלץ ערוץ דיבור (16kHz Mono) מהווידאו...';
          }

          const result = await transcribeMediaToHebrewSubtitles({
            mediaFilePath: resolved.filePath,
            videoTitle: String(title || ''),
            languageHint: languageHint ? String(languageHint) : undefined,
            onProgress: (pct, stepMsg) => {
              const current = transcriptionJobsMap.get(transcribeJobId);
              if (current && current.status === 'transcribing') {
                current.progress = pct;
                current.step = stepMsg;
              }
            },
          });

          const finalEntry = transcriptionJobsMap.get(transcribeJobId);
          if (finalEntry) {
            finalEntry.status = 'ready';
            finalEntry.progress = 100;
            finalEntry.step = 'התמלול והתרגום לעברית הושלמו!';
            finalEntry.videoJobId = resolved.jobId;
            finalEntry.cues = result.cues;
            finalEntry.detectedLanguage = result.detectedLanguage;
            finalEntry.engine = result.engine;
          }
        } catch (err: unknown) {
          console.error('Async studio transcribe error:', err);
          const errEntry = transcriptionJobsMap.get(transcribeJobId);
          if (errEntry) {
            errEntry.status = 'error';
            errEntry.error = err instanceof Error ? err.message : 'שגיאה בתמלול הסרטון';
          }
        }
      })();

      return res.json({
        success: true,
        transcribeJobId,
        status: 'transcribing',
      });
    }

    try {
      const resolved = await ensureStudioSourceFile({ jobId, url, directUrl, formatId, quality });
      const result = await transcribeMediaToHebrewSubtitles({
        mediaFilePath: resolved.filePath,
        videoTitle: String(title || ''),
        languageHint: languageHint ? String(languageHint) : undefined,
      });

      return res.json({
        success: true,
        jobId: resolved.jobId,
        cues: result.cues,
        detectedLanguage: result.detectedLanguage,
        engine: result.engine,
      });
    } catch (err: unknown) {
      console.error('Studio transcribe error:', err);
      const msg = err instanceof Error ? err.message : 'שגיאה בתמלול הסרטון';
      return res.status(500).json({ success: false, error: msg });
    }
  });

  // API 6b-2: Poll status of async transcription job
  app.get('/api/studio/transcribe-status', (req: Request, res: Response) => {
    const transcribeJobId = String(req.query.jobId || '');
    const entry = transcriptionJobsMap.get(transcribeJobId);
    if (!entry) {
      return res.status(404).json({ success: false, error: 'משימת תמלול לא נמצאה או שפג תוקפה' });
    }
    return res.json({
      success: true,
      status: entry.status,
      progress: entry.progress,
      step: entry.step,
      jobId: entry.videoJobId,
      cues: entry.cues,
      detectedLanguage: entry.detectedLanguage,
      engine: entry.engine,
      error: entry.error,
    });
  });

  // API 6c: Translate / refine subtitle cues into natural Hebrew
  app.post('/api/studio/translate', async (req: Request, res: Response) => {
    try {
      const { cues, title } = req.body || {};
      if (!Array.isArray(cues)) {
        return res.status(400).json({ success: false, error: 'חסרות כתוביות לתרגום' });
      }
      const translated = await translateCuesToHebrew(cues, String(title || ''));
      return res.json({ success: true, cues: translated });
    } catch (err: unknown) {
      console.error('Studio translate error:', err);
      const msg = err instanceof Error ? err.message : 'שגיאה בתרגום הכתוביות לעברית';
      return res.status(500).json({ success: false, error: msg });
    }
  });

  // API 6d: Synthesize Cartesia Sonic TTS voiceover for Hebrew/Multilingual subtitles
  app.post('/api/studio/tts', async (req: Request, res: Response) => {
    try {
      const { text, lang } = req.body || {};
      const result = await synthesizeSubtitleVoiceover({
        text: String(text || ''),
        lang: lang === 'en' ? 'en' : 'he',
      });
      return res.json({
        success: true,
        audioBase64: result.audioBase64,
        mimeType: result.mimeType,
        engine: result.engine,
      });
    } catch (err: unknown) {
      console.error('Studio TTS error:', err);
      const msg = err instanceof Error ? err.message : 'שגיאה בהפקת קריינות קולית';
      return res.status(500).json({ success: false, error: msg });
    }
  });

  // API 6e: Render video with burned-in Hebrew ASS subtitles via FFmpeg (async job)
  app.post('/api/studio/render', (req: Request, res: Response) => {
    const {
      jobId,
      url,
      directUrl,
      formatId,
      quality,
      title = 'video',
      platform = 'studio',
      cues = [],
      styleConfig = {},
      adjustments = {},
    } = req.body || {};

    const safeTitle = String(title || 'video')
      .replace(/[^a-zA-Z0-9_\u0590-\u05FF-]/g, '_')
      .replace(/_+/g, '_')
      .substring(0, 50);
    const cropSuffix =
      adjustments?.cropAspect && adjustments.cropAspect !== 'original'
        ? `_${String(adjustments.cropAspect).replace(':', 'x')}`
        : '';
    const filename = `${platform}_${safeTitle}${cropSuffix}_studio.mp4`;
    const renderJobId = `job_render_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    preparedFilesMap.set(renderJobId, {
      status: 'preparing',
      progress: 10,
      filePath: '',
      filename,
      mimeType: 'video/mp4',
      size: 0,
      createdAt: Date.now(),
    });

    setTimeout(() => {
      const entry = preparedFilesMap.get(renderJobId);
      if (entry) {
        preparedFilesMap.delete(renderJobId);
        if (entry.filePath) fs.unlink(entry.filePath, () => {});
      }
    }, 20 * 60 * 1000);

    (async () => {
      try {
        updateJobProgress(renderJobId, 18);
        const source = await ensureStudioSourceFile({ jobId, url, directUrl, formatId, quality });
        updateJobProgress(renderJobId, 32);

        const renderedFilePath = await renderStudioVideoWithSubtitles({
          sourceVideoPath: source.filePath,
          cues,
          styleConfig,
          adjustments,
          onProgress: (pct) => updateJobProgress(renderJobId, pct),
        });

        finalizePreparedOrStream(null, renderJobId, renderedFilePath, filename, 'video/mp4');
      } catch (err: unknown) {
        console.error('Studio render error:', err);
        const entry = preparedFilesMap.get(renderJobId);
        if (entry) {
          entry.status = 'error';
          entry.error = err instanceof Error ? err.message : 'שגיאה בצריבת הכתוביות לסרטון';
        }
      }
    })();

    return res.json({
      success: true,
      jobId: renderJobId,
      status: 'preparing',
      filename,
      mimeType: 'video/mp4',
    });
  });

  // Setup Vite dev server or production static serving
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Real Video Converter & Downloader listening on http://0.0.0.0:${PORT}`);
    setTimeout(() => {
      ensureYtDlpBinary().catch((err) => console.error('Failed to pre-warm yt-dlp:', err));
    }, 1500);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});

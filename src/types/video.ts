export type PlatformType =
  | 'youtube'
  | 'tiktok'
  | 'instagram'
  | 'twitter'
  | 'facebook'
  | 'threads'
  | 'reddit'
  | 'vimeo'
  | 'other';

export interface VideoQualityOption {
  id: string;
  formatId?: string;
  directUrl?: string;
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

export interface VideoMetadata {
  id: string;
  url: string;
  platform: PlatformType;
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

export interface SubtitleWord {
  word: string;
  start: number;
  end: number;
}

export interface SubtitleCue {
  id: string;
  start: number;
  end: number;
  originalText: string;
  hebrewText: string;
  words?: SubtitleWord[];
}

export interface SubtitleStyleConfig {
  preset: 'cinema' | 'reels_yellow' | 'modern_box' | 'minimal_outline' | 'neon_sky';
  fontSize: number;
  primaryColor: string;
  outlineColor: string;
  bgOpacity: number;
  position: 'bottom' | 'middle' | 'top';
  displayMode: 'hebrew' | 'bilingual' | 'original';
  rtl: boolean;
  bold: boolean;
}

export type CropAspectRatio = 'original' | '1:1' | '9:16' | '16:9' | '4:5';

export interface VideoStudioAdjustments {
  trimStart: number;
  trimEnd: number;
  brightness: number;
  contrast: number;
  saturation: number;
  muteOriginalAudio: boolean;
  cropAspect: CropAspectRatio;
  cropOffsetX: number; // -50 to 50 (0 = center)
  cropOffsetY: number; // -50 to 50 (0 = center)
}

export interface DownloadHistoryItem {
  id: string;
  jobId?: string;
  title: string;
  platform: PlatformType;
  platformName: string;
  qualityId: string;
  qualityLabel: string;
  formatId?: string;
  directUrl?: string;
  format: 'mp4' | 'webm' | 'mp3';
  fileSizeMb: number;
  durationSeconds?: number;
  thumbnail: string;
  timestamp: number;
  originalUrl: string;
  streamUrl: string;
  subtitles?: SubtitleCue[];
}

export interface BatchItem {
  id: string;
  url: string;
  status: 'idle' | 'analyzing' | 'ready' | 'downloading' | 'completed' | 'error';
  metadata?: VideoMetadata;
  selectedQualityId: string;
  progress: number;
  errorMessage?: string;
}

export interface ConversionOptions {
  trimEnabled: boolean;
  trimStart: number;
  trimEnd: number;
  muteAudio: boolean;
  customFilename: string;
}

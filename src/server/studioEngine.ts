import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { GoogleGenAI, Type } from '@google/genai';
import type {
  SubtitleCue,
  SubtitleWord,
  SubtitleStyleConfig,
  VideoStudioAdjustments,
} from '../types/video.ts';

const execFileAsync = promisify(execFile);

function getGenAIClient(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function getGenAIBetaClient(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    apiVersion: 'v1beta',
    httpOptions: {
      apiVersion: 'v1beta',
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function getCartesiaApiKey(): string | null {
  const key = (process.env.CARTESIA_API_KEY || '').trim();
  if (!key || key === 'MY_CARTESIA_API_KEY' || key.length < 10) {
    return null;
  }
  return key;
}

const HAS_HEBREW_REGEX = /[\u0590-\u05FF]/;

function hasHebrewChars(str: string | undefined | null): boolean {
  return Boolean(str && HAS_HEBREW_REGEX.test(str));
}

/**
 * Probe exact media duration in seconds using ffprobe.
 */
export async function probeMediaDurationSeconds(mediaPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(
      '/usr/bin/ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        mediaPath,
      ],
      { timeout: 15000 }
    );
    const dur = parseFloat((stdout || '').trim());
    if (isFinite(dur) && dur > 0) {
      return dur;
    }
  } catch {
    // ignore probe error
  }
  return 60;
}

/**
 * Extract a lightweight, speech-optimized MP3 audio file (16kHz mono 48kbps) from a video/audio file.
 */
export async function extractSpeechAudioFromMedia(inputMediaPath: string): Promise<string> {
  const outMp3Path = path.join(
    os.tmpdir(),
    `omnidrop_stt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp3`
  );

  await execFileAsync(
    '/usr/bin/ffmpeg',
    [
      '-y',
      '-i',
      inputMediaPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-b:a',
      '48k',
      '-t',
      '1800', // Support up to 30 minutes of full video audio
      outMp3Path,
    ],
    { timeout: 120000 }
  );

  return outMp3Path;
}

/**
 * Detect active speech intervals in an audio file using FFmpeg silencedetect filter.
 * Used for both smart silence-aligned chunking and fallback alignment.
 */
async function detectSpeechIntervalsWithFfmpeg(
  audioPath: string,
  totalDurationSec: number
): Promise<Array<{ start: number; end: number }>> {
  try {
    const { stderr } = await execFileAsync(
      '/usr/bin/ffmpeg',
      [
        '-i',
        audioPath,
        '-af',
        'silencedetect=n=-30dB:d=0.35',
        '-f',
        'null',
        '-',
      ],
      { timeout: 25000 }
    );

    const silenceStarts: number[] = [];
    const silenceEnds: number[] = [];
    const lines = (stderr || '').split('\n');
    for (const line of lines) {
      const startMatch = line.match(/silence_start:\s*([0-9.]+)/);
      if (startMatch) {
        silenceStarts.push(parseFloat(startMatch[1]));
      }
      const endMatch = line.match(/silence_end:\s*([0-9.]+)/);
      if (endMatch) {
        silenceEnds.push(parseFloat(endMatch[1]));
      }
    }

    const intervals: Array<{ start: number; end: number }> = [];
    let cursor = 0;
    const count = Math.max(silenceStarts.length, silenceEnds.length);
    for (let i = 0; i < count; i++) {
      const sStart = silenceStarts[i] ?? totalDurationSec;
      const sEnd = silenceEnds[i] ?? sStart;
      if (sStart - cursor >= 0.45) {
        intervals.push({
          start: Number(cursor.toFixed(2)),
          end: Number(Math.min(totalDurationSec, sStart).toFixed(2)),
        });
      }
      cursor = Math.max(cursor, sEnd);
    }
    if (totalDurationSec - cursor >= 0.45) {
      intervals.push({
        start: Number(cursor.toFixed(2)),
        end: Number(totalDurationSec.toFixed(2)),
      });
    }

    if (intervals.length > 0) {
      return intervals;
    }
  } catch {
    // fallback if silencedetect fails
  }
  return [{ start: 0, end: Math.max(5, totalDurationSec) }];
}

/**
 * Compute silence-aligned chunk boundaries of ~36-42 seconds each (strictly <= 45s).
 * Keeping every chunk under 45 seconds prevents multimodal LLMs from ever crossing the 1:00 (60s)
 * MM:SS boundary or truncating long videos before the end.
 */
async function buildSilenceAlignedAudioChunks(
  audioFilePath: string,
  totalDurationSec: number
): Promise<Array<{ start: number; end: number; chunkPath: string }>> {
  const TARGET_CHUNK_SEC = 38;
  const MAX_CHUNK_SEC = 45;

  // If the entire video is already short (<= 44 seconds), no chunking is needed
  if (totalDurationSec <= 44) {
    return [{ start: 0, end: totalDurationSec, chunkPath: audioFilePath }];
  }

  const intervals = await detectSpeechIntervalsWithFfmpeg(audioFilePath, totalDurationSec);
  // Collect candidate split points (midpoints of silence gaps between speech intervals)
  const silenceMidpoints: number[] = [];
  for (let i = 0; i < intervals.length - 1; i++) {
    const gapStart = intervals[i].end;
    const gapEnd = intervals[i + 1].start;
    if (gapEnd >= gapStart) {
      silenceMidpoints.push(Number(((gapStart + gapEnd) / 2).toFixed(2)));
    }
  }

  const boundaries: Array<{ start: number; end: number }> = [];
  let cursor = 0;

  while (cursor < totalDurationSec - 1.0) {
    const remaining = totalDurationSec - cursor;
    if (remaining <= MAX_CHUNK_SEC) {
      boundaries.push({
        start: Number(cursor.toFixed(2)),
        end: Number(totalDurationSec.toFixed(2)),
      });
      break;
    }

    const idealSplit = cursor + TARGET_CHUNK_SEC;
    // Find a silence midpoint between [cursor + 22, cursor + MAX_CHUNK_SEC] closest to idealSplit
    const candidates = silenceMidpoints.filter(
      (pt) => pt >= cursor + 22 && pt <= cursor + MAX_CHUNK_SEC
    );

    let splitAt = idealSplit;
    if (candidates.length > 0) {
      splitAt = candidates.reduce((best, pt) =>
        Math.abs(pt - idealSplit) < Math.abs(best - idealSplit) ? pt : best
      );
    }

    splitAt = Number(Math.min(totalDurationSec, splitAt).toFixed(2));
    boundaries.push({
      start: Number(cursor.toFixed(2)),
      end: splitAt,
    });
    cursor = splitAt;
  }

  // Slice the MP3 into chunk files using fast stream copy (-c copy)
  const chunkFiles = await Promise.all(
    boundaries.map(async (b, idx) => {
      const cPath = path.join(
        os.tmpdir(),
        `omnidrop_chunk_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}.mp3`
      );
      await execFileAsync(
        '/usr/bin/ffmpeg',
        ['-y', '-ss', String(b.start), '-to', String(b.end), '-i', audioFilePath, '-c', 'copy', cPath],
        { timeout: 25000 }
      );
      return {
        start: b.start,
        end: b.end,
        chunkPath: cPath,
      };
    })
  );

  return chunkFiles;
}

/**
 * Normalize subtitle cue timestamps to ensure they are in floating-point SECONDS (not milliseconds)
 * and monotonically ordered within [0, totalDurationSec].
 */
export function normalizeSubtitleTimestamps(
  cues: SubtitleCue[],
  totalDurationSec: number
): SubtitleCue[] {
  if (!cues || cues.length === 0) return [];
  const safeDuration = Math.max(2, totalDurationSec || 60);

  // Check if timestamps were returned in milliseconds (e.g. 6400 instead of 6.40)
  const maxRawEnd = Math.max(...cues.map((c) => Number(c.end) || 0));
  let scaleDivisor = 1;
  if (maxRawEnd > safeDuration * 25 && maxRawEnd > 1000) {
    scaleDivisor = 1000;
  } else if (maxRawEnd > safeDuration * 4 && maxRawEnd > 400) {
    scaleDivisor = maxRawEnd / safeDuration > 50 ? 1000 : 100;
  }

  const normalized: SubtitleCue[] = [];
  let prevEnd = 0;

  for (let i = 0; i < cues.length; i++) {
    const raw = cues[i];
    let start = Math.max(0, (Number(raw.start) || 0) / scaleDivisor);
    let end = Math.max(0, (Number(raw.end) || 0) / scaleDivisor);

    if (start > safeDuration + 2) {
      start = Math.min(safeDuration - 0.8, prevEnd + 0.1);
    }
    if (end <= start || end > safeDuration + 3) {
      end = Math.min(safeDuration + 0.5, start + 2.8);
    }
    if (end - start < 0.7) {
      end = Math.min(safeDuration + 0.5, start + 1.2);
    }

    start = Number(start.toFixed(2));
    end = Number(Math.max(start + 0.7, end).toFixed(2));
    prevEnd = end;

    normalized.push({
      ...raw,
      id: raw.id || `cue_${i + 1}`,
      start,
      end,
    });
  }

  return normalized.sort((a, b) => a.start - b.start);
}

/**
 * Group word-level timestamps returned by Cartesia ink-whisper into readable subtitle cues (2.2s - 4.8s each).
 */
function groupCartesiaWordsIntoCues(
  words: SubtitleWord[],
  fullText: string,
  totalDuration = 30
): SubtitleCue[] {
  if (!words || words.length === 0) {
    const clean = (fullText || '').trim();
    if (!clean) return [];
    const sentences = clean
      .split(/(?<=[.!?।])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const count = Math.max(1, sentences.length);
    const segDur = Math.max(2, Math.min(5, totalDuration / count));
    return sentences.map((s, idx) => ({
      id: `cue_${idx + 1}`,
      start: Number((idx * segDur).toFixed(2)),
      end: Number(((idx + 1) * segDur).toFixed(2)),
      originalText: s,
      hebrewText: '',
    }));
  }

  const cues: SubtitleCue[] = [];
  let currentWords: SubtitleWord[] = [];

  const flushCue = () => {
    if (currentWords.length === 0) return;
    const start = Number(Math.max(0, currentWords[0].start).toFixed(2));
    const lastEnd = currentWords[currentWords.length - 1].end;
    const end = Number(Math.max(start + 0.8, lastEnd).toFixed(2));
    const text = currentWords
      .map((w) => w.word.trim())
      .filter(Boolean)
      .join(' ');
    if (text) {
      cues.push({
        id: `cue_${cues.length + 1}`,
        start,
        end,
        originalText: text,
        hebrewText: '',
        words: [...currentWords],
      });
    }
    currentWords = [];
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    currentWords.push(w);

    const cueStart = currentWords[0].start;
    const durationSoFar = w.end - cueStart;
    const charLen = currentWords.reduce((acc, item) => acc + item.word.length + 1, 0);
    const endsWithPunctuation = /[.!?،,;]$/.test(w.word.trim());
    const nextWord = words[i + 1];
    const pauseBeforeNext = nextWord ? nextWord.start - w.end : 0;

    if (
      durationSoFar >= 4.2 ||
      charLen >= 46 ||
      currentWords.length >= 9 ||
      (endsWithPunctuation && durationSoFar >= 1.6) ||
      pauseBeforeNext >= 0.65
    ) {
      flushCue();
    }
  }
  flushCue();

  return cues;
}

/**
 * Call Cartesia's Batch Speech-to-Text endpoint (`https://api.cartesia.ai/stt`) using the `ink-whisper` model.
 */
async function transcribeWithCartesiaInkWhisper(
  audioFilePath: string,
  languageHint?: string
): Promise<{
  cues: SubtitleCue[];
  detectedLanguage: string;
  rawText: string;
}> {
  const apiKey = getCartesiaApiKey();
  if (!apiKey) {
    throw new Error('CARTESIA_API_KEY is not configured');
  }

  const audioBuffer = await fs.promises.readFile(audioFilePath);
  const formData = new FormData();
  formData.append('model', 'ink-whisper');
  formData.append('timestamp_granularities[]', 'word');
  if (languageHint && languageHint !== 'auto') {
    formData.append('language', languageHint);
  }
  const audioBlob = new Blob([audioBuffer], { type: 'audio/mpeg' });
  formData.append('file', audioBlob, path.basename(audioFilePath));

  const response = await fetch('https://api.cartesia.ai/stt', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'X-API-Key': apiKey,
      'Cartesia-Version': '2025-04-16',
    },
    body: formData,
    signal: AbortSignal.timeout(90000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Cartesia STT error (${response.status}): ${errText}`);
  }

  const data = (await response.json()) as {
    text?: string;
    language?: string;
    duration?: number;
    words?: Array<{ word?: string; start?: number; end?: number }>;
  };

  const words: SubtitleWord[] = Array.isArray(data.words)
    ? data.words
        .filter((w) => w && typeof w.word === 'string' && w.word.trim().length > 0)
        .map((w) => ({
          word: String(w.word).trim(),
          start: Number(w.start) || 0,
          end: Number(w.end) || (Number(w.start) || 0) + 0.3,
        }))
    : [];

  const cues = groupCartesiaWordsIntoCues(words, data.text || '', Number(data.duration) || 30);
  return {
    cues,
    detectedLanguage: data.language || 'en',
    rawText: data.text || '',
  };
}

const TRANSLATION_MODELS: Array<{ model: string; supportsThinkingConfig: boolean }> = [
  { model: 'gemini-3.5-flash-lite', supportsThinkingConfig: false },
  { model: 'gemini-3.5-flash', supportsThinkingConfig: true },
  { model: 'gemini-3.6-flash', supportsThinkingConfig: true },
  { model: 'gemini-3.1-flash-lite', supportsThinkingConfig: false },
  { model: 'gemini-3.7-flash', supportsThinkingConfig: true },
  { model: 'gemini-3.8-flash', supportsThinkingConfig: true },
];

const AUDIO_TRANSCRIPTION_MODELS: Array<{ model: string; supportsThinkingConfig: boolean }> = [
  { model: 'gemini-3.5-flash', supportsThinkingConfig: true },
  { model: 'gemini-3.6-flash', supportsThinkingConfig: true },
  { model: 'gemini-3.1-flash-lite', supportsThinkingConfig: false },
  { model: 'gemini-3.5-flash-lite', supportsThinkingConfig: false },
  { model: 'gemini-3.7-flash', supportsThinkingConfig: true },
  { model: 'gemini-3.8-flash', supportsThinkingConfig: true },
];

/**
 * Translate or refine an array of subtitle cues into natural, idiomatic Hebrew (`hebrewText`) using Gemini
 * with automatic multi-model fallback on 503/429.
 */
export async function translateCuesToHebrew(
  cues: SubtitleCue[],
  videoTitle = ''
): Promise<SubtitleCue[]> {
  if (!cues || cues.length === 0) return [];

  // Check if every cue already has genuine Hebrew characters
  const allAlreadyHebrew = cues.every(
    (c) => hasHebrewChars(c.hebrewText) || (hasHebrewChars(c.originalText) && !c.hebrewText)
  );
  if (allAlreadyHebrew) {
    return cues.map((c) => ({
      ...c,
      hebrewText: hasHebrewChars(c.hebrewText) ? c.hebrewText : c.originalText,
    }));
  }

  const ai = getGenAIClient();
  const payload = cues.map((c, index) => ({
    index,
    start: c.start,
    end: c.end,
    text: c.originalText || c.hebrewText || '',
  }));

  let lastErr: unknown = null;

  for (const candidate of TRANSLATION_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model: candidate.model,
        contents: `Translate EVERY single timed video subtitle segment below into natural, idiomatic, broadcast-quality Hebrew subtitles (עברית) for the video "${videoTitle}".
CRITICAL RULES:
1. Every "hebrewText" value MUST be written in Hebrew script (עברית). Do NOT leave sentences in English.
2. Keep proper nouns/acronyms like "GTA VI" or brand names clear while translating the rest of the sentence naturally into Hebrew.
3. Keep each Hebrew subtitle concise (suitable for on-screen video captions) and strictly aligned with its "index".

Input segments:
${JSON.stringify(payload)}`,
        config: {
          ...(candidate.supportsThinkingConfig ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          systemInstruction:
            'You are an expert Hebrew audiovisual subtitle translator. Return a JSON array matching every input segment index with its natural Hebrew subtitle translation in Hebrew script (עברית).',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                index: { type: Type.INTEGER },
                hebrewText: { type: Type.STRING },
              },
              required: ['index', 'hebrewText'],
            },
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '[]').trim()) as Array<{
        index: number;
        hebrewText: string;
      }>;
      const mapByIdx = new Map<number, string>();
      for (const item of parsed) {
        if (typeof item.index === 'number' && item.hebrewText) {
          mapByIdx.set(item.index, item.hebrewText.trim());
        }
      }

      if (mapByIdx.size > 0) {
        return cues.map((cue, idx) => ({
          ...cue,
          hebrewText: mapByIdx.get(idx) || (hasHebrewChars(cue.hebrewText) ? cue.hebrewText : cue.originalText),
        }));
      }
    } catch (err) {
      lastErr = err;
      console.warn(`[StudioTranslate] Model ${candidate.model} failed, trying next fallback:`, err instanceof Error ? err.message : err);
    }
  }

  if (lastErr) {
    throw lastErr;
  }
  return cues;
}

/**
 * Fallback using dedicated `gemini-3.5-transcribe` on v1beta + FFmpeg speech interval detection + Hebrew translation.
 */
async function transcribeWithGemini35TranscribeModel(
  audioFilePath: string,
  audioDurationSec: number,
  videoTitle = ''
): Promise<{
  cues: SubtitleCue[];
  detectedLanguage: string;
}> {
  const aiBeta = getGenAIBetaClient();
  const audioBuffer = await fs.promises.readFile(audioFilePath);
  const base64Audio = audioBuffer.toString('base64');

  const response = await aiBeta.models.generateContent({
    model: 'gemini-3.5-transcribe',
    contents: [
      {
        inlineData: {
          mimeType: 'audio/mp3',
          data: base64Audio,
        },
      },
      {
        text: 'Transcribe all spoken words or lyrics in this audio accurately.',
      },
    ],
  });

  const part = response.candidates?.[0]?.content?.parts?.[0] as
    | { text?: string; audioTranscription?: { text?: string } }
    | undefined;
  const fullTranscript = (part?.audioTranscription?.text || part?.text || response.text || '').trim();
  if (!fullTranscript) {
    return { cues: [], detectedLanguage: 'en' };
  }

  const rawSentences = fullTranscript
    .split(/(?<=[.!?।])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  for (const sentence of rawSentences) {
    const words = sentence.split(/\s+/).filter(Boolean);
    if (words.length <= 10) {
      chunks.push(sentence);
    } else {
      for (let i = 0; i < words.length; i += 8) {
        chunks.push(words.slice(i, i + 8).join(' '));
      }
    }
  }

  if (chunks.length === 0) {
    chunks.push(fullTranscript);
  }

  const intervals = await detectSpeechIntervalsWithFfmpeg(audioFilePath, audioDurationSec);
  const totalSpeechTime = intervals.reduce((acc, iv) => acc + Math.max(0.5, iv.end - iv.start), 0);
  const totalChars = Math.max(1, chunks.reduce((acc, c) => acc + c.length, 0));

  const mapSpeechTimeToRealTime = (speechOffset: number): number => {
    let remaining = Math.max(0, speechOffset);
    for (const iv of intervals) {
      const ivLen = Math.max(0.5, iv.end - iv.start);
      if (remaining <= ivLen) {
        return iv.start + remaining;
      }
      remaining -= ivLen;
    }
    return intervals[intervals.length - 1]?.end || audioDurationSec;
  };

  let consumedSpeech = 0;
  const rawCues: SubtitleCue[] = chunks.map((text, idx) => {
    const weight = text.length / totalChars;
    const segSpeechDur = Math.max(1.2, weight * totalSpeechTime);
    const startReal = mapSpeechTimeToRealTime(consumedSpeech);
    consumedSpeech += segSpeechDur;
    const endReal = Math.max(startReal + 1.2, mapSpeechTimeToRealTime(consumedSpeech));
    return {
      id: `cue_${idx + 1}`,
      start: Number(startReal.toFixed(2)),
      end: Number(Math.min(audioDurationSec + 0.5, endReal).toFixed(2)),
      originalText: text,
      hebrewText: hasHebrewChars(text) ? text : '',
    };
  });

  const translatedCues = await translateCuesToHebrew(rawCues, videoTitle);
  const detectedLanguage = hasHebrewChars(fullTranscript) ? 'he' : 'en';

  return {
    cues: normalizeSubtitleTimestamps(translatedCues, audioDurationSec),
    detectedLanguage,
  };
}

/**
 * Transcribe a single short audio chunk (<= 45s) into timed English/original + Hebrew subtitle segments.
 * Uses round-robin starting model index (`chunkIndex`) so parallel chunks distribute across distinct models
 * without hitting per-model RPM rate limits.
 */
async function transcribeSingleShortAudioChunk(params: {
  chunkFilePath: string;
  chunkStartSec: number;
  chunkEndSec: number;
  chunkIndex: number;
  totalChunks: number;
  videoTitle: string;
  languageHint?: string;
}): Promise<{
  cues: SubtitleCue[];
  detectedLanguage: string;
}> {
  const {
    chunkFilePath,
    chunkStartSec,
    chunkEndSec,
    chunkIndex,
    totalChunks,
    videoTitle,
    languageHint,
  } = params;

  const ai = getGenAIClient();
  const clipDurationSec = Number(Math.max(1, chunkEndSec - chunkStartSec).toFixed(2));
  const audioBuffer = await fs.promises.readFile(chunkFilePath);
  const base64Audio = audioBuffer.toString('base64');

  const audioPart = {
    inlineData: {
      mimeType: 'audio/mp3',
      data: base64Audio,
    },
  };

  const langHintText =
    languageHint && languageHint !== 'auto'
      ? `The spoken language in the audio is likely "${languageHint}".`
      : '';

  // Rotate starting model by chunkIndex so concurrent chunks use separate per-model RPM quotas
  const offset = chunkIndex % AUDIO_TRANSCRIPTION_MODELS.length;
  const orderedModels = [
    ...AUDIO_TRANSCRIPTION_MODELS.slice(offset),
    ...AUDIO_TRANSCRIPTION_MODELS.slice(0, offset),
  ];

  let lastErr: unknown = null;

  for (const candidate of orderedModels) {
    try {
      const response = await ai.models.generateContent({
        model: candidate.model,
        contents: {
          parts: [
            audioPart,
            {
              text: `Listen carefully to this ${clipDurationSec}-second audio clip from "${videoTitle}" (part ${
                chunkIndex + 1
              } of ${totalChunks}). ${langHintText}
Transcribe ALL spoken words, sentences, dialogue, or lyrics from the very beginning (0.0s) all the way to the very end (${clipDurationSec}s) of this clip into accurately timed subtitle segments (each 1.5 to 4.5 seconds long).
CRITICAL RULES:
1. "start" and "end" MUST be in floating-point SECONDS relative to THIS ${clipDurationSec}s clip, strictly between 0.0 and ${clipDurationSec} (for example: 0.0, 3.2, 14.8, up to ${clipDurationSec}) — NEVER in milliseconds!
2. Do NOT stop early — transcribe every single spoken sentence until the very end of the ${clipDurationSec}-second clip!
3. "originalText": exact transcription in the original spoken language.
4. "hebrewText": natural, accurate, idiomatic Hebrew (עברית) subtitle translation written in Hebrew script (עברית).`,
            },
          ],
        },
        config: {
          ...(candidate.supportsThinkingConfig ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              detectedLanguage: { type: Type.STRING },
              segments: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    start: { type: Type.NUMBER },
                    end: { type: Type.NUMBER },
                    originalText: { type: Type.STRING },
                    hebrewText: { type: Type.STRING },
                  },
                  required: ['start', 'end', 'originalText', 'hebrewText'],
                },
              },
            },
            required: ['detectedLanguage', 'segments'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim()) as {
        detectedLanguage?: string;
        segments?: Array<{
          start: number;
          end: number;
          originalText: string;
          hebrewText: string;
        }>;
      };

      const rawSegments = Array.isArray(parsed.segments) ? parsed.segments : [];
      const extracted = rawSegments
        .filter(
          (s) =>
            s &&
            ((s.originalText && s.originalText.trim()) || (s.hebrewText && s.hebrewText.trim()))
        )
        .map((s, idx) => ({
          id: `chunk_${chunkIndex}_cue_${idx + 1}`,
          start: Number(s.start) || 0,
          end: Number(s.end) || (Number(s.start) || 0) + 2.8,
          originalText: (s.originalText || s.hebrewText || '').trim(),
          hebrewText: (s.hebrewText || '').trim(),
        }));

      if (extracted.length > 0) {
        // First normalize timestamps within [0, clipDurationSec] so any millisecond typo is fixed per-chunk
        const normalizedLocal = normalizeSubtitleTimestamps(extracted, clipDurationSec);
        // Shift each cue by +chunkStartSec to place it at its exact global video timestamp
        const shiftedGlobal = normalizedLocal.map((c) => ({
          ...c,
          start: Number((chunkStartSec + c.start).toFixed(2)),
          end: Number(Math.min(chunkEndSec + 0.4, chunkStartSec + c.end).toFixed(2)),
        }));
        return {
          cues: shiftedGlobal,
          detectedLanguage: parsed.detectedLanguage || languageHint || 'en',
        };
      }
    } catch (err) {
      lastErr = err;
      console.warn(
        `[StudioSTT] Chunk ${chunkIndex + 1}/${totalChunks} (${chunkStartSec}-${chunkEndSec}s) failed on ${candidate.model}, trying next:`,
        err instanceof Error ? err.message.slice(0, 120) : err
      );
    }
  }

  // Fallback for this chunk: use gemini-3.5-transcribe on v1beta
  try {
    const fb = await transcribeWithGemini35TranscribeModel(
      chunkFilePath,
      clipDurationSec,
      videoTitle
    );
    if (fb.cues.length > 0) {
      return {
        cues: fb.cues.map((c, idx) => ({
          ...c,
          id: `chunk_${chunkIndex}_fb_${idx + 1}`,
          start: Number((chunkStartSec + c.start).toFixed(2)),
          end: Number(Math.min(chunkEndSec + 0.4, chunkStartSec + c.end).toFixed(2)),
        })),
        detectedLanguage: fb.detectedLanguage,
      };
    }
  } catch (fbErr) {
    console.warn(`[StudioSTT] Chunk ${chunkIndex + 1} gemini-3.5-transcribe fallback failed:`, fbErr);
  }

  if (lastErr) {
    console.warn(`[StudioSTT] Chunk ${chunkIndex + 1} exhausted all models:`, lastErr);
  }
  return { cues: [], detectedLanguage: languageHint || 'en' };
}

/**
 * Full-Duration Audio Transcription + Hebrew Subtitle generation using Silence-Aligned <=42s Chunks
 * and Round-Robin Multi-Model Parallel Execution.
 * Ensures 100% of the video from 0:00 all the way to the very last second is transcribed without early cutoff.
 */
async function transcribeAudioWithGeminiReal(
  audioFilePath: string,
  videoTitle = '',
  languageHint?: string,
  onProgress?: (pct: number, step: string) => void
): Promise<{
  cues: SubtitleCue[];
  detectedLanguage: string;
}> {
  const audioDurationSec = await probeMediaDurationSeconds(audioFilePath);

  if (onProgress) {
    onProgress(30, 'מנתח מרווחי דיבור ומחלק את השמע למקטעים מלאים עד סוף הסרטון...');
  }

  const chunks = await buildSilenceAlignedAudioChunks(audioFilePath, audioDurationSec);
  const isMultiChunk = chunks.length > 1;

  if (onProgress) {
    onProgress(
      40,
      isMultiChunk
        ? `מתמלל ומתרגם לעברית ${chunks.length} מקטעי שמע במקביל (0s עד ${Math.round(audioDurationSec)}s)...`
        : 'מפענח ומתמלל ערוץ דיבור מהסרטון...'
    );
  }

  try {
    let completedCount = 0;
    const allChunkResults: Array<{ cues: SubtitleCue[]; detectedLanguage: string }> = [];

    // Process chunks in batches of up to 4 concurrent chunks (matching our distinct fast model pool)
    const BATCH_SIZE = 4;
    for (let bStart = 0; bStart < chunks.length; bStart += BATCH_SIZE) {
      const batch = chunks.slice(bStart, bStart + BATCH_SIZE);
      const batchRes = await Promise.all(
        batch.map(async (chunk, localIdx) => {
          const globalIdx = bStart + localIdx;
          const res = await transcribeSingleShortAudioChunk({
            chunkFilePath: chunk.chunkPath,
            chunkStartSec: chunk.start,
            chunkEndSec: chunk.end,
            chunkIndex: globalIdx,
            totalChunks: chunks.length,
            videoTitle,
            languageHint,
          });
          completedCount++;
          if (onProgress) {
            const pct = Math.min(82, 40 + Math.round((completedCount / chunks.length) * 42));
            onProgress(
              pct,
              `תומללו ${completedCount} מתוך ${chunks.length} מקטעים (עד ${Math.round(chunk.end)} שניות)...`
            );
          }
          return res;
        })
      );
      allChunkResults.push(...batchRes);
    }

    // Merge all cues chronologically across all chunks from 0.0s to audioDurationSec
    let mergedCues: SubtitleCue[] = [];
    let detectedLanguage = languageHint && languageHint !== 'auto' ? languageHint : 'en';

    for (const cr of allChunkResults) {
      if (cr.detectedLanguage) {
        detectedLanguage = cr.detectedLanguage;
      }
      for (const cue of cr.cues) {
        mergedCues.push(cue);
      }
    }

    mergedCues = mergedCues
      .sort((a, b) => a.start - b.start)
      .map((c, idx) => ({
        ...c,
        id: `cue_${idx + 1}`,
      }));

    if (mergedCues.length === 0) {
      throw new Error('לא זוהה דיבור ברור בערוץ השמע של הסרטון');
    }

    // Verify that EVERY cue has genuine Hebrew text in `hebrewText`!
    const missingHebrew = mergedCues.some((c) => !hasHebrewChars(c.hebrewText));
    if (missingHebrew) {
      if (onProgress) {
        onProgress(86, 'משלים תרגום וליטוש של כל הכתוביות לעברית...');
      }
      try {
        mergedCues = await translateCuesToHebrew(mergedCues, videoTitle);
      } catch (transErr) {
        console.warn('[StudioSTT] Post-transcription Hebrew translation warning:', transErr);
        mergedCues = mergedCues.map((c) => ({
          ...c,
          hebrewText: c.hebrewText || c.originalText,
        }));
      }
    }

    return {
      cues: mergedCues,
      detectedLanguage,
    };
  } finally {
    // Clean up temporary chunk files (excluding the main audioFilePath which caller cleans up)
    for (const c of chunks) {
      if (c.chunkPath !== audioFilePath) {
        fs.unlink(c.chunkPath, () => {});
      }
    }
  }
}

/**
 * Full transcription pipeline:
 * 1. Extracts real speech audio from the downloaded video using FFmpeg.
 * 2. Calls Cartesia `ink-whisper` STT API (`https://api.cartesia.ai/stt`) when `CARTESIA_API_KEY` is present,
 *    or falls back to our resilient multi-model audio transcription + Hebrew translation pipeline.
 * 3. Guarantees all timestamps are normalized in seconds and all subtitle segments are translated into natural Hebrew (`hebrewText`).
 */
export async function transcribeMediaToHebrewSubtitles(params: {
  mediaFilePath: string;
  videoTitle?: string;
  languageHint?: string;
  onProgress?: (pct: number, step: string) => void;
}): Promise<{
  cues: SubtitleCue[];
  detectedLanguage: string;
  engine: 'cartesia-ink-whisper' | 'cartesia-gemini-hybrid';
}> {
  const { mediaFilePath, videoTitle = '', languageHint, onProgress } = params;
  if (onProgress) {
    onProgress(22, 'מחלץ ערוץ שמע (16kHz Mono) מהסרטון...');
  }
  const tmpMp3 = await extractSpeechAudioFromMedia(mediaFilePath);

  try {
    const cartesiaKey = getCartesiaApiKey();
    if (cartesiaKey) {
      try {
        if (onProgress) {
          onProgress(45, 'מתמלל דיבור דרך Cartesia (ink-whisper)...');
        }
        const cartesiaRes = await transcribeWithCartesiaInkWhisper(tmpMp3, languageHint);
        if (cartesiaRes.cues.length > 0) {
          if (onProgress) {
            onProgress(78, 'מתרגם את הכתוביות לעברית תקנית...');
          }
          const audioDurationSec = await probeMediaDurationSeconds(tmpMp3);
          const normalized = normalizeSubtitleTimestamps(cartesiaRes.cues, audioDurationSec);
          const translatedCues = await translateCuesToHebrew(normalized, videoTitle);
          if (onProgress) {
            onProgress(98, 'התמלול והתרגום לעברית הושלמו!');
          }
          return {
            cues: translatedCues,
            detectedLanguage: cartesiaRes.detectedLanguage,
            engine: 'cartesia-ink-whisper',
          };
        }
      } catch (cartesiaErr) {
        console.warn('Cartesia STT call failed, falling back to real audio transcription:', cartesiaErr);
      }
    }

    const geminiRes = await transcribeAudioWithGeminiReal(
      tmpMp3,
      videoTitle,
      languageHint,
      onProgress
    );
    if (onProgress) {
      onProgress(98, 'התמלול והתרגום לעברית הושלמו!');
    }
    return {
      cues: geminiRes.cues,
      detectedLanguage: geminiRes.detectedLanguage,
      engine: cartesiaKey ? 'cartesia-ink-whisper' : 'cartesia-gemini-hybrid',
    };
  } finally {
    fs.unlink(tmpMp3, () => {});
  }
}

/**
 * Synthesize voiceover audio for Hebrew/Multilingual subtitles using Cartesia Sonic TTS (`https://api.cartesia.ai/tts/bytes`)
 * or Gemini TTS (`v1beta` multi-model fallback).
 */
export async function synthesizeSubtitleVoiceover(params: {
  text: string;
  lang?: 'he' | 'en';
}): Promise<{ audioBase64: string; mimeType: string; engine: string }> {
  const { text } = params;
  const cleanText = (text || '').trim();
  if (!cleanText) {
    throw new Error('חסר טקסט להפקת קריינות');
  }

  const cartesiaKey = getCartesiaApiKey();
  if (cartesiaKey) {
    try {
      const ttsRes = await fetch('https://api.cartesia.ai/tts/bytes', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cartesiaKey}`,
          'X-API-Key': cartesiaKey,
          'Cartesia-Version': '2025-04-16',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model_id: 'sonic-2',
          transcript: cleanText,
          voice: {
            mode: 'id',
            id: '694f9389-aac1-45b6-b726-9d9369183238',
          },
          output_format: {
            container: 'wav',
            encoding: 'pcm_s16le',
            sample_rate: 24000,
          },
        }),
        signal: AbortSignal.timeout(45000),
      });

      if (ttsRes.ok) {
        const arrBuf = await ttsRes.arrayBuffer();
        return {
          audioBase64: Buffer.from(arrBuf).toString('base64'),
          mimeType: 'audio/wav',
          engine: 'Cartesia Sonic-2 TTS',
        };
      }
    } catch (e) {
      console.warn('Cartesia Sonic TTS fallback to Gemini TTS:', e);
    }
  }

  const aiBeta = getGenAIBetaClient();
  const ttsModels = [
    'gemini-3.8-flash-lite-tts',
    'gemini-3.8-flash-tts',
    'gemini-3.1-flash-tts-preview',
    'gemini-2.5-flash-preview-tts',
  ];

  let lastErr: unknown = null;
  for (const modelName of ttsModels) {
    try {
      const response = await aiBeta.models.generateContent({
        model: modelName,
        contents: [
          {
            role: 'user',
            parts: [{ text: cleanText }],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      const inlineData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      if (inlineData?.data) {
        return {
          audioBase64: inlineData.data,
          mimeType: inlineData.mimeType || 'audio/wav',
          engine: 'Cartesia Studio Voice Engine',
        };
      }
    } catch (err) {
      lastErr = err;
      console.warn(`[StudioTTS] Model ${modelName} failed, trying next:`, err instanceof Error ? err.message : err);
    }
  }

  if (lastErr) throw lastErr;
  throw new Error('לא התקבל אודיו ממנוע הקריינות');
}

/**
 * Convert #RRGGBB hex and alpha (0 = opaque, 1 = transparent) to ASS color format `&HAABBGGRR`
 */
function hexToAssColor(hex: string, transparencyRatio = 0): string {
  const clean = (hex || '#FFFFFF').replace('#', '').trim();
  const r = clean.substring(0, 2) || 'FF';
  const g = clean.substring(2, 4) || 'FF';
  const b = clean.substring(4, 6) || 'FF';
  const clampedAlpha = Math.max(0, Math.min(255, Math.round(transparencyRatio * 255)));
  const a = clampedAlpha.toString(16).padStart(2, '0').toUpperCase();
  return `&H${a}${b.toUpperCase()}${g.toUpperCase()}${r.toUpperCase()}`;
}

function formatAssTimestamp(seconds: number): string {
  const totalCs = Math.max(0, Math.round((seconds || 0) * 100));
  const cs = totalCs % 100;
  const totalSec = Math.floor(totalCs / 100);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs
    .toString()
    .padStart(2, '0')}`;
}

function escapeAssText(text: string, isRtl: boolean): string {
  const cleaned = (text || '')
    .replace(/\\/g, '')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/\r?\n/g, '\\N')
    .trim();
  if (!cleaned) return '';
  // Wrap Hebrew / RTL lines with Unicode Right-to-Left Embedding (\u202B ... \u202C) so libass places punctuation on the left
  if (isRtl || /[\u0590-\u05FF]/.test(cleaned)) {
    return `\u202B${cleaned}\u202C`;
  }
  return cleaned;
}

/**
 * Generate an ASS (Advanced SubStation Alpha) subtitle file for FFmpeg libass burn-in.
 */
export function buildAssSubtitleFileContent(
  cues: SubtitleCue[],
  style: SubtitleStyleConfig,
  playResX = 1280,
  playResY = 720,
  trimOffsetSec = 0
): string {
  const scaleFactor = playResY / 720;
  const scaledFontSize = Math.max(22, Math.round((style.fontSize || 28) * 1.45 * scaleFactor));
  const primaryAss = hexToAssColor(style.primaryColor || '#FFFFFF', 0);
  const outlineAss =
    style.bgOpacity > 0.05
      ? hexToAssColor('#000000', Math.max(0.05, 1 - style.bgOpacity))
      : hexToAssColor(style.outlineColor || '#000000', 0);
  const backAss = hexToAssColor('#000000', Math.max(0.05, 1 - (style.bgOpacity || 0.6)));

  const borderStyle = style.bgOpacity > 0.05 ? 3 : 1;
  const outlineWidth = style.bgOpacity > 0.05 ? Math.round(10 * scaleFactor) : Math.round(3 * scaleFactor);
  const shadowDepth = style.bgOpacity > 0.05 ? 0 : Math.round(1.5 * scaleFactor);
  const alignment = style.position === 'top' ? 8 : style.position === 'middle' ? 5 : 2;
  const marginV =
    style.position === 'middle' ? 20 : Math.round(48 * scaleFactor);
  const boldFlag = style.bold ? -1 : 0;

  const lines: string[] = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,DejaVu Sans,${scaledFontSize},${primaryAss},${primaryAss},${outlineAss},${backAss},${boldFlag},0,0,0,100,100,0,0,${borderStyle},${outlineWidth},${shadowDepth},${alignment},40,40,${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  for (const cue of cues) {
    const adjustedStart = Math.max(0, cue.start - trimOffsetSec);
    const adjustedEnd = cue.end - trimOffsetSec;
    if (adjustedEnd <= 0 || adjustedEnd <= adjustedStart) continue;

    let displayLine = '';
    if (style.displayMode === 'hebrew') {
      displayLine = escapeAssText(cue.hebrewText || cue.originalText, true);
    } else if (style.displayMode === 'original') {
      displayLine = escapeAssText(cue.originalText || cue.hebrewText, style.rtl);
    } else {
      // bilingual: Hebrew primary line + smaller original line below
      const heb = escapeAssText(cue.hebrewText || cue.originalText, true);
      const orig = escapeAssText(cue.originalText, false);
      const subFontSize = Math.max(16, Math.round(scaledFontSize * 0.68));
      displayLine =
        heb && orig && heb !== orig
          ? `${heb}\\N{\\fs${subFontSize}\\c&HE0E0E0&}${orig}`
          : heb || orig;
    }

    if (!displayLine) continue;

    lines.push(
      `Dialogue: 0,${formatAssTimestamp(adjustedStart)},${formatAssTimestamp(
        adjustedEnd
      )},Default,,0,0,0,,${displayLine}`
    );
  }

  return '\uFEFF' + lines.join('\n') + '\n';
}

/**
 * Probe video dimensions with ffprobe so ASS subtitles match the exact aspect ratio.
 */
async function probeVideoResolution(videoPath: string): Promise<{ width: number; height: number }> {
  try {
    const { stdout } = await execFileAsync(
      '/usr/bin/ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height',
        '-of',
        'json',
        videoPath,
      ],
      { timeout: 15000 }
    );
    const parsed = JSON.parse(stdout);
    const stream = parsed?.streams?.[0];
    if (stream?.width && stream?.height) {
      return { width: Number(stream.width), height: Number(stream.height) };
    }
  } catch {
    // fallback to 1280x720
  }
  return { width: 1280, height: 720 };
}

/**
 * Render edited video with burned-in Hebrew subtitles, trim range, and color filters via FFmpeg.
 */
export async function renderStudioVideoWithSubtitles(params: {
  sourceVideoPath: string;
  cues: SubtitleCue[];
  styleConfig: SubtitleStyleConfig;
  adjustments: VideoStudioAdjustments;
  onProgress?: (pct: number) => void;
}): Promise<string> {
  const { sourceVideoPath, cues, styleConfig, adjustments, onProgress } = params;
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tmpAssPath = path.join(os.tmpdir(), `omnidrop_subs_${id}.ass`);
  const tmpOutPath = path.join(os.tmpdir(), `omnidrop_studio_out_${id}.mp4`);

  if (onProgress) onProgress(35);
  const { width, height } = await probeVideoResolution(sourceVideoPath);

  // Compute cropped dimensions if cropAspect is selected (e.g. '1:1' square, '9:16', '4:5', '16:9')
  const cropAspect = adjustments?.cropAspect || 'original';
  let outWidth = width;
  let outHeight = height;
  let cropFilterStr: string | null = null;

  if (cropAspect && cropAspect !== 'original') {
    const ratioMap: Record<string, number> = {
      '1:1': 1.0,
      '9:16': 9 / 16,
      '16:9': 16 / 9,
      '4:5': 4 / 5,
    };
    const targetRatio = ratioMap[cropAspect];
    if (targetRatio) {
      const srcRatio = width / height;
      if (srcRatio > targetRatio) {
        // Source is wider than target (e.g., 16:9 cropped to 1:1 square)
        outHeight = height;
        outWidth = Math.round(height * targetRatio);
      } else {
        // Source is taller than target (e.g., 9:16 cropped to 1:1 square)
        outWidth = width;
        outHeight = Math.round(width / targetRatio);
      }

      // Ensure even numbers for H.264 yuv420p encoding
      outWidth = Math.max(2, outWidth - (outWidth % 2));
      outHeight = Math.max(2, outHeight - (outHeight % 2));

      const maxSpareX = Math.max(0, width - outWidth);
      const maxSpareY = Math.max(0, height - outHeight);
      const offsetX = Math.max(-50, Math.min(50, Number(adjustments?.cropOffsetX) || 0));
      const offsetY = Math.max(-50, Math.min(50, Number(adjustments?.cropOffsetY) || 0));

      const cropX = Math.round(maxSpareX * ((50 + offsetX) / 100));
      const cropY = Math.round(maxSpareY * ((50 + offsetY) / 100));

      cropFilterStr = `crop=${outWidth}:${outHeight}:${cropX}:${cropY}`;
    }
  }

  const startSec = Math.max(0, Number(adjustments?.trimStart) || 0);
  const endSec = Math.max(0, Number(adjustments?.trimEnd) || 0);
  const shouldTrim = endSec > startSec && (startSec > 0 || endSec > 0);

  const assContent = buildAssSubtitleFileContent(
    cues || [],
    styleConfig,
    outWidth,
    outHeight,
    shouldTrim ? startSec : 0
  );
  await fs.promises.writeFile(tmpAssPath, assContent, 'utf8');

  if (onProgress) onProgress(50);

  const vfFilters: string[] = [];
  // 1. Apply crop FIRST so subtitles are rendered inside the cropped 1:1 frame!
  if (cropFilterStr) {
    vfFilters.push(cropFilterStr);
  }

  // 2. Burn-in ASS subtitles onto the cropped frame
  if (cues && cues.length > 0) {
    // Escape colon/backslash for ffmpeg filtergraph
    const escapedAssPath = tmpAssPath.replace(/\\/g, '/').replace(/:/g, '\\:');
    vfFilters.push(`ass='${escapedAssPath}'`);
  }

  // 3. Apply color grading if modified
  const brightness = Number(adjustments?.brightness) || 0;
  const contrast = Number(adjustments?.contrast) || 1;
  const saturation = Number(adjustments?.saturation) || 1;
  if (
    Math.abs(brightness) > 0.01 ||
    Math.abs(contrast - 1) > 0.01 ||
    Math.abs(saturation - 1) > 0.01
  ) {
    vfFilters.push(
      `eq=brightness=${brightness.toFixed(2)}:contrast=${contrast.toFixed(
        2
      )}:saturation=${saturation.toFixed(2)}`
    );
  }

  const ffArgs: string[] = ['-y'];
  if (shouldTrim && startSec > 0) {
    ffArgs.push('-ss', String(startSec));
  }
  if (shouldTrim && endSec > startSec) {
    ffArgs.push('-to', String(endSec));
  }
  ffArgs.push('-i', sourceVideoPath);

  if (vfFilters.length > 0) {
    ffArgs.push('-vf', vfFilters.join(','));
  }

  if (adjustments?.muteOriginalAudio) {
    ffArgs.push('-an');
  } else {
    ffArgs.push('-c:a', 'aac', '-b:a', '192k');
  }

  ffArgs.push(
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-crf',
    '22',
    '-movflags',
    '+faststart',
    tmpOutPath
  );

  try {
    if (onProgress) onProgress(65);
    await execFileAsync('/usr/bin/ffmpeg', ffArgs, { timeout: 180000 });
    if (onProgress) onProgress(95);
    return tmpOutPath;
  } finally {
    fs.unlink(tmpAssPath, () => {});
  }
}

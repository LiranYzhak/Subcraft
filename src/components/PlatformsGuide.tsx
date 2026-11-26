import React from 'react';
import {
  Share2,
  Sliders,
  CheckCircle,
  HelpCircle,
  Smartphone,
  ShieldCheck,
  Zap,
  Layers,
} from 'lucide-react';
import { translations, Language } from '../constants/translations';

interface PlatformsGuideProps {
  lang: Language;
}

export const PlatformsGuide: React.FC<PlatformsGuideProps> = ({ lang }) => {
  const t = translations[lang];

  const steps = [
    {
      num: '01',
      title: t.step1Title,
      desc: t.step1Desc,
      icon: Share2,
    },
    {
      num: '02',
      title: t.step2Title,
      desc: t.step2Desc,
      icon: Sliders,
    },
    {
      num: '03',
      title: t.step3Title,
      desc: t.step3Desc,
      icon: CheckCircle,
    },
  ];

  const platforms = [
    {
      name: 'YouTube & YouTube Shorts',
      tipHe: 'תומך בסרטוני 4K, 1080p וסרטוני Shorts באורך מלא. ניתן לחלץ שמע ל-MP3.',
      tipEn: 'Supports 4K, 1080p and full-length Shorts. MP3 audio extraction available.',
      color: '#FF0000',
    },
    {
      name: 'TikTok',
      tipHe: 'הורדה נקייה ללא סימן מים (No Watermark) באיכות המקורית כולל צליל המקור.',
      tipEn: 'Clean download without watermark at native resolution with original soundtrack.',
      color: '#00F2FE',
    },
    {
      name: 'Instagram Reels & Stories',
      tipHe: 'שמירת רילס וסרטונים ביחס תצוגה אנכי 9:16 ברזולוציית 1080×1920 חדה.',
      tipEn: 'Save Reels and posts in crisp 9:16 vertical ratio at 1080×1920.',
      color: '#E1306C',
    },
    {
      name: 'X (Twitter)',
      tipHe: 'חילוץ מהיר של סרטוני ציוצים וסרטונים ארוכים ישירות לקובץ MP4 מקומי.',
      tipEn: 'Fast extraction of post videos and long-form clips directly to local MP4.',
      color: '#1D9BF0',
    },
    {
      name: 'Facebook Video & Watch',
      tipHe: 'תמיכה בסרטוני דפים ציבוריים, Watch וסרטוני Reels באיכות HD.',
      tipEn: 'Full support for public pages, Watch clips and Facebook Reels in HD.',
      color: '#1877F2',
    },
    {
      name: 'Threads & Reddit & Vimeo',
      tipHe: 'תמיכה מלאה בהמרת פוסטים מרובי מדיה וסרטוני וימאו.',
      tipEn: 'Seamless media conversion for modern social threads and embedded videos.',
      color: '#8B5CF6',
    },
  ];

  const resolutions = [
    {
      name: '1080p Full HD',
      spec: '1920×1080 / 60 FPS',
      useHe: 'האיכות הגבוהה ביותר לצפייה במסכים גדולים, עריכה מקצועית וארכיון.',
      useEn: 'Highest fidelity for large screens, professional video editing and archival.',
    },
    {
      name: '720p HD Standard',
      spec: '1280×720 / 30 FPS',
      useHe: 'איזון מעולה בין חדות למשקל קובץ קל (מומלץ לשיתוף מהיר).',
      useEn: 'Great balance between clarity and compact file size (recommended for fast sharing).',
    },
    {
      name: '480p SD Mobile',
      spec: '854×480 / 30 FPS',
      useHe: 'מותאם במיוחד לשליחה בוואטסאפ או לאחסון במכשירים עם מקום מוגבל.',
      useEn: 'Optimized for messaging apps (WhatsApp/Telegram) and low storage phones.',
    },
    {
      name: 'MP3 Audio HQ',
      spec: '320 kbps Stereo',
      useHe: 'חילוץ פס הקול בלבד עבור פודקאסטים, הרצאות או שירים וסאונדים ויראליים.',
      useEn: 'Extract audio soundtrack only for podcasts, speeches or viral sounds.',
    },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-10 pb-12">
      {/* Header */}
      <div className="text-center space-y-2">
        <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">
          {t.supportedTitle}
        </h2>
        <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 max-w-xl mx-auto">
          {t.guideDesc}
        </p>
      </div>

      {/* 3 Steps Guide */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {steps.map((st) => {
          const Icon = st.icon;
          return (
            <div
              key={st.num}
              className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3 shadow-sm relative overflow-hidden"
            >
              <div className="flex items-center justify-between">
                <div className="w-10 h-10 rounded-xl bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 flex items-center justify-center">
                  <Icon className="w-5 h-5" />
                </div>
                <span className="text-2xl font-black text-slate-200 dark:text-slate-800 font-mono-numbers">
                  {st.num}
                </span>
              </div>
              <h3 className="font-bold text-slate-900 dark:text-white text-base">
                {st.title}
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {st.desc}
              </p>
            </div>
          );
        })}
      </div>

      {/* Supported Platforms */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-sm">
        <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Zap className="w-5 h-5 text-sky-500" />
          <span>{lang === 'he' ? 'פלטפורמות נתמכות' : 'Supported Platforms'}</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
          {platforms.map((p) => (
            <div
              key={p.name}
              className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200/60 dark:border-slate-800 space-y-1.5"
            >
              <div className="flex items-center gap-2 font-bold text-sm text-slate-900 dark:text-white">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                <span>{p.name}</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-normal">
                {lang === 'he' ? p.tipHe : p.tipEn}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Resolution & Quality Comparison */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-sm">
        <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Layers className="w-5 h-5 text-sky-500" />
          <span>{lang === 'he' ? 'מדריך איכויות ורזולוציות' : 'Quality & Resolution Guide'}</span>
        </h3>

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {resolutions.map((r) => (
            <div key={r.name} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="space-y-0.5">
                <div className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                  <span>{r.name}</span>
                  <span className="text-xs text-sky-600 dark:text-sky-400 font-mono-numbers">
                    ({r.spec})
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  {lang === 'he' ? r.useHe : r.useEn}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

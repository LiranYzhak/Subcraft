export type Language = 'he' | 'en';

export const translations = {
  he: {
    appTitle: 'SubCraft Studio',
    tagline: 'סטודיו להורדת סרטונים, עריכת וידאו וכתוביות בעברית',
    subTagline: 'הורד סרטונים מיוטיוב, טיקטוק, אינסטגרם ועוד — תמלל אוטומטית לעברית עם Cartesia, חתוך לפורמט 1:1 וייצא באיכות מלאה',
    navConverter: 'הורדה יחידה',
    navStudio: 'סטודיו עריכה וכתוביות',
    navBatch: 'הורדה מרובה (Batch)',
    navHistory: 'היסטוריית הורדות',
    navGuide: 'פלטפורמות נתמכות',
    openInStudio: 'ערוך והוסף כתוביות בעברית (Cartesia)',

    // Input section
    inputPlaceholder: 'הדבק קישור לסרטון (לדוגמה: https://www.youtube.com/watch?v=...)',
    pasteButton: 'הדבק קישור',
    clearButton: 'נקה',
    analyzeButton: 'נתח סרטון',
    analyzing: 'מנתח קישור...',
    quickSamples: 'או נסה קישור לדוגמה:',

    // Video preview & details
    detectedPlatform: 'פלטפורמה זוהתה',
    creator: 'יוצר',
    duration: 'משך',
    views: 'צפיות',
    likes: 'לייקים',
    aspectRatio: 'יחס תצוגה',

    // Quality Selection
    selectQualityTitle: 'בחר איכות לשמירה',
    selectQualityDesc: 'בחר את הרזולוציה והפורמט המבוקש עבור קובץ הווידאו שלך',
    popularBadge: 'מומלץ ביותר',
    hasAudio: 'כולל שמע',
    noAudio: 'ללא שמע',
    audioOnly: 'אודיו בלבד',
    fileSizeEst: 'משקל מוערך',
    fpsLabel: 'פריימים לשנייה',

    // Options
    advancedOptions: 'הגדרות מתקדמות וחיתוך',
    trimVideo: 'חיתוך קטע מהסרטון',
    fromTime: 'התחלה',
    toTime: 'סיום',
    muteAudio: 'הסר ערוץ שמע (וידאו אילם)',
    customFilename: 'שם קובץ מותאם אישית',

    // Action
    downloadNow: 'הורד סרטון עכשיו',
    preparingDownload: 'מכין קובץ וממיר...',
    downloadingProgress: 'מוריד למכשיר...',
    downloadComplete: 'ההורדה הושלמה בהצלחה!',
    downloadFailed: 'שגיאה בהורדה, נסה שוב',

    // Batch Downloader
    batchTitle: 'הורדה קבוצתית של סרטונים',
    batchDesc: 'הזן מספר קישורים (קישור אחד בכל שורה) להורדה מרוכזת באצווה אחת',
    batchPlaceholder: 'הדבק כאן קישורים, קישור בכל שורה:\nhttps://www.youtube.com/watch?v=...\nhttps://www.tiktok.com/@user/video/...\nhttps://www.instagram.com/reel/...',
    analyzeBatch: 'נתח את כל הקישורים',
    downloadAllZip: 'הורד את הכל כקובץ ZIP',
    defaultQualityForBatch: 'איכות ברירת מחדל לכולם:',
    totalVideos: 'סרטונים ברשימה',
    readyToDownload: 'מוכנים להורדה',

    // History
    historyTitle: 'היסטוריית הורדות מקומית',
    historyDesc: 'קבצים שהומרו ונשמרו במכשיר שלך בעבר',
    clearHistory: 'נקה היסטוריה',
    emptyHistory: 'אין עדיין הורדות בהיסטוריה. התחל להמיר סרטון למעלה!',
    reDownload: 'הורד שוב',
    previewVideo: 'צפה',
    copyLink: 'העתק קישור',
    copied: 'הועתק!',
    totalDownloadedFiles: 'סך הכל קבצים',
    totalDownloadedSize: 'נפח כולל שהומר',

    // Guide
    supportedTitle: 'רשתות נתמכות והוראות שימוש',
    guideDesc: 'כיצד להעתיק קישור ולהוריד באיכות מקסימלית',
    step1Title: '1. העתק קישור',
    step1Desc: 'פתח את האפליקציה (אינסטגרם, טיקטוק, יוטיוב וכו\'), לחץ על "שיתוף" ובחר "העתק קישור".',
    step2Title: '2. בחר איכות',
    step2Desc: 'הדבק את הקישור בממיר ובחר באיכות הרצויה - 1080p Full HD, 720p או חילוץ שמע ל-MP3.',
    step3Title: '3. שמור במכשיר',
    step3Desc: 'לחץ על "הורד סרטון", הקובץ יומר ויישמר ישירות בתיקיית ההורדות של המחשב או הטלפון.',

    // Platform badges
    platforms: {
      youtube: 'YouTube & Shorts',
      tiktok: 'TikTok',
      instagram: 'Instagram Reels & Posts',
      twitter: 'X / Twitter',
      facebook: 'Facebook Video & Reels',
      threads: 'Threads',
      reddit: 'Reddit',
      vimeo: 'Vimeo',
      other: 'אתר וידאו כללי',
    },
  },
  en: {
    appTitle: 'SubCraft Studio',
    tagline: 'Social Video Downloader, Editor & Hebrew Subtitle Studio',
    subTagline: 'Download videos from YouTube, TikTok, Instagram & more — auto-transcribe to Hebrew subtitles with Cartesia, crop to 1:1 square, and export in full HD',
    navConverter: 'Single Video',
    navStudio: 'Video & Subtitles Studio',
    navBatch: 'Batch Downloader',
    navHistory: 'History & Library',
    navGuide: 'Supported Platforms',
    openInStudio: 'Edit & Add Hebrew Subtitles (Cartesia)',

    // Input section
    inputPlaceholder: 'Paste video link (e.g., https://www.youtube.com/watch?v=...)',
    pasteButton: 'Paste Link',
    clearButton: 'Clear',
    analyzeButton: 'Analyze Video',
    analyzing: 'Analyzing URL...',
    quickSamples: 'Or test a sample video:',

    // Video preview & details
    detectedPlatform: 'Platform Detected',
    creator: 'Creator',
    duration: 'Duration',
    views: 'Views',
    likes: 'Likes',
    aspectRatio: 'Aspect Ratio',

    // Quality Selection
    selectQualityTitle: 'Select Quality Before Saving',
    selectQualityDesc: 'Choose your desired resolution and format for the saved video file',
    popularBadge: 'Most Popular',
    hasAudio: 'Audio Included',
    noAudio: 'Muted',
    audioOnly: 'Audio Only',
    fileSizeEst: 'Estimated Size',
    fpsLabel: 'Frames Per Second',

    // Options
    advancedOptions: 'Advanced Options & Trimming',
    trimVideo: 'Trim Video Segment',
    fromTime: 'Start',
    toTime: 'End',
    muteAudio: 'Mute Audio Channel',
    customFilename: 'Custom File Name',

    // Action
    downloadNow: 'Download Video Now',
    preparingDownload: 'Preparing and converting file...',
    downloadingProgress: 'Saving to device...',
    downloadComplete: 'Download Completed Successfully!',
    downloadFailed: 'Download failed, please try again',

    // Batch Downloader
    batchTitle: 'Batch Video Downloader',
    batchDesc: 'Paste multiple video links (one per line) to analyze and download in bulk',
    batchPlaceholder: 'Paste links here, one per line:\nhttps://www.youtube.com/watch?v=...\nhttps://www.tiktok.com/@user/video/...\nhttps://www.instagram.com/reel/...',
    analyzeBatch: 'Analyze All Links',
    downloadAllZip: 'Download All as ZIP',
    defaultQualityForBatch: 'Default Quality for All:',
    totalVideos: 'Total Videos',
    readyToDownload: 'Ready to Download',

    // History
    historyTitle: 'Download History & Library',
    historyDesc: 'Recently converted files stored locally on your device',
    clearHistory: 'Clear History',
    emptyHistory: 'No downloads in history yet. Convert your first video above!',
    reDownload: 'Download Again',
    previewVideo: 'Preview',
    copyLink: 'Copy Link',
    copied: 'Copied!',
    totalDownloadedFiles: 'Total Files',
    totalDownloadedSize: 'Total Data Converted',

    // Guide
    supportedTitle: 'Supported Networks & Instructions',
    guideDesc: 'How to copy links and save in maximum fidelity',
    step1Title: '1. Copy Link',
    step1Desc: 'Open your social app (TikTok, YouTube, Instagram, etc.), tap Share and pick "Copy Link".',
    step2Title: '2. Choose Quality',
    step2Desc: 'Paste into SubCraft Studio and pick your preferred quality: 1080p Full HD, 720p or MP3 audio.',
    step3Title: '3. Save to Device',
    step3Desc: 'Hit "Download Video Now" to immediately save the real video file to your device.',

    platforms: {
      youtube: 'YouTube & Shorts',
      tiktok: 'TikTok',
      instagram: 'Instagram Reels & Posts',
      twitter: 'X / Twitter',
      facebook: 'Facebook Video & Reels',
      threads: 'Threads',
      reddit: 'Reddit',
      vimeo: 'Vimeo',
      other: 'General Web Video',
    },
  },
};

# LinguaVerse — AI 語境翻譯 App

LinguaVerse 是一款手機 AI 語境翻譯應用程式，使用 Capacitor 將 React Web App 包裝為原生 Android App。

## 功能特色

- **20 種語言**支援，含自動偵測
- **6 種語境模式**：通用、商務、法律、醫療、科技、口語
- **AI 語境感知翻譯**引擎，附帶信心指數
- **翻譯歷史**雲端儲存（Supabase），可收藏、刪除
- **三層訂閱方案**：Free / Pro / Enterprise
- **用量配額管理**與付費牆

## 技術架構

- **前端**：React 18 + TypeScript + Vite
- **原生包裝**：Capacitor 6（Android）
- **後端**：Supabase（PostgreSQL 資料庫）
- **翻譯引擎**：內建語境感知翻譯邏輯

## 開發

```bash
npm install
npm run dev
```

## 建置 APK

```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
```

APK 輸出路徑：`android/app/build/outputs/apk/debug/app-debug.apk`

## 下載

請至 [Releases 頁面](../../releases) 下載最新 APK。

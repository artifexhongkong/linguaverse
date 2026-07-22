# LinguaVerse — AI 語境翻譯 App

LinguaVerse 是一款手機 AI 語境翻譯應用程式，使用 Capacitor 將 React Web App 包裝為原生 Android App。

## 功能特色

- **AI 語境感知翻譯** — 使用 LLaMA 3.1 大語言模型，附帶信心指數
- **7 種語境模式** — 日常、商務、法律、醫療、學術、科技、休閒
- **分層 Prompt 系統** — 基礎規則 + 領域模板 + 風格規則 + 輸出格式
- **翻譯歷史** — 雲端儲存（Supabase），可收藏、刪除
- **多語言支持** — 中文、英文、日文、韓文、西班牙文、法文等

## 技術架構

- **前端**：React 18 + TypeScript + Vite
- **原生包裝**：Capacitor 6（Android）
- **後端**：Supabase（PostgreSQL + Edge Functions）
- **AI 翻譯引擎**：Groq API（LLaMA 3.1-8B，免費 14,400 請求/天）+ OpenRouter 備選

## 配置說明

### 1. 獲取 Groq API Key（免費）

1. 前往 https://console.groq.com/keys
2. 註冊帳號並創建 API Key
3. 免費額度：每天 14,400 次請求

### 2. 設置 Supabase Edge Function 環境變量

在 Supabase Dashboard > Edge Functions > Secrets 中設置：

    GROQ_API_KEY=gsk_your_actual_key_here
    OPENROUTER_API_KEY=sk_or_your_key_here

### 3. 前端環境變量（.env 文件）

    VITE_SUPABASE_URL=https://your-project-id.supabase.co
    VITE_SUPABASE_ANON_KEY=your-anon-key

### 4. 部署 Edge Function

    supabase functions deploy agnes-translate

## 開發

    npm install
    npm run dev
    npm run build
    npx cap sync android

## 構建 APK

APK 通過 GitHub Actions 自動構建。每次 push 到 main 分支會自動：
1. 構建前端
2. 同步 Capacitor
3. 編譯 Android APK（debug + release）
4. 上傳到 GitHub Releases

## 下載

前往 Releases 頁面下載最新 APK。

## 授權

MIT License
# LinguaVerse — AI 語境翻譯 App

LinguaVerse 是一款手機 AI 語境翻譯應用程式，使用 Capacitor 將 React Web App 包裝為原生 Android App，後端翻譯由 **Agnes AI `agnes-2.0-flash`** 模型驅動。

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
- **後端 API（可選）**：FastAPI + Python，提供 `/translate` 端點
- **資料庫**：Supabase（PostgreSQL）
- **翻譯引擎**：[Agnes AI](https://agnes-ai.com) `agnes-2.0-flash` 模型
  - Android APK 內建 API Key（透過 Vite env 注入），可直接呼叫 Agnes，不依賴 Supabase Edge Function
  - Web 部署版本亦可選擇走 Supabase Edge Function，把 Key 放在 server 端

## 設定

1. 複製 `.env.example` 為 `.env`，填入你的 Agnes 憑證：

   ```
   cp .env.example .env
   ```

   ```env
   AGNES_API_KEY=sk-xxxxxxxxxxxx
   AGNES_BASE_URL=https://apihub.agnes-ai.com/v1
   AGNES_MODEL=agnes-2.0-flash

   VITE_AGNES_API_KEY=sk-xxxxxxxxxxxx
   VITE_AGNES_BASE_URL=https://apihub.agnes-ai.com/v1
   VITE_AGNES_MODEL=agnes-2.0-flash
   ```

   > ⚠️ 注意：實際 base URL 是 `https://apihub.agnes-ai.com/v1`，模型 ID 為小寫 `agnes-2.0-flash`（已驗證可正常呼叫 Chat Completions API）。

2. 後端設定檔位於 `backend/config.py`，使用 `python-dotenv` 讀取 `.env`，並導出 `settings` 物件：

   ```python
   from config import settings
   settings.AGNES_API_KEY
   settings.AGNES_BASE_URL
   settings.AGNES_MODEL
   settings.chat_completions_url   # https://apihub.agnes-ai.com/v1/chat/completions
   ```

3. （可選）若要把 Supabase Edge Function 當作 Web 端的代理，把以下 secrets 設到 Supabase Dashboard → Edge Functions → Secrets：
   - `AGNES_API_KEY`
   - `AGNES_BASE_URL`
   - `AGNES_MODEL`

## 開發

```bash
npm install
npm run dev      # 啟動前端開發伺服器
```

後端：

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
# 健康檢查
curl http://127.0.0.1:8000/health
# 翻譯
curl -X POST http://127.0.0.1:8000/translate \
  -H 'Content-Type: application/json' \
  -d '{"text":"這項投資的風險很高。","sourceLang":"zh-TW","targetLang":"en"}'
```

## 建置 APK

### 本地建置

```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleRelease
```

APK 輸出路徑：`android/app/build/outputs/apk/release/app-release-unsigned.apk`

### 雲端自動建置（推薦）

只要 push 到 `main` 分支，GitHub Actions workflow（`.github/workflows/build-apk.yml`）會自動：

1. 安裝 npm 依賴並用 Vite 建置 web bundle（注入下列 Vite_* secrets）
2. 執行 `npx cap sync android` 同步到 Android 專案
3. 解碼 `ANDROID_KEYSTORE_BASE64` 並以 release keystore 簽署 APK
4. 自動建立 GitHub Release（tag 為 `nightly-<short-sha>`）並上傳已簽署的 APK
5. 若推送的是 `v*` tag，會建立正式 Release；也可在 Actions → Run workflow 手動觸發

#### 必須設定的 Secrets（Settings → Secrets and variables → Actions）

**App 功能（前端注入）**
- `VITE_AGNES_API_KEY`
- `VITE_AGNES_BASE_URL`（`https://apihub.agnes-ai.com/v1`）
- `VITE_AGNES_MODEL`（`agnes-2.0-flash`）
- `VITE_SUPABASE_URL`（可選，配額與歷史紀錄功能）
- `VITE_SUPABASE_ANON_KEY`（可選）

**語音輸入（STT）— 自動偵測 + 三種設定方式**

Build 時 workflow 會自動用真實 `AGNES_API_KEY` 呼叫 Agnes 的 `/audio/transcriptions` 端點測試是否支援 Whisper。三種啟用方式（優先級由高到低）：

1. **後端代理模式**（最安全）：設定 `VITE_STT_BACKEND_URL` secret 指向你的 FastAPI `/api/v1/stt`，後端持有 Whisper key
2. **直連模式**：設定 `VITE_STT_API_KEY` + `VITE_STT_BASE_URL` secrets（可選 `VITE_STT_MODEL`，預設 `whisper-1`）。支援任何 OpenAI 相容端點：
   - OpenAI: `https://api.openai.com/v1` (model: `whisper-1`)
   - Groq: `https://api.groq.com/openai/v1` (model: `whisper-large-v3`)
   - DeepInfra: `https://api.deepinfra.com/v1/openai` (model: `openai/whisper-large-v3`)
3. **自動偵測 Agnes**（零設定）：若未設定上述 secrets，workflow 會測試 Agnes gateway 是否支援 Whisper，若支援則自動注入 Agnes credentials

若三者都未設定且 Agnes 不支援，語音按鈕會顯示「語音識別未配置」。

**APK 簽署**
- `ANDROID_KEYSTORE_BASE64` — `base64 < release.keystore` 的輸出
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

> 若未設定 signing secrets，workflow 會輸出未簽署 APK 並照常發佈到 Releases，可用於內部測試。

#### 建立簽署 Keystore（一次性）

```bash
keytool -genkey -v -keystore release.keystore -alias linguaverse \
  -keyalg RSA -keysize 2048 -validity 10000
base64 -w 0 release.keystore > keystore.b64   # 內容貼到 ANDROID_KEYSTORE_BASE64 secret
```

## 下載

請至 [Releases 頁面](../../releases) 下載最新 APK。

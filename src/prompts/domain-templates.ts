import type { DomainTemplate, DomainCode } from "./types";

export const DOMAIN_TEMPLATES: DomainTemplate[] = [
  {
    code: "academic",
    name: "學術論文",
    icon: "🎓",
    desc: "論文、期刊、研究報告",
    rules: [
      "使用正式學術語體，避免口語化表達。",
      "專業術語需採用該學科公認的標準譯名，首次出現附原文。",
      "被動語態優先（如適用於目標語言）。",
      "保留原文的邏輯結構與論證順序，不增刪內容。",
      "引用文獻名稱保留原文，不翻譯書名與論文標題。",
    ],
    terminology: {
      "hypothesis": "假設",
      "methodology": "研究方法",
      "quantitative": "量化",
      "qualitative": "質化",
      "peer review": "同儕審查",
      "abstract": "摘要",
    },
  },
  {
    code: "legal",
    name: "法律",
    icon: "⚖️",
    desc: "合約、法規、訴訟文件",
    rules: [
      "使用精確法律術語，不得使用模糊或口語化表達。",
      "「shall」譯為「應」，「may」譯為「得」，「must」譯為「必須」，嚴格區分義務與權限。",
      "法律條款編號保持原文格式不變。",
      "定義條款中的術語在全文中保持一致。",
      "不確定的法律概念需在譯文後以括號附註原文法律術語。",
    ],
    terminology: {
      "liability": "責任",
      "indemnity": "補償",
      "jurisdiction": "管轄權",
      "breach": "違約",
      "warranty": "保證",
      "force majeure": "不可抗力",
    },
  },
  {
    code: "medical",
    name: "醫學",
    icon: "⚕️",
    desc: "病歷、藥物說明、醫學報告",
    rules: [
      "使用標準醫學術語，避免通俗用語（如「高血壓」而非「血壓高」）。",
      "藥物名稱保留國際非專利名（INN），附原文商品名。",
      "劑量與單位不得轉換，保持原文數值與單位制式。",
      "解剖學術語採用目標語言的標準醫學名稱。",
      "診斷與症狀描述需精確，不得使用模糊表述。",
    ],
    terminology: {
      "hypertension": "高血壓",
      "myocardial infarction": "心肌梗塞",
      "cerebrovascular accident": "腦血管意外",
      "contraindication": "禁忌症",
      "prognosis": "預後",
      "dosage": "劑量",
    },
  },
  {
    code: "programming",
    name: "程式設計",
    icon: "💻",
    desc: "技術文件、API 文檔、程式碼註解",
    rules: [
      "技術術語保留英文原文（如 API、JSON、WebSocket），不強行翻譯。",
      "程式碼片段、變數名稱、函數名稱保持原文不翻譯。",
      "技術文件中的步驟說明使用目標語言的清晰指令式語體。",
      "保留 Markdown 格式與程式碼區塊標記。",
      "錯誤訊息與日誌輸出保持原文，僅翻譯說明文字部分。",
    ],
    terminology: {
      "deployment": "部署",
      "repository": "儲存庫",
      "framework": "框架",
      "middleware": "中介軟體",
      "callback": "回呼",
      "serialization": "序列化",
    },
  },
  {
    code: "game-l10n",
    name: "遊戲本地化",
    icon: "🎮",
    desc: "遊戲對話、UI 文字、劇情翻譯",
    rules: [
      "角色對話需符合角色性格與語氣，不得統一為同一風格。",
      "UI 文字需簡潔有力，考慮畫面字數限制。",
      "遊戲專有術語（技能名、道具名）需保持全文一致。",
      "幽默與雙關語需在地化改寫，而非直譯。",
      "保留遊戲中的特殊標記符號（如 {player}、<color=red>）。",
    ],
    terminology: {
      "quest": "任務",
      "loot": "戰利品",
      "cooldown": "冷卻時間",
      "buff": "增益",
      "debuff": "減益",
      "NPC": "NPC",
    },
  },
  {
    code: "business",
    name: "商務文書",
    icon: "💼",
    desc: "商業郵件、報告、企劃書",
    rules: [
      "使用正式商業語體，語氣專業但不過度生硬。",
      "職稱與部門名稱採用目標語言的商業慣用譯法。",
      "金額與日期轉換為目標語言的商業格式。",
      "商業慣用語（如「as per」→「根據」）需轉換為目標語言的對應表達。",
      "保持商業文件的禮貌層級與正式度。",
    ],
    terminology: {
      "stakeholder": "利害關係人",
      "deliverable": "交付成果",
      "KPI": "關鍵績效指標",
      "ROI": "投資回報率",
      "quarterly": "季度",
      "procurement": "採購",
    },
  },
  {
    code: "cantonese",
    name: "粵語口語",
    icon: "🗣️",
    desc: "粵語口語翻譯、影視字幕",
    rules: [
      "使用正宗粵語口語表達，而非書面語直譯。",
      "保留粵語特色語氣助詞（如「啦」、「㗎」、「喎」）。",
      "粵語俗語與歇後語需在地化翻譯，必要時加註釋。",
      "影視字幕需考慮閱讀速度，每行不超過 15 字。",
      "人物對話需符合角色身份與社會階層的語言習慣。",
    ],
    terminology: {
      "你好": "你好",
      "謝謝": "多謝",
      "不好意思": "唔好意思",
      "沒問題": "無問題",
      "再見": "拜拜",
      "吃飯了嗎": "食咗飯未",
    },
  },
];

export function getDomainTemplate(code: DomainCode | "custom"): DomainTemplate | null {
  if (code === "custom") return null;
  return DOMAIN_TEMPLATES.find((t) => t.code === code) ?? null;
}

export const DOMAIN_LIST = DOMAIN_TEMPLATES.map((t) => ({
  code: t.code,
  name: t.name,
  icon: t.icon,
  desc: t.desc,
}));

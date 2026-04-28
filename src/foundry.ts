import OpenAI from "openai";
import { config } from "./config";

type MeetingSummaryResult = {
  summary: string;
  actionItems: string[];
  usedFallback: boolean;
};

const openai = new OpenAI({
  baseURL: config.foundryEndpoint,
  apiKey: config.foundryApiKey,
  timeout: config.foundryTimeoutMs,
  maxRetries: 0
});

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function splitSentences(text: string): string[] {
  return normalizeText(text)
    .split(/(?<=[.!?。！？])\s+|(?<=\.)\s+|(?<=\?)\s+|(?<=!)\s+/g)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function bulletList(items: string[]): string {
  if (!items.length) {
    return "-";
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function uniqueItems(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of items) {
    const cleaned = cleanBulletText(item);
    const key = cleaned.toLowerCase();

    if (!cleaned || cleaned === "-" || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(cleaned);
  }

  return result;
}

function cleanBulletText(value: string): string {
  return value
    .replace(/^[-•]\s*/, "")
    .replace(/^\d+\.\s*/, "")
    .replace(/^Нэгдүгээрт,?\s*/i, "")
    .replace(/^Хоёрдугаарт,?\s*/i, "")
    .replace(/^Гуравдугаарт,?\s*/i, "")
    .replace(/^Дөрөвдүгээрт,?\s*/i, "")
    .replace(/^Тавдугаарт,?\s*/i, "")
    .trim();
}

function extractAfterKeywords(text: string, keywords: string[]): string {
  const lowerText = text.toLowerCase();

  for (const keyword of keywords) {
    const index = lowerText.indexOf(keyword.toLowerCase());

    if (index >= 0) {
      return text.slice(index + keyword.length).trim();
    }
  }

  return "";
}

function cleanDecisionItems(text: string): string[] {
  const sentences = splitSentences(text);

  return sentences
    .filter((sentence) =>
      [
        "шийд",
        "өөрчлөхгүй",
        "шилжүүлнэ",
        "буцаана",
        "үүсгэнэ",
        "хадгална",
        "байлгана",
        "ашиглана",
        "хэвээр",
        "сонгоно",
        "тохирсон"
      ].some((keyword) => sentence.toLowerCase().includes(keyword.toLowerCase()))
    )
    .map(cleanBulletText)
    .filter(Boolean)
    .slice(0, 8);
}

function cleanTaskItems(text: string): string[] {
  const sentences = splitSentences(text);

  return sentences
    .filter((sentence) =>
      [
        "шалгах",
        "харах",
        "баталгаажуулах",
        "турших",
        "туршина",
        "засах",
        "шинэчлэх",
        "холбох",
        "тохируулах",
        "нэвтрүүлэх",
        "хийх",
        "бэлдэх",
        "үүсгэх",
        "илгээх",
        "хянах",
        "full flow",
        "fallback"
      ].some((keyword) => sentence.toLowerCase().includes(keyword.toLowerCase()))
    )
    .map(cleanBulletText)
    .map((item) =>
      item
        .replace(/^Дараагийн хийх ажил бол\s*/i, "")
        .replace(/^дараа нь\s*/i, "")
        .trim()
    )
    .filter(Boolean)
    .filter((item) => {
      const lower = item.toLowerCase();

      if (lower.includes("шалгасан")) return false;
      if (lower.includes("туршилтын явцад")) return false;
      if (lower.includes("ярилцсан")) return false;
      if (lower.includes("гарсан тохиолдол")) return false;
      if (lower.includes("хэлэлцсэн")) return false;

      return true;
    })
    .slice(0, 8);
}

function cleanAdditionalTaskItems(text: string, existingTasks: string[]): string[] {
  const existing = new Set(existingTasks.map((item) => item.toLowerCase()));
  const sentences = splitSentences(text);

  return sentences
    .filter((sentence) =>
      [
        "шаардлагатай",
        "үргэлжлүүл",
        "дараагийн",
        "нэмэлт",
        "нэмж",
        "follow-up",
        "дахин",
        "баталгаажуулах",
        "хянах",
        "шалгах",
        "сайжруулах",
        "шийдвэрлэх"
      ].some((keyword) => sentence.toLowerCase().includes(keyword.toLowerCase()))
    )
    .map(cleanBulletText)
    .filter(Boolean)
    .filter((item) => !existing.has(item.toLowerCase()))
    .slice(0, 6);
}

export function buildLocalFallbackSummary(
  transcript: string,
  summaryType: string
): MeetingSummaryResult {
  const safeTranscript = normalizeText(transcript);

  const overview =
    splitSentences(safeTranscript).slice(0, 2).join(" ") ||
    "Transcript хадгалагдсан.";

  if (summaryType !== "meeting_summary") {
    const ideas = splitSentences(safeTranscript).slice(0, 5);

    const risks = splitSentences(safeTranscript)
      .filter((sentence) =>
        ["эрсдэл", "алдаа", "timeout", "удаан", "анхаар", "болгоомж"].some(
          (keyword) => sentence.toLowerCase().includes(keyword.toLowerCase())
        )
      )
      .map(cleanBulletText)
      .filter(Boolean)
      .slice(0, 5);

    const actionItems = cleanTaskItems(safeTranscript);
    const additionalActionItems = cleanAdditionalTaskItems(
      safeTranscript,
      actionItems
    );

    return {
      summary: `1. Товч дүгнэлт
${overview}

2. Гол санаанууд
${bulletList(ideas)}

3. Хийх ажлууд
${bulletList(actionItems)}

4. Нэмж хийгдэх ажлууд
${bulletList(additionalActionItems)}

5. Анхаарах зүйлс
${bulletList(risks)}`,
      actionItems: uniqueItems([...actionItems, ...additionalActionItems]),
      usedFallback: true
    };
  }

  const decisionText =
    extractAfterKeywords(safeTranscript, [
      "Эцэст нь дараах шийдвэрүүд гарсан",
      "дараах шийдвэрүүд гарсан",
      "шийдвэрүүд гарсан"
    ]) || safeTranscript;

  const taskText =
    extractAfterKeywords(safeTranscript, [
      "Дараагийн хийх ажил бол",
      "Дараагийн хийх ажил",
      "дараагийн хийх ажил",
      "хийх ажил",
      "хийх ажлууд"
    ]) || safeTranscript;

  const riskItems = splitSentences(safeTranscript)
    .filter((sentence) =>
      ["эрсдэл", "timeout", "удаан", "404", "хоосон", "алдаа", "хэт өндөр"].some(
        (keyword) => sentence.toLowerCase().includes(keyword.toLowerCase())
      )
    )
    .map(cleanBulletText)
    .filter(Boolean)
    .slice(0, 6);

  const decisionItems = cleanDecisionItems(decisionText);
  const actionItems = cleanTaskItems(taskText);
  const additionalActionItems = cleanAdditionalTaskItems(
    safeTranscript,
    actionItems
  );

  return {
    summary: `1. Хурлын товч дүгнэлт
${overview}

2. Гол шийдвэрүүд
${bulletList(decisionItems)}

3. Хийх ажлууд
${bulletList(actionItems)}

4. Нэмж хийгдэх ажлууд
${bulletList(additionalActionItems)}

5. Эрсдэл / анхаарах зүйлс
${bulletList(riskItems)}`,
    actionItems: uniqueItems([...actionItems, ...additionalActionItems]),
    usedFallback: true
  };
}

function extractAIText(completion: any): string {
  const message = completion?.choices?.[0]?.message;
  const rawContent = message?.content;

  if (typeof rawContent === "string") {
    return rawContent.trim();
  }

  if (Array.isArray(rawContent)) {
    return rawContent
      .map((item: any) => {
        if (typeof item === "string") return item;
        if (typeof item?.text === "string") return item.text;
        if (typeof item?.content === "string") return item.content;
        if (typeof item?.value === "string") return item.value;
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  return "";
}

function extractJsonObject(text: string): any | null {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // continue
  }

  const match = cleaned.match(/\{[\s\S]*\}/);

  if (!match) {
    return null;
  }

  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function normalizeActionItems(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item).trim())
    .map(cleanBulletText)
    .filter(Boolean)
    .filter((item) => item !== "-")
    .slice(0, 10);
}

function extractSectionItemsFromSummary(
  summary: string,
  sectionTitle: string
): string[] {
  const lines = summary
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const startIndex = lines.findIndex((line) =>
    line.toLowerCase().includes(sectionTitle.toLowerCase())
  );

  if (startIndex < 0) {
    return [];
  }

  const items: string[] = [];

  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i];

    if (/^\d+\./.test(line)) {
      break;
    }

    const cleaned = cleanBulletText(line);

    if (cleaned && cleaned !== "-") {
      items.push(cleaned);
    }
  }

  return items.slice(0, 10);
}

function extractActionItemsFromSummary(summary: string): string[] {
  const directItems = extractSectionItemsFromSummary(summary, "Хийх ажлууд");
  const additionalItems = extractSectionItemsFromSummary(
    summary,
    "Нэмж хийгдэх ажлууд"
  );

  return uniqueItems([...directItems, ...additionalItems]).slice(0, 12);
}

function removeAssistantPhrases(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const lower = line.toLowerCase().trim();

      return !(
        lower.includes("хэрэв хүсвэл") ||
        lower.includes("хүсвэл") ||
        lower.includes("би танд") ||
        lower.includes("би ингэж") ||
        lower.includes("би үүнийг") ||
        lower.includes("би бэлдэж") ||
        lower.includes("би гаргаж") ||
        lower.includes("дараа нь") ||
        lower.includes("нэмж өгье") ||
        lower.includes("нэмж өгч") ||
        lower.includes("боловсруулж өгье") ||
        lower.includes("боловсруулж өгч") ||
        lower.includes("форматлаж өгье") ||
        lower.includes("форматлаж өгч") ||
        lower.includes("тусалж чадна")
      );
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildPrompt(params: {
  transcript: string;
  meetingTitle: string;
  summaryType: string;
}): string {
  const { transcript, meetingTitle, summaryType } = params;

  if (summaryType === "meeting_summary") {
    return `
Дараах хурлын transcript-ийг Монгол хэлээр хурлын тэмдэглэл болгон нэгтгэ.

ЗӨВХӨН valid JSON буцаа.
Markdown, тайлбар, code block, reasoning бүү бич.

JSON бүтэц яг ийм байна:
{
  "summary": "1. Хурлын товч дүгнэлт\\n...\\n\\n2. Гол шийдвэрүүд\\n- ...\\n\\n3. Хийх ажлууд\\n- ...\\n\\n4. Нэмж хийгдэх ажлууд\\n- ...\\n\\n5. Эрсдэл / анхаарах зүйлс\\n- ...",
  "actionItems": [
    "Хийх ажил 1",
    "Нэмж хийгдэх ажил 1"
  ],
  "additionalActionItems": [
    "Нэмж хийгдэх ажил 1"
  ]
}

Дүрэм:
- "Хурлын товч дүгнэлт" хэсэгт transcript-ийг шууд хуулбарлахгүй, утгыг нь цэвэр дүгнэ.
- "Гол шийдвэрүүд" хэсэгт зөвхөн шийдвэр, тохиролцоо, сонгосон чиглэлийг бич.
- "Хийх ажлууд" хэсэгт transcript дээр шууд дурдагдсан цаашид хийх ажлыг бич.
- "Нэмж хийгдэх ажлууд" хэсэгт transcript-ийн агуулгаас логикоор зайлшгүй үргэлжлүүлэн хийх шаардлагатай follow-up ажлуудыг бич.
- "Нэмж хийгдэх ажлууд" хэсэгт зохиомол, хамааралгүй, transcript-тэй холбоогүй ажил нэмэхгүй.
- Өнгөрсөн үйл явдлыг action item болгож болохгүй.
- actionItems array нь "Хийх ажлууд" болон "Нэмж хийгдэх ажлууд" хоёр хэсгийн бүх ажлыг нэгтгэсэн байна.
- additionalActionItems array нь зөвхөн "Нэмж хийгдэх ажлууд" хэсэгтэй таарсан байна.
- Хэрэв эзэн хүн байхгүй бол эзэнгүйгээр бич.
- Хэрэв хийх ажил байхгүй бол тухайн хэсэгт "-" гэж бич.
- Хэрэв нэмж хийгдэх ажил байхгүй бол "Нэмж хийгдэх ажлууд" хэсэгт "-" гэж бич.
- Хэрэв хийх ажил байхгүй бол actionItems хоосон array байна.
- Монгол хэлээр бизнесийн цэвэр найруулгатай бич.
- Өөрийгөө AI, chatbot, assistant гэж дурдахгүй.
- Нэмэлт санал, асуулт, "хүсвэл" гэх төгсгөлийн өгүүлбэр бичихгүй.

Хурлын нэр: ${meetingTitle || "Тодорхойгүй"}

Transcript:
${transcript}
`;
  }

  return `
Дараах transcript-ийг Монгол хэлээр товч дүгнэ.

ЗӨВХӨН valid JSON буцаа.
Markdown, тайлбар, code block, reasoning бүү бич.

JSON бүтэц:
{
  "summary": "1. Товч дүгнэлт\\n...\\n\\n2. Гол санаанууд\\n- ...\\n\\n3. Хийх ажлууд\\n- ...\\n\\n4. Нэмж хийгдэх ажлууд\\n- ...\\n\\n5. Анхаарах зүйлс\\n- ...",
  "actionItems": [
    "Хийх ажил 1",
    "Нэмж хийгдэх ажил 1"
  ],
  "additionalActionItems": [
    "Нэмж хийгдэх ажил 1"
  ]
}

Дүрэм:
- Товч, цэвэр, ойлгомжтой бич.
- "Хийх ажлууд" дээр transcript дээр шууд дурдагдсан цаашид хийх ажлыг бич.
- "Нэмж хийгдэх ажлууд" дээр transcript-ийн агуулгаас логикоор шаардлагатай follow-up ажлыг бич.
- Зохиомол, transcript-тэй холбоогүй ажил нэмэхгүй.
- actionItems дээр "Хийх ажлууд" болон "Нэмж хийгдэх ажлууд" хоёр хэсгийн ажлыг нэгтгэж бич.
- additionalActionItems дээр зөвхөн "Нэмж хийгдэх ажлууд"-ыг бич.
- Өнгөрсөн үйл явдлыг action item болгож болохгүй.
- Өөрийгөө AI, chatbot, assistant гэж дурдахгүй.
- Нэмэлт санал, асуулт, "хүсвэл" гэх төгсгөлийн өгүүлбэр бичихгүй.

Transcript:
${transcript}
`;
}

async function askFoundrySummary(prompt: string): Promise<{
  text: string;
  finishReason?: string;
}> {
  const completion = await openai.chat.completions.create({
    model: config.foundryDeployment,
    messages: [
      {
        role: "system",
        content:
          "Чи хурлын тэмдэглэл нэгтгэгч туслах. Зөвхөн valid JSON буцаа. Markdown, тайлбар, reasoning, code block бүү бич."
      },
      {
        role: "user",
        content: prompt
      }
    ],
    temperature: 0.1,
    max_tokens: 2500,
    response_format: {
      type: "json_object"
    } as any
  });

  const finishReason = completion.choices?.[0]?.finish_reason;
  const text = extractAIText(completion);

  console.log("AI MODEL:", config.foundryDeployment);
  console.log("AI FINISH REASON:", finishReason);
  console.log("AI CONTENT LENGTH:", text.length);

  return {
    text,
    finishReason
  };
}

export async function summarizeTranscript(params: {
  transcript: string;
  meetingTitle?: string;
  summaryType?: string;
}): Promise<MeetingSummaryResult> {
  const transcript = params.transcript.trim();
  const meetingTitle = params.meetingTitle?.trim() || "";
  const summaryType = params.summaryType?.trim() || "meeting_summary";

  const shortTranscript = transcript.slice(0, 15000);

  const fallback = buildLocalFallbackSummary(shortTranscript, summaryType);

  try {
    const prompt = buildPrompt({
      transcript: shortTranscript,
      meetingTitle,
      summaryType
    });

    const aiResult = await askFoundrySummary(prompt);

    if (!aiResult.text || aiResult.finishReason === "length") {
      console.log("AI output empty or cut off. Using fallback.");
      return fallback;
    }

    const parsed = extractJsonObject(aiResult.text);

    if (!parsed || typeof parsed.summary !== "string") {
      console.log("AI JSON parse failed. Using fallback.");
      return fallback;
    }

    const summary = removeAssistantPhrases(parsed.summary.trim()) || "-";

    const directActionItems = normalizeActionItems(parsed.actionItems);
    const additionalActionItems = normalizeActionItems(
      parsed.additionalActionItems
    );

    let actionItems = uniqueItems([
      ...directActionItems,
      ...additionalActionItems
    ]).slice(0, 12);

    if (!actionItems.length) {
      actionItems = extractActionItemsFromSummary(summary);
    }

    return {
      summary,
      actionItems,
      usedFallback: false
    };
  } catch (error) {
    console.error("FOUNDRY SUMMARY ERROR:", error);
    return fallback;
  }
}
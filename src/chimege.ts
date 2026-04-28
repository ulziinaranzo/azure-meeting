import { config } from "./config";

type JsonRecord = Record<string, unknown>;

type TranscriptParseResult = {
  text: string;
  isFinal: boolean;
  status?: string;
  progress?: number;
};

type TranscriptCandidate = TranscriptParseResult & {
  endpoint: string;
  httpStatus: number;
  rawBody: string;
};

type TranscriptJobState = {
  uuid: string;
  duration?: number;
  bestTranscript: string;
  lastTranscript: string;
  stableCount: number;
  createdAt: number;
  lastCheckedAt: number;
};

const transcriptJobs = new Map<string, TranscriptJobState>();
const JOB_TTL_MS = 6 * 60 * 60 * 1000;

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function toRecord(value: unknown): JsonRecord | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord;
  }

  return null;
}

function toBoolean(value: unknown): boolean {
  return value === true || value === "true";
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extractTextFromUnknown(value: unknown): string {
  if (typeof value === "string") {
    return normalizeText(value);
  }

  if (Array.isArray(value)) {
    return normalizeText(
      value
        .map((item) => extractTextFromUnknown(item))
        .filter(Boolean)
        .join(" ")
    );
  }

  const record = toRecord(value);

  if (!record) {
    return "";
  }

  const directKeys = [
    "transcription",
    "transcript",
    "text",
    "content",
    "fullText",
    "full_text",
    "finalText",
    "final_text",
    "sentence",
    "value",
    "result",
    "data"
  ];

  for (const key of directKeys) {
    const text = extractTextFromUnknown(record[key]);

    if (text) {
      return text;
    }
  }

  const listKeys = [
    "segments",
    "utterances",
    "items",
    "results",
    "alternatives",
    "sentences",
    "chunks"
  ];

  for (const key of listKeys) {
    const text = extractTextFromUnknown(record[key]);

    if (text) {
      return text;
    }
  }

  return "";
}

function getStatusValue(record: JsonRecord): string {
  const candidates = [
    record.status,
    record.state,
    record.phase,
    toRecord(record.data)?.status,
    toRecord(record.result)?.status
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim().toLowerCase();
    }
  }

  return "";
}

function getProgressValue(record: JsonRecord): number | undefined {
  const candidates = [
    record.progress,
    record.percent,
    record.percentage,
    toRecord(record.data)?.progress,
    toRecord(record.result)?.progress
  ];

  for (const candidate of candidates) {
    const value = toNumber(candidate);

    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function getFinalFlag(record: JsonRecord): boolean {
  const directCandidates = [
    record.done,
    record.completed,
    record.complete,
    record.isFinal,
    record.is_final,
    record.final,
    record.finished,
    record.ready,
    toRecord(record.data)?.done,
    toRecord(record.data)?.completed,
    toRecord(record.data)?.isFinal,
    toRecord(record.data)?.is_final,
    toRecord(record.result)?.done,
    toRecord(record.result)?.completed,
    toRecord(record.result)?.isFinal,
    toRecord(record.result)?.is_final
  ];

  if (directCandidates.some((value) => toBoolean(value))) {
    return true;
  }

  const status = getStatusValue(record);

  if (
    [
      "done",
      "completed",
      "complete",
      "success",
      "succeeded",
      "ready",
      "finished",
      "final"
    ].includes(status)
  ) {
    return true;
  }

  const progress = getProgressValue(record);

  return progress === 100;
}

function parseTranscriptResponse(raw: string): TranscriptParseResult {
  const trimmed = raw.trim();

  if (!trimmed) {
    return {
      text: "",
      isFinal: false
    };
  }

  const parsed = safeJsonParse<unknown>(trimmed);

  if (!parsed) {
    return {
      text: normalizeText(trimmed),
      isFinal: false
    };
  }

  // Chimege ихэвчлэн ингэж буцааж болно:
  // [{ done: true, transcription: "...", duration: 0 }]
  if (Array.isArray(parsed)) {
    const texts = parsed
      .map((item) => extractTextFromUnknown(item))
      .filter(Boolean);

    const isFinal = parsed.some((item) => {
      const record = toRecord(item);
      return record ? getFinalFlag(record) : false;
    });

    const progressValues = parsed
      .map((item) => {
        const record = toRecord(item);
        return record ? getProgressValue(record) : undefined;
      })
      .filter((value): value is number => value !== undefined);

    return {
      text: normalizeText(texts.join(" ")),
      isFinal,
      progress: progressValues.length ? Math.max(...progressValues) : undefined
    };
  }

  const record = toRecord(parsed);

  if (!record) {
    return {
      text: extractTextFromUnknown(parsed),
      isFinal: false
    };
  }

  return {
    text: extractTextFromUnknown(record),
    isFinal: getFinalFlag(record),
    status: getStatusValue(record),
    progress: getProgressValue(record)
  };
}

function cleanupTranscriptJobs(): void {
  const now = Date.now();

  for (const [uuid, state] of transcriptJobs.entries()) {
    if (now - state.createdAt > JOB_TTL_MS) {
      transcriptJobs.delete(uuid);
    }
  }
}

export function getOrCreateJob(
  uuid: string,
  duration?: number
): TranscriptJobState {
  const existing = transcriptJobs.get(uuid);

  if (existing) {
    if (duration !== undefined && existing.duration === undefined) {
      existing.duration = duration;
    }

    return existing;
  }

  const created: TranscriptJobState = {
    uuid,
    duration,
    bestTranscript: "",
    lastTranscript: "",
    stableCount: 0,
    createdAt: Date.now(),
    lastCheckedAt: 0
  };

  transcriptJobs.set(uuid, created);

  return created;
}

export async function uploadToChimege(
  audioBuffer: Buffer
): Promise<{
  uuid: string;
  duration?: number;
}> {
  const uploadResponse = await fetch(config.chimegeUploadEndpoint, {
    method: "POST",
    headers: {
      Token: config.chimegeToken,
      "Content-Type": "application/octet-stream"
    },
    body: audioBuffer
  });

  const uploadText = await uploadResponse.text();

  if (!uploadResponse.ok) {
    throw new Error(`Chimege upload failed: ${uploadText}`);
  }

  let uuid = "";
  let duration: number | undefined;

  const uploadJson = safeJsonParse<{
    uuid?: string;
    duration?: number | string;
  }>(uploadText);

  if (uploadJson?.uuid) {
    uuid = uploadJson.uuid.trim();
    duration = toNumber(uploadJson.duration);
  } else {
    uuid = uploadText.replace(/^"|"$/g, "").trim();
  }

  if (!uuid) {
    throw new Error(`Chimege UUID was empty. Raw response: ${uploadText}`);
  }

  return {
    uuid,
    duration
  };
}

async function fetchTranscriptCandidate(
  uuid: string
): Promise<TranscriptCandidate> {
  const response = await fetch(config.chimegeTranscriptEndpoint, {
    method: "GET",
    headers: {
      Token: config.chimegeToken,
      UUID: uuid
    }
  });

  const rawBody = await response.text();

  if (!response.ok) {
    return {
      text: "",
      isFinal: false,
      status: `http_${response.status}`,
      progress: undefined,
      endpoint: config.chimegeTranscriptEndpoint,
      httpStatus: response.status,
      rawBody
    };
  }

  const parsed = parseTranscriptResponse(rawBody);

  return {
    ...parsed,
    endpoint: config.chimegeTranscriptEndpoint,
    httpStatus: response.status,
    rawBody
  };
}

export async function getTranscriptStatus(uuid: string): Promise<{
  status: "processing" | "done";
  isFinal: boolean;
  transcript: string;
  duration?: number;
  progress?: number;
  stableCount: number;
  sourceEndpoint?: string;
}> {
  cleanupTranscriptJobs();

  const job = getOrCreateJob(uuid);

  const best = await fetchTranscriptCandidate(uuid);
  const currentText = normalizeText(best.text);

  if (currentText.length > job.bestTranscript.length) {
    job.bestTranscript = currentText;
  }

  if (currentText) {
    if (currentText === job.lastTranscript) {
      job.stableCount += 1;
    } else {
      job.lastTranscript = currentText;
      job.stableCount = 1;
    }
  }

  job.lastCheckedAt = Date.now();

  // Хурдан хувилбар:
  // - Chimege done=true өгвөл done
  // - done flag алга байсан ч transcript текст гарсан бол шууд done
  const isDone = best.isFinal || job.bestTranscript.length > 0;

  return {
    status: isDone ? "done" : "processing",
    isFinal: isDone,
    transcript: job.bestTranscript || currentText,
    duration: job.duration,
    progress: best.progress,
    stableCount: job.stableCount,
    sourceEndpoint: best.endpoint
  };
}
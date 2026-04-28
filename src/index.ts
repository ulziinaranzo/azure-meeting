import cors from "cors";
import express, { Request, Response } from "express";
import multer from "multer";
import { config } from "./config";
import {
  getOrCreateJob,
  getTranscriptStatus,
  uploadToChimege
} from "./chimege";
import {
  buildLocalFallbackSummary,
  summarizeTranscript
} from "./foundry";

const app = express();

app.use(cors());
app.use(express.json({ limit: "250mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 200 * 1024 * 1024
  }
});

function decodeAudioDataUri(audioDataUri: string): Buffer {
  let value = audioDataUri.trim();

  // Sometimes Power Apps / JSON can send quoted string.
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    try {
      value = JSON.parse(value);
    } catch {
      value = value.slice(1, -1);
    }
  }

  const commaIndex = value.indexOf(",");
  const base64Data = commaIndex >= 0 ? value.substring(commaIndex + 1) : value;

  if (!base64Data.trim()) {
    throw new Error("Audio base64 data is empty");
  }

  return Buffer.from(base64Data, "base64");
}

app.get("/health", (_req: Request, res: Response) => {
  return res.json({
    ok: true
  });
});

app.post("/api/transcribe", upload.single("audio"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        ok: false,
        message: "audio file is required"
      });
    }

    const uploaded = await uploadToChimege(req.file.buffer);
    getOrCreateJob(uploaded.uuid, uploaded.duration);

    return res.json({
      ok: true,
      status: "queued",
      uuid: uploaded.uuid,
      duration: uploaded.duration
    });
  } catch (error) {
    console.error("TRANSCRIBE START ERROR:", error);

    return res.status(500).json({
      ok: false,
      message: "Server error",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/transcribe-start", async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      audioDataUri?: string;
      fileName?: string;
    };

    const audioDataUri = body.audioDataUri;

    if (!audioDataUri) {
      return res.status(400).json({
        ok: false,
        message: "audioDataUri is required"
      });
    }

    const inputBuffer = decodeAudioDataUri(audioDataUri);

    const uploaded = await uploadToChimege(inputBuffer);
    getOrCreateJob(uploaded.uuid, uploaded.duration);

    return res.json({
      ok: true,
      status: "queued",
      uuid: uploaded.uuid,
      duration: uploaded.duration
    });
  } catch (error) {
    console.error("TRANSCRIBE START BASE64 ERROR:", error);

    return res.status(500).json({
      ok: false,
      message: "Server error",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/transcribe-status", async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      uuid?: string;
    };

    const uuid = body.uuid?.trim();

    if (!uuid) {
      return res.status(400).json({
        ok: false,
        message: "uuid is required"
      });
    }

    const result = await getTranscriptStatus(uuid);

    return res.json({
      ok: true,
      uuid,
      ...result
    });
  } catch (error) {
    console.error("TRANSCRIBE STATUS ERROR:", error);

    return res.status(500).json({
      ok: false,
      message: "Server error",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/summarize-transcript", async (req: Request, res: Response) => {
  let transcript = "";
  let summaryType = "meeting_summary";

  try {
    const body = req.body as {
      transcript?: string;
      meetingTitle?: string;
      summaryType?: string;
    };

    transcript = body.transcript ?? "";
    summaryType = body.summaryType ?? "meeting_summary";

    if (!transcript.trim()) {
      return res.status(400).json({
        ok: false,
        message: "transcript is required"
      });
    }

    const result = await summarizeTranscript({
      transcript,
      meetingTitle: body.meetingTitle,
      summaryType
    });

    return res.json({
      ok: true,
      summary: result.summary,
      actionItems: result.actionItems
    });
  } catch (error) {
    console.error("SUMMARIZE TRANSCRIPT ROUTE ERROR:", error);

    const fallback = buildLocalFallbackSummary(
      transcript || "-",
      summaryType || "meeting_summary"
    );

    return res.json({
      ok: true,
      summary: fallback.summary,
      actionItems: fallback.actionItems
    });
  }
});

app.listen(config.port, () => {
  console.log(`Server running on http://localhost:${config.port}`);
});
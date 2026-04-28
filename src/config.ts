import dotenv from "dotenv";

dotenv.config();

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value || !value.trim()) {
    throw new Error(`${name} is missing in .env`);
  }

  return value.trim();
}

type ChimegeMode = "standard" | "hq";

function getChimegeMode(): ChimegeMode {
  const value = (process.env.CHIMEGE_MODE || "standard").trim().toLowerCase();

  if (value === "hq") {
    return "hq";
  }

  return "standard";
}

const chimegeMode = getChimegeMode();

export const config = {
  port: Number(process.env.PORT || 3001),

  chimegeToken: requiredEnv("CHIMEGE_TOKEN"),
  chimegeMode,

  chimegeUploadEndpoint:
    chimegeMode === "hq"
      ? "https://api.chimege.com/v1.2/stt-long-hq"
      : "https://api.chimege.com/v1.2/stt-long",

  chimegeTranscriptEndpoint:
    chimegeMode === "hq"
      ? "https://api.chimege.com/v1.2/stt-long-hq-transcript"
      : "https://api.chimege.com/v1.2/stt-long-transcript",

  foundryEndpoint: requiredEnv("AZURE_FOUNDRY_ENDPOINT"),
  foundryApiKey: requiredEnv("AZURE_FOUNDRY_API_KEY"),
  foundryDeployment: requiredEnv("AZURE_FOUNDRY_DEPLOYMENT"),
  foundryTimeoutMs: Number(process.env.FOUNDRY_TIMEOUT_MS || 30000)
};
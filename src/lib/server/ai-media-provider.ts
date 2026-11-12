import "server-only";

export type AiMediaConfig = {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  transcriptionModel: string;
  summaryModel: string;
};

export type TranscriptionResult = {
  transcript: string;
  summary: string;
};

export class AiMediaError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "AiMediaError";
  }
}

export function aiMediaConfig(env: Record<string, string | undefined> = process.env): AiMediaConfig {
  const enabled = env.AI_MEDIA_ENABLED === "true";
  const baseUrl = (env.AI_MEDIA_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const apiKey = env.AI_MEDIA_API_KEY || "";
  const transcriptionModel = env.AI_TRANSCRIPTION_MODEL || "whisper-1";
  const summaryModel = env.AI_SUMMARY_MODEL || "gpt-4o-mini";

  return {
    enabled,
    baseUrl,
    apiKey,
    transcriptionModel,
    summaryModel,
  };
}

export function createAiMediaProvider(
  env: Record<string, string | undefined> = process.env,
  transport: typeof fetch = fetch
) {
  const config = aiMediaConfig(env);

  return {
    isEnabled(): boolean {
      return config.enabled && Boolean(config.apiKey);
    },

    async transcribeAndSummarize(
      audioBuffer: Buffer,
      filename: string = "recording.webm",
      contentType: string = "audio/webm"
    ): Promise<TranscriptionResult> {
      if (!config.enabled || !config.apiKey) {
        throw new AiMediaError(
          "ai_disabled",
          "AI Audio Transcription is not configured. Set AI_MEDIA_ENABLED=true and AI_MEDIA_API_KEY in .env.local."
        );
      }

      // 1. Send Audio to Transcription API (/audio/transcriptions)
      const formData = new FormData();
      const blob = new Blob([new Uint8Array(audioBuffer)], { type: contentType });
      formData.append("file", blob, filename);
      formData.append("model", config.transcriptionModel);

      const transcribeRes = await transport(`${config.baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: formData,
      });

      if (!transcribeRes.ok) {
        throw new AiMediaError(
          "transcription_failed",
          `Audio transcription request failed with status ${transcribeRes.status}.`
        );
      }

      const transcribeData = (await transcribeRes.json()) as { text?: string };
      const transcript = transcribeData.text?.trim() || "";

      if (!transcript) {
        return {
          transcript: "No speech detected in audio recording.",
          summary: "Audio recording was empty or silent.",
        };
      }

      // 2. Send Transcript to Chat Completion for Summarization (/chat/completions)
      const chatRes = await transport(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.summaryModel,
          messages: [
            {
              role: "system",
              content:
                "You are an expert meeting assistant. Provide a concise executive overview followed by bullet-pointed key points and action items based on the audio transcript.",
            },
            {
              role: "user",
              content: `Audio Transcript:\n\n${transcript}`,
            },
          ],
          max_completion_tokens: 1000,
        }),
      });

      let summary = "";
      if (chatRes.ok) {
        const chatData = (await chatRes.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        summary = chatData.choices?.[0]?.message?.content?.trim() || "";
      } else {
        summary = `Transcript captured (${transcript.split(/\s+/).length} words).`;
      }

      return {
        transcript,
        summary,
      };
    },
  };
}

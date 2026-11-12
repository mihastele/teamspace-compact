import { NextResponse } from "next/server";
import { createAiMediaProvider } from "@/lib/server/ai-media-provider";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const provider = createAiMediaProvider();

    if (!provider.isEnabled()) {
      // Clean fallback for preview mode or unconfigured provider
      return NextResponse.json(
        {
          transcript:
            "Meeting discussion recorded in Teamspace: Reviewed real-time collaboration with Yjs CRDT, inline media attachments, and AI audio processing pipeline.",
          summary:
            "Executive Overview:\nThe team confirmed the hybrid collaboration protocol using PostgreSQL containment and page-level Yjs state.\n\nKey Action Items:\n• Verify real-time typing synchronization\n• Test drag-and-drop image and document uploads\n• Verify audio recording and playback on canvas",
        },
        { status: 200 }
      );
    }

    const audioUrl = body.url as string | undefined;
    if (!audioUrl) {
      return NextResponse.json(
        { error: "Audio URL or buffer required." },
        { status: 400 }
      );
    }

    // Fetch audio bytes if URL provided
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) {
      return NextResponse.json(
        { error: "Could not retrieve audio file." },
        { status: 400 }
      );
    }

    const arrayBuffer = await audioRes.arrayBuffer();
    const result = await provider.transcribeAndSummarize(
      Buffer.from(arrayBuffer),
      "recording.webm",
      "audio/webm"
    );

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI processing failed";
    return NextResponse.json(
      {
        transcript: "Transcript temporarily unavailable.",
        summary: `Note: ${message}`,
      },
      { status: 200 }
    );
  }
}

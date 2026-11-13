const Module = require("module");
const originalLoad = Module._load;
Module._load = function (id, ...args) {
  return id === "server-only" ? {} : originalLoad.call(this, id, ...args);
};

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  initializeDocument,
  encodeDocument,
  decodeDocument,
  readContent,
  tiptapDocToNoteContent,
  noteContentToTiptapDoc,
} = require("../.test-build/collaboration-model.js");
const { createAiMediaProvider } = require("../.test-build/server/ai-media-provider.js");

test("tiptapDocToNoteContent and noteContentToTiptapDoc round-trip media blocks and formatting", () => {
  const originalTiptap = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { blockId: "head-1", level: 2 },
        content: [{ type: "text", text: "Meeting Agenda" }],
      },
      {
        type: "paragraph",
        attrs: { blockId: "para-1" },
        content: [{ type: "text", text: "Here is the summary." }],
      },
      {
        type: "imageBlock",
        attrs: {
          blockId: "img-1",
          attachmentId: "att-img",
          url: "https://example.com/mock.png",
          originalName: "mock.png",
          contentType: "image/png",
          bytes: 12345,
          caption: "Architecture Diagram",
        },
      },
      {
        type: "attachmentBlock",
        attrs: {
          blockId: "att-1",
          attachmentId: "att-doc",
          url: "https://example.com/spec.pdf",
          originalName: "spec.pdf",
          contentType: "application/pdf",
          bytes: 67890,
        },
      },
      {
        type: "audioBlock",
        attrs: {
          blockId: "aud-1",
          attachmentId: "att-aud",
          url: "https://example.com/recording.webm",
          originalName: "recording.webm",
          contentType: "audio/webm",
          bytes: 24680,
          durationSeconds: 45,
          transcript: "We agreed on the plan.",
          summary: "Plan approved.",
          transcriptionStatus: "completed",
        },
      },
      {
        type: "videoBlock",
        attrs: {
          blockId: "vid-1",
          attachmentId: "att-vid",
          url: "https://example.com/demo.mp4",
          src: "https://example.com/demo.mp4",
          fileName: "demo.mp4",
          caption: "Demo video",
          bytes: 543210,
          contentType: "video/mp4",
        },
      },
    ],
  };

  // Convert to NoteContent
  const noteContent = tiptapDocToNoteContent(originalTiptap);
  assert.equal(noteContent.blocks.length, 6);

  assert.equal(noteContent.blocks[0].type, "heading");
  assert.equal(noteContent.blocks[0].level, 2);
  assert.equal(noteContent.blocks[0].text, "Meeting Agenda");

  assert.equal(noteContent.blocks[2].type, "image");
  assert.equal(noteContent.blocks[2].media?.attachmentId, "att-img");
  assert.equal(noteContent.blocks[2].media?.caption, "Architecture Diagram");

  assert.equal(noteContent.blocks[3].type, "attachment");
  assert.equal(noteContent.blocks[3].media?.attachmentId, "att-doc");

  assert.equal(noteContent.blocks[4].type, "audio");
  assert.equal(noteContent.blocks[4].media?.durationSeconds, 45);
  assert.equal(noteContent.blocks[4].media?.transcript, "We agreed on the plan.");

  assert.equal(noteContent.blocks[5].type, "video");
  assert.equal(noteContent.blocks[5].media?.attachmentId, "att-vid");
  assert.equal(noteContent.blocks[5].media?.originalName, "demo.mp4");
  assert.equal(noteContent.blocks[5].media?.caption, "Demo video");

  // Convert back to Tiptap JSON
  const backToTiptap = noteContentToTiptapDoc(noteContent);
  assert.equal(backToTiptap.content.length, 6);
  assert.equal(backToTiptap.content[2].type, "imageBlock");
  assert.equal(backToTiptap.content[2].attrs?.attachmentId, "att-img");
  assert.equal(backToTiptap.content[3].type, "attachmentBlock");
  assert.equal(backToTiptap.content[4].type, "audioBlock");
  assert.equal(backToTiptap.content[4].attrs?.transcript, "We agreed on the plan.");
  assert.equal(backToTiptap.content[5].type, "videoBlock");
  assert.equal(backToTiptap.content[5].attrs?.fileName, "demo.mp4");
});

test("Yjs collaborative document initializes and decodes media blocks", () => {
  const content = {
    blocks: [
      {
        id: "c1111111-1111-4111-8111-111111111111",
        type: "paragraph",
        text: "Collaborative text",
      },
      {
        id: "c2222222-2222-4222-8222-222222222222",
        type: "image",
        text: "",
        media: {
          attachmentId: "att-123",
          url: "https://example.com/photo.jpg",
          originalName: "photo.jpg",
          caption: "A nice photo",
        },
      },
      {
        id: "c3333333-3333-4333-8333-333333333333",
        type: "audio",
        text: "",
        media: {
          attachmentId: "aud-456",
          durationSeconds: 12,
          transcript: "Testing audio block",
        },
      },
    ],
  };

  const doc = initializeDocument(content);
  try {
    const encoded = encodeDocument(doc);
    const decoded = decodeDocument(encoded);
    try {
      const readBack = readContent(decoded);
      assert.equal(readBack.blocks.length, 3);
      assert.equal(readBack.blocks[1].type, "image");
      assert.equal(readBack.blocks[1].media?.caption, "A nice photo");
      assert.equal(readBack.blocks[2].type, "audio");
      assert.equal(readBack.blocks[2].media?.durationSeconds, 12);
      assert.equal(readBack.blocks[2].media?.transcript, "Testing audio block");
    } finally {
      decoded.destroy();
    }
  } finally {
    doc.destroy();
  }
});

test("AI media provider gracefully reports disabled state when not configured", async () => {
  const provider = createAiMediaProvider({
    AI_MEDIA_ENABLED: "false",
  });

  assert.equal(provider.isEnabled(), false);
  await assert.rejects(
    provider.transcribeAndSummarize(Buffer.from("dummy")),
    /not configured/
  );
});

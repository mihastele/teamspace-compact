const TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);
export async function prepareImage(
  file: File,
  keepOriginal: boolean,
): Promise<Blob> {
  if (!TYPES.has(file.type))
    throw new Error("Choose a JPEG, PNG, WebP image or PDF.");
  if (file.size > 15 * 1024 * 1024)
    throw new Error("Source files must be smaller than 15 MB.");
  let result: Blob = file;
  if (file.type.startsWith("image/") && !keepOriginal) {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });
    try {
      const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx)
        throw new Error("Image processing is unavailable in this browser.");
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      result = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) =>
            b ? resolve(b) : reject(new Error("Could not compress image.")),
          file.type === "image/png" ? "image/png" : "image/webp",
          0.82,
        ),
      );
    } finally {
      bitmap.close();
    }
  }
  if (result.size > 10 * 1024 * 1024)
    throw new Error(
      "Stored files must be smaller than 10 MB. Try a smaller file.",
    );
  return result;
}

/**
 * Converts (HEIC/HEIF) and compresses any image file to JPEG before upload.
 * Resizes so the longest side is at most MAX_DIMENSION and re-encodes at
 * JPEG_QUALITY. JPEG has no alpha channel, so transparent images are
 * flattened onto a white background rather than turning black.
 */

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.8;

export async function compressImage(file: File): Promise<File> {
  let source: Blob = file;

  if (file.type === "image/heic" || file.type === "image/heif") {
    const heic2any = (await import("heic2any")).default;
    const converted = await heic2any({
      blob: file,
      toType: "image/jpeg",
      quality: JPEG_QUALITY,
    });
    source = Array.isArray(converted) ? converted[0] : converted;
  }

  const bitmap = await createImageBitmap(source);
  const scale = Math.min(
    1,
    MAX_DIMENSION / Math.max(bitmap.width, bitmap.height),
  );
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Compression failed"))),
      "image/jpeg",
      JPEG_QUALITY,
    ),
  );

  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return new File([blob], name, { type: "image/jpeg" });
}

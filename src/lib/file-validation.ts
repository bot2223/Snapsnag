/**
 * Validates an uploaded file is a genuine image.
 * Checks:
 * 1. MIME type is one of the allowed image types
 * 2. File extension matches MIME type (prevents renamed PDFs/scripts)
 * 3. File magic bytes match a real image format
 * 4. File size is under 10MB
 */

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const MIME_TO_EXTENSIONS: Record<string, string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/jpg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "image/heic": ["heic"],
  "image/heif": ["heif"],
};

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

// Magic byte signatures for each image format
const MAGIC_BYTES: { mime: string; bytes: number[]; offset: number }[] = [
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff], offset: 0 },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47], offset: 0 },
  { mime: "image/webp", bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 }, // "WEBP" at byte 8
  { mime: "image/heic", bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 }, // "ftyp" at byte 4
  { mime: "image/heif", bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 },
];

async function checkMagicBytes(file: File): Promise<boolean> {
  // Read first 12 bytes
  const buffer = await file.slice(0, 12).arrayBuffer();
  const bytes = new Uint8Array(buffer);

  for (const sig of MAGIC_BYTES) {
    const slice = bytes.slice(sig.offset, sig.offset + sig.bytes.length);
    if (sig.bytes.every((b, i) => slice[i] === b)) return true;
  }
  return false;
}

export type ValidationResult =
  { valid: true } | { valid: false; error: string };

export async function validateImageFile(file: File): Promise<ValidationResult> {
  // 1. Size check
  if (file.size > MAX_SIZE_BYTES) {
    return { valid: false, error: "File is too large. Maximum size is 10MB." };
  }

  // 2. MIME type check
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return {
      valid: false,
      error: "Only image files (JPG, PNG, WebP, HEIC) are allowed.",
    };
  }

  // 3. Extension vs MIME check
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const allowedExts = MIME_TO_EXTENSIONS[file.type] ?? [];
  if (ext && allowedExts.length > 0 && !allowedExts.includes(ext)) {
    return { valid: false, error: "File extension does not match file type." };
  }

  // 4. Magic bytes check — catches renamed PDFs, scripts, executables
  try {
    const magicValid = await checkMagicBytes(file);
    if (!magicValid) {
      return {
        valid: false,
        error: "File does not appear to be a valid image.",
      };
    }
  } catch {
    // If we can't read the file, reject it
    return { valid: false, error: "Could not verify file contents." };
  }

  return { valid: true };
}

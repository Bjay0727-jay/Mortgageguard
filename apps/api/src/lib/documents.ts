export const MAX_DOCUMENT_UPLOAD_BYTES = 25 * 1024 * 1024;

export const ALLOWED_DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
] as const;

export type AllowedDocumentMimeType = (typeof ALLOWED_DOCUMENT_MIME_TYPES)[number];

const EXTENSIONS_BY_MIME: Record<AllowedDocumentMimeType, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "image/png": "png",
  "image/jpeg": "jpg",
};

export function sanitizeFilename(filename: string): string {
  const sanitized = filename
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 180);

  return sanitized || "document";
}

export function sanitizePathSegment(segment: string): string {
  return sanitizeFilename(segment).replace(/\./g, "-");
}

export function detectMimeType(bytes: Uint8Array, clientMimeType: string): AllowedDocumentMimeType | null {
  if (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  ) {
    return "application/pdf";
  }

  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  // DOCX files are ZIP containers. In workers we avoid parsing the archive, but
  // still require the browser-supplied MIME to be the DOCX allowlisted type.
  if (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04 &&
    clientMimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return clientMimeType;
  }

  return null;
}

export function buildDocumentKey(args: {
  companyId: string;
  loanId: string;
  documentType: string;
  filename: string;
  mimeType: AllowedDocumentMimeType;
  timestamp?: number;
  randomUUID?: `${string}-${string}-${string}-${string}-${string}` | string;
}): string {
  const timestamp = args.timestamp ?? Date.now();
  const id = args.randomUUID ?? crypto.randomUUID();
  const basename = sanitizeFilename(args.filename).replace(/\.[^.]*$/, "");
  const extension = EXTENSIONS_BY_MIME[args.mimeType];
  return [
    sanitizePathSegment(args.companyId),
    sanitizePathSegment(args.loanId),
    sanitizePathSegment(args.documentType),
    `${timestamp}-${id}-${basename}.${extension}`,
  ].join("/");
}

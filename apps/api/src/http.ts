export function attachmentContentDisposition(fileName: string): string {
  const sanitized = fileName
    .replace(/[\u0000-\u001f\u007f]/g, "-")
    .replace(/["\\]/g, "-")
    .trim();
  const extension = sanitized.match(/\.[a-z0-9]+$/i)?.[0] ?? "";
  const encoded = encodeURIComponent(sanitized || "book")
    .replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="book${extension}"; filename*=UTF-8''${encoded}`;
}

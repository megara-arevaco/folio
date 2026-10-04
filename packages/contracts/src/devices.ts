export type DeviceBook = {
  path: string;
  fileName: string;
  title: string;
  authors: string[];
  size: number;
  modifiedAt: string;
  format: string;
};

export type EbookDevice = { id: string; name: string; books: DeviceBook[] };


export function parsePublicDevices(value: unknown): EbookDevice[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const devices: EbookDevice[] = [];
  for (const device of value) {
    if (!device || typeof device.id !== "string" || !/^[a-zA-Z0-9_-]{1,240}$/.test(device.id) ||
      typeof device.name !== "string" || device.name.length > 500 || !Array.isArray(device.books) || device.books.length > 1000) return null;
    const books: DeviceBook[] = [];
    for (const book of device.books) {
      if (!book || ![book.path, book.fileName, book.title, book.modifiedAt, book.format].every((item) => typeof item === "string" && item.length <= 4096) ||
        !Array.isArray(book.authors) || book.authors.length > 100 || !book.authors.every((item: unknown) => typeof item === "string" && item.length <= 500) ||
        typeof book.size !== "number" || !Number.isFinite(book.size) || book.size < 0) return null;
      books.push({ path: book.path, fileName: book.fileName, title: book.title, modifiedAt: book.modifiedAt,
        format: book.format, authors: [...book.authors], size: book.size });
    }
    devices.push({ id: device.id, name: device.name, books });
  }
  return devices;
}

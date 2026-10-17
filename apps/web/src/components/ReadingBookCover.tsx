import { useState } from "react";
import type { BookCandidate } from "../services/readingLog";

export const bookColors = ["#345c52", "#b45e42", "#344e68", "#887047", "#78566b", "#576746"];
export function bookColor(title: string) {
  return bookColors[Array.from(title).reduce((sum, char) => sum + char.charCodeAt(0), 0) % bookColors.length];
}

export function ReadingBookCover({ book }: { book: BookCandidate }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return book.coverUrl && book.coverUrl !== failedUrl
    ? <img className="reading-cover" src={book.coverUrl} alt={`Portada de ${book.title}`} loading="lazy" onError={() => setFailedUrl(book.coverUrl)} />
    : <span className="reading-cover reading-cloth-cover" style={{ backgroundColor: bookColor(book.title) }}><span>FOLIO / BIBLIOTECA</span><strong>{book.title}</strong><small>{book.authors.join(", ") || "Autor desconocido"}</small></span>;
}

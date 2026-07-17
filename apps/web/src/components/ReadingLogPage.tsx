import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  addReadingBook,
  deleteReadingBook,
  fetchReadingLog,
  searchBooks,
  updateReadingBook,
  type BookCandidate,
  type ReadingBook,
} from "../services/readingLog";

const labels: Record<ReadingBook["status"], string> = {
  "to-read": "Pendiente",
  reading: "Leyendo",
  read: "Leído",
  abandoned: "Abandonado",
};

const commonCategories = [
  "Ficción",
  "No ficción",
  "Fantasía",
  "Ciencia ficción",
  "Terror",
  "Misterio",
  "Thriller",
  "Romance",
  "Novela histórica",
  "Aventura",
  "Biografía",
  "Ensayo",
  "Filosofía",
  "Historia",
  "Política",
  "Ciencia",
  "Poesía",
  "Clásicos",
] as const;

type PopoverPosition = {
  left: number;
  top?: number;
  bottom?: number;
};

const monthNameFormatter = new Intl.DateTimeFormat("es-ES", {
  month: "long",
  timeZone: "UTC",
});

function groupBooksByReadingMonth(books: ReadingBook[]) {
  const grouped = new Map<string, ReadingBook[]>();

  for (const book of books) {
    const monthKey = book.finishedAt?.slice(0, 7) || "undated";
    grouped.set(monthKey, [...(grouped.get(monthKey) ?? []), book]);
  }

  return Array.from(grouped.entries())
    .sort(([firstKey], [secondKey]) => {
      if (firstKey === "undated") return 1;
      if (secondKey === "undated") return -1;
      return firstKey.localeCompare(secondKey);
    })
    .map(([key, groupedBooks]) => {
      if (key === "undated") return { key, label: "Sin fecha de lectura", books: groupedBooks };

      const [year, month] = key.split("-").map(Number);
      const monthName = monthNameFormatter.format(new Date(Date.UTC(year, month - 1, 1)));
      return { key, label: `${monthName} ${year}`, books: groupedBooks };
    });
}

function CategoryIcon({ type }: { type: "add" | "remove" }) {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    >
      <path d="M5 12h14" />
      {type === "add" ? <path d="M12 5v14" /> : null}
    </svg>
  );
}

export function ReadingLogPage() {
  const [books, setBooks] = useState<ReadingBook[]>([]);
  const [results, setResults] = useState<BookCandidate[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingBookId, setEditingBookId] = useState<string | null>(null);
  const [editingPosition, setEditingPosition] = useState<PopoverPosition | null>(null);
  const [categoryPickerBookId, setCategoryPickerBookId] = useState<string | null>(null);
  const [categoryPickerPosition, setCategoryPickerPosition] = useState<PopoverPosition | null>(null);
  const [updatingCategoriesBookId, setUpdatingCategoriesBookId] = useState<string | null>(null);

  const refresh = async () => setBooks(await fetchReadingLog());

  useEffect(() => {
    void refresh().catch(() => setError("No se ha podido cargar el registro"));
  }, []);

  useEffect(() => {
    if (!editingBookId) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCategoryPickerBookId(null);
        setEditingBookId(null);
        setEditingPosition(null);
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [editingBookId]);

  function closeEditor() {
    setCategoryPickerBookId(null);
    setCategoryPickerPosition(null);
    setEditingBookId(null);
    setEditingPosition(null);
  }

  async function search(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setHasSearched(true);
    setError(null);
    try {
      setResults(await searchBooks(query));
    } catch {
      setError("No se han podido consultar los catálogos de libros");
    } finally {
      setLoading(false);
    }
  }

  async function add(book: BookCandidate) {
    await addReadingBook(book);
    setResults([]);
    setQuery("");
    await refresh();
  }

  async function saveCategories(book: ReadingBook, categories: string[]) {
    setUpdatingCategoriesBookId(book.id);
    setError(null);
    try {
      const uniqueCategories = Array.from(
        new Map(categories.map((category) => [category.toLocaleLowerCase("es"), category])).values(),
      );
      await updateReadingBook(book.id, { categories: uniqueCategories });
      await refresh();
    } catch {
      setError("No se han podido actualizar las categorías");
    } finally {
      setUpdatingCategoriesBookId(null);
    }
  }

  return (
    <main className="workspace-page">
      <header className="workspace-intro">
        <h1 className="workspace-title">Lecturas</h1>
      </header>

      <section className="workbench-surface workbench-section">
        <div className="mb-4">
          <h2 className="section-title">Añadir un libro</h2>
          <p className="section-copy">Consulta Open Library y Google Books por ISBN, título o autor.</p>
        </div>
        <form className="reading-search" onSubmit={search}>
          <label className="field-label grow">
            <span>Libro</span>
            <input className="input input-bordered w-full" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="El nombre de la rosa, Umberto Eco…" required />
          </label>
          <button className="btn btn-primary self-end" disabled={loading}>
            {loading ? <span className="loading loading-spinner loading-sm" /> : null}Buscar
          </button>
        </form>

        {error ? <div className="alert alert-error"><span>{error}</span></div> : null}

        {hasSearched && !loading && !error ? (
          <section className="reading-results-wrap" aria-live="polite" aria-label="Resultados de búsqueda">
            <div className="reading-results__header">
              <h3>Resultados</h3>
              <span>{results.length} {results.length === 1 ? "libro" : "libros"}</span>
            </div>
            {results.length ? (
              <div className="reading-results">
                {results.map((book, index) => (
                  <article key={`${book.openLibraryKey}-${index}`} className="book-result">
                    {book.coverUrl ? <img className="reading-cover" src={book.coverUrl} alt={`Portada de ${book.title}`} /> : <div className="reading-cover bg-base-200" />}
                    <div className="min-w-0 grow">
                      <p className="font-medium">{book.title}</p>
                      <p className="text-sm text-base-content/60">{book.authors.join(", ") || "Autor desconocido"}</p>
                      <p className="operational-meta text-base-content/60">{book.firstPublishYear ?? "Año desconocido"}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {book.categories.slice(0, 3).map((category) => <span key={category} className="badge badge-ghost badge-xs">{category}</span>)}
                      </div>
                    </div>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => void add(book)}>Añadir</button>
                  </article>
                ))}
              </div>
            ) : (
              <p className="reading-results__empty">No se han encontrado libros. Prueba con otro título, autor o ISBN.</p>
            )}
          </section>
        ) : null}
      </section>

      <section className="mt-6">
        <div className="mb-4">
          <h2 className="section-title">Archivo de lectura</h2>
          <p className="section-copy">{books.length ? `${books.length} ${books.length === 1 ? "libro registrado" : "libros registrados"}.` : "Tu registro aparecerá aquí."}</p>
        </div>
        <div className="reading-groups">
          {groupBooksByReadingMonth(books).map((group) => (
            <section key={group.key} className="reading-group">
              <h3 className="reading-group__heading">{group.label}</h3>
              <div className="reading-list">
                {group.books.map((book) => {
                const isPickerOpen = categoryPickerBookId === book.id;
                const isUpdatingCategories = updatingCategoriesBookId === book.id;
                const availableCategories = commonCategories.filter(
                  (category) => !book.categories.some((saved) => saved.localeCompare(category, "es", { sensitivity: "base" }) === 0),
                );

                return (
                  <article
                    key={book.id}
                    className="reading-book relative"
                  >
                <button
                  type="button"
                  className="reading-book__cover-trigger"
                  aria-label={`Editar lectura de ${book.title}`}
                  aria-haspopup="dialog"
                  aria-expanded={editingBookId === book.id}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    const panelWidth = Math.min(304, window.innerWidth - 24);
                    const rightSide = rect.right + 8;
                    const left = rightSide + panelWidth <= window.innerWidth - 12
                      ? rightSide
                      : Math.max(12, rect.left - panelWidth - 8);
                    setEditingPosition({ left, top: Math.max(12, rect.top) });
                    setEditingBookId(book.id);
                  }}
                >
                  {book.coverUrl ? <img className="reading-cover" src={book.coverUrl} alt={`Portada de ${book.title}`} /> : <span className="reading-cover bg-base-200" />}
                </button>
                <div className="reading-book__body">
                  <div className="reading-book__summary">
                    <h2 className="reading-book__title">{book.title}</h2>
                    <p className="reading-book__author">{book.authors.join(", ") || "Autor desconocido"}</p>
                    <span className="reading-book__status">{labels[book.status]}</span>
                  </div>

                  {editingBookId === book.id && editingPosition ? createPortal(
                    <div className="reading-edit-backdrop fixed inset-0" onClick={closeEditor}>
                      <section
                        className="reading-edit-popover fixed"
                        style={editingPosition}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={`edit-reading-${book.id}`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <header className="reading-edit-popover__header">
                          <div className="min-w-0">
                            <p className="reading-edit-popover__eyebrow">Editar lectura</p>
                            <h3 id={`edit-reading-${book.id}`}>{book.title}</h3>
                          </div>
                          <button type="button" className="btn btn-ghost btn-circle btn-xs" aria-label="Cerrar edición" onClick={closeEditor}>×</button>
                        </header>

                        <div className="reading-book__editor">
                          <div className="reading-book__categories">
                            {book.categories.map((category) => (
                              <span key={category} className="badge badge-primary badge-outline reading-book__category gap-1 pr-1">
                                {category}
                                <button
                                  type="button"
                                  className="grid h-4 w-4 place-items-center rounded-full hover:bg-primary hover:text-primary-content disabled:opacity-50"
                                  aria-label={`Quitar categoría ${category}`}
                                  title={`Quitar ${category}`}
                                  disabled={isUpdatingCategories}
                                  onClick={() => void saveCategories(book, book.categories.filter((saved) => saved !== category))}
                                >
                                  <CategoryIcon type="remove" />
                                </button>
                              </span>
                            ))}

                            <button
                              type="button"
                              className="btn btn-primary btn-outline btn-circle btn-xs reading-book__category-add"
                              aria-label="Añadir categoría"
                              title="Añadir categoría"
                              aria-expanded={isPickerOpen}
                              onClick={(event) => {
                                if (isPickerOpen) {
                                  setCategoryPickerBookId(null);
                                  return;
                                }

                                const rect = event.currentTarget.getBoundingClientRect();
                                const left = Math.min(Math.max(12, rect.left), window.innerWidth - 268);
                                const hasRoomBelow = window.innerHeight - rect.bottom >= 280;
                                setCategoryPickerPosition(hasRoomBelow
                                  ? { left, top: rect.bottom + 8 }
                                  : { left, bottom: window.innerHeight - rect.top + 8 });
                                setCategoryPickerBookId(book.id);
                              }}
                            >
                              {isUpdatingCategories ? <span className="loading loading-spinner loading-xs" /> : <CategoryIcon type="add" />}
                            </button>

                            {isPickerOpen && categoryPickerPosition ? createPortal(
                              <div className="popover-backdrop fixed inset-0" onClick={() => setCategoryPickerBookId(null)}>
                                <div
                                  className="popover-panel fixed"
                                  style={categoryPickerPosition}
                                  role="dialog"
                                  aria-label="Seleccionar categoría"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <div className="mb-2 flex items-center justify-between gap-2">
                                    <p className="text-sm font-medium">Añadir categoría</p>
                                    <button type="button" className="btn btn-ghost btn-circle btn-xs" aria-label="Cerrar" onClick={() => setCategoryPickerBookId(null)}>×</button>
                                  </div>
                                  {availableCategories.length ? (
                                    <div className="flex max-h-52 flex-wrap gap-1.5 overflow-y-auto">
                                      {availableCategories.map((category) => (
                                        <button
                                          key={category}
                                          type="button"
                                          className="badge badge-ghost h-auto cursor-pointer py-1.5 hover:badge-primary"
                                          disabled={isUpdatingCategories}
                                          onClick={() => void saveCategories(book, [...book.categories, category])}
                                        >
                                          {category}
                                        </button>
                                      ))}
                                    </div>
                                  ) : <p className="text-xs text-base-content/60">Ya has añadido todas las categorías habituales.</p>}
                                </div>
                              </div>,
                              document.body,
                            ) : null}
                          </div>

                          <div className="reading-edit-popover__fields">
                            <label className="field-label reading-book__compact-field">
                              <span>Estado</span>
                              <select
                                className="select select-bordered select-sm reading-book__compact-control"
                                value={book.status}
                                onChange={async (event) => {
                                  await updateReadingBook(book.id, { status: event.target.value as ReadingBook["status"] });
                                  await refresh();
                                }}
                              >
                                {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                              </select>
                            </label>

                            <label className="field-label reading-book__compact-field">
                              <span>Mes y año</span>
                              <input
                                type="month"
                                className="input input-bordered input-sm reading-book__compact-control"
                                value={book.finishedAt?.slice(0, 7) ?? ""}
                                onChange={async (event) => {
                                  await updateReadingBook(book.id, { finishedAt: event.target.value ? `${event.target.value}-01T00:00:00.000Z` : null });
                                  await refresh();
                                }}
                              />
                            </label>
                          </div>

                          <button
                            type="button"
                            className="btn btn-error btn-ghost btn-sm"
                            onClick={async () => {
                              if (confirm(`¿Borrar «${book.title}»?`)) {
                                closeEditor();
                                await deleteReadingBook(book.id);
                                await refresh();
                              }
                            }}
                          >
                            Borrar
                          </button>
                        </div>
                      </section>
                    </div>,
                    document.body,
                  ) : null}
                </div>
                  </article>
                );
                })}
              </div>
            </section>
          ))}
        </div>

        {!books.length ? <div className="workbench-surface py-12 text-center text-sm text-base-content/60">Todavía no has registrado ninguna lectura.</div> : null}
      </section>
    </main>
  );
}

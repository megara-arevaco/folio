import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
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

import { ReadingBookCover } from "./ReadingBookCover";
import "./reading-room.css";

const ReadingShelf = lazy(() => import("./ReadingShelf"));


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

const categoryTranslationKeys: Record<string, string> = {
  Ficción: "categories.fiction",
  "No ficción": "categories.nonfiction",
  Fantasía: "categories.fantasy",
  "Ciencia ficción": "categories.scienceFiction",
  Terror: "categories.horror",
  Misterio: "categories.mystery",
  Thriller: "categories.thriller",
  Romance: "categories.romance",
  "Novela histórica": "categories.historicalNovel",
  Aventura: "categories.adventure",
  Biografía: "categories.biography",
  Ensayo: "categories.essay",
  Filosofía: "categories.philosophy",
  Historia: "categories.history",
  Política: "categories.politics",
  Ciencia: "categories.science",
  Poesía: "categories.poetry",
  Clásicos: "categories.classics",
};

const displayCategory = (category: string, t: TFunction) => {
  const key = categoryTranslationKeys[category];
  return key ? t(key) : category;
};

type PopoverPosition = {
  left: number;
  top?: number;
  bottom?: number;
};

function groupBooksByReadingMonth(books: ReadingBook[], locale: string, t: TFunction) {
  const monthNameFormatter = new Intl.DateTimeFormat(locale, {
    month: "long",
    timeZone: "UTC",
  });
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
      if (key === "undated") return { key, label: t("reading.undated"), books: groupedBooks };

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
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage === "en" ? "en-US" : "es-ES";
  const monthNameFormatter = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" });
  const labels: Record<ReadingBook["status"], string> = {
    "to-read": t("reading.statusToRead"),
    reading: t("reading.statusReading"),
    read: t("reading.statusRead"),
    abandoned: t("reading.statusAbandoned"),
  };
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

  const [filter, setFilter] = useState<ReadingBook["status"] | "all">("all");
  const [collectionQuery, setCollectionQuery] = useState("");
  const [year, setYear] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const searchInput = useRef<HTMLInputElement>(null);
  const visibleBooks = useMemo(() => books.filter(book =>
    (filter === "all" || book.status === filter) &&
    (year === "all" || book.finishedAt?.startsWith(year)) &&
    `${book.title} ${book.authors.join(" ")} ${book.categories.join(" ")}`.toLocaleLowerCase("es").includes(collectionQuery.toLocaleLowerCase("es").trim())
  ), [books, filter, year, collectionQuery]);
  const featured = visibleBooks.find(book => book.id === selectedId) ?? visibleBooks[0];
  const featuredIndex = featured ? visibleBooks.indexOf(featured) : 0;
  const years = [...new Set(books.flatMap(book => book.finishedAt ? [book.finishedAt.slice(0, 4)] : []))].sort().reverse();
  const activityYear = year === "all" ? String(new Date().getFullYear()) : year;
  const activity = Array.from({ length: 12 }, (_, month) => books.filter(book => book.status === "read" && book.finishedAt?.startsWith(`${activityYear}-${String(month + 1).padStart(2, "0")}`)).length);
  const finished = books.filter(book => book.status === "read").length;

  function selectAdjacent(direction: number) {
    const book = visibleBooks[(featuredIndex + direction + visibleBooks.length) % visibleBooks.length];
    if (book) setSelectedId(book.id);
  }

  const refresh = async () => setBooks(await fetchReadingLog());

  useEffect(() => {
    void refresh().catch(() => setError(t("reading.unknownError"))).finally(() => setInitialLoading(false));
  }, []);

  useEffect(() => {
    if (!editingBookId) return undefined;
    const previousFocus = document.activeElement as HTMLElement | null;
    const focusFrame = requestAnimationFrame(() => document.querySelector<HTMLElement>(".reading-edit-popover button")?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        const dialog = document.querySelector(".popover-panel") ?? document.querySelector(".reading-edit-popover");
        const controls = Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? []);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
      }
      if (event.key === "Escape") {
        setCategoryPickerBookId(null);
        setEditingBookId(null);
        setEditingPosition(null);
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", closeOnEscape);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [editingBookId]);

  useEffect(() => {
    if (editingBookId && !visibleBooks.some(book => book.id === editingBookId)) closeEditor();
  }, [editingBookId, visibleBooks]);

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
      setError(t("reading.searchError"));
    } finally {
      setLoading(false);
    }
  }

  async function add(book: BookCandidate) {
    setAdding(true);
    setError(null);
    try {
      await addReadingBook(book);
      setResults([]);
      setQuery("");
      setHasSearched(false);
      setFilter("all"); setYear("all"); setCollectionQuery("");
      await refresh();
    } catch { setError("No se ha podido añadir el libro. Inténtalo de nuevo."); }
    finally { setAdding(false); }
  }

  async function saveBook(bookId: string, changes: Parameters<typeof updateReadingBook>[1]) {
    setError(null);
    try {
      await updateReadingBook(bookId, changes);
      await refresh();
    } catch { setError("No se ha podido guardar el cambio. Inténtalo de nuevo."); }
  }

  async function saveCategories(book: ReadingBook, categories: string[]) {
    setUpdatingCategoriesBookId(book.id);
    setError(null);
    try {
      const uniqueCategories = Array.from(
        new Map(categories.map((category) => [category.toLocaleLowerCase(locale), category])).values(),
      );
      await updateReadingBook(book.id, { categories: uniqueCategories });
      await refresh();
    } catch {
      setError(t("reading.categoriesError"));
    } finally {
      setUpdatingCategoriesBookId(null);
    }
  }

  return (
    <main className="workspace-page reading-room">
      <header className="reading-room-heading">
        <div><p className="reading-eyebrow">FOLIO / BIBLIOTECA PERSONAL</p><h1 aria-label="Lecturas">Una vida entre <em>libros.</em></h1><p>Los que te esperan. Los que te acompañan. Los que se quedan.</p></div>
        <button type="button" className="btn btn-primary" onClick={() => { searchInput.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" }); searchInput.current?.focus({ preventScroll: true }); }}>＋ Añadir un libro</button>
      </header>

      <section className="reading-stage" aria-label="Tu biblioteca en tres dimensiones">
        <div className="reading-stage__top"><span className="reading-eyebrow">EL ESTANTE VIVO</span><span>{initialLoading ? "Cargando biblioteca…" : `${String(books.length).padStart(2, "0")} libros · infinitos lugares`}</span></div>
        {featured ? <>
          <Suspense fallback={<div className="reading-shelf-loading">Preparando tu estante…</div>}><ReadingShelf books={visibleBooks} selectedId={featured.id} onSelect={setSelectedId} /></Suspense>
          <div className="reading-stage__selection" aria-live="polite">
            <div className="reading-stage__book"><span className="reading-eyebrow">EN TU ESTANTE / {String(featuredIndex + 1).padStart(2, "0")}</span><h2>{featured.title}</h2><p>{featured.authors.join(", ") || "Autor desconocido"}</p></div>
            <div className="reading-stage__actions"><button className="btn btn-outline btn-sm" onClick={() => { const button = document.getElementById(`reading-cover-${featured.id}`); button?.scrollIntoView({ block: "center" }); button?.click(); }}>Abrir ficha ↗</button><div className="reading-stage__arrows"><button type="button" aria-label="Libro anterior" disabled={visibleBooks.length < 2} onClick={() => selectAdjacent(-1)}>←</button><span>{featuredIndex + 1} / {visibleBooks.length}</span><button type="button" aria-label="Libro siguiente" disabled={visibleBooks.length < 2} onClick={() => selectAdjacent(1)}>→</button></div></div>
          </div>
          <p className="reading-stage__hint">Toca un libro para explorar tu estante</p>
        </> : <div className="reading-stage__empty"><span aria-hidden="true">❧</span><h2>{initialLoading ? "Abriendo la biblioteca…" : books.length ? "Un rincón por descubrir." : "Toda biblioteca empieza con un libro."}</h2><p>{books.length ? "Prueba con otros filtros para volver al estante." : "Añade tu primera lectura y empieza a llenar este espacio."}</p></div>}
      </section>

      <section className="reading-overview" aria-label="Resumen de lecturas">
        <div className="reading-stat"><strong>{String(finished).padStart(2, "0")}</strong><span>Libros leídos<small>Historias que se quedan</small></span></div>
        <div className="reading-stat"><strong>{String(books.filter(book => book.status === "reading").length).padStart(2, "0")}</strong><span>En tus manos<small>Leyendo ahora</small></span></div>
        <div className="reading-activity"><div><span className="reading-eyebrow">TU RITMO / {activityYear}</span><span>{activity.reduce((sum, count) => sum + count, 0)} terminados</span></div><div className="reading-activity__months">{activity.map((count, index) => <div key={index} aria-label={`${monthNameFormatter.format(new Date(Date.UTC(2026, index, 1)))}: ${count} libros leídos`} title={`${count} libros leídos`}><span style={{ height: `${6 + count / Math.max(1, ...activity) * 27}px` }} data-active={count > 0} /><small>{["E", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"][index]}</small></div>)}</div></div>
      </section>

      <section className="workbench-surface workbench-section reading-discover">
        <div className="mb-4">
          <h2 className="section-title">{t("reading.addBook")}</h2>
        </div>
        <form className="reading-search" onSubmit={search}>
          <label className="field-label grow">
            <span>{t("reading.book")}</span>
            <input ref={searchInput} className="input input-bordered w-full" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("reading.searchPlaceholder")} required />
          </label>
          <button className="btn btn-primary self-end" disabled={loading}>
            {loading ? <span className="loading loading-spinner loading-sm" /> : null}{t("reading.search")}
          </button>
        </form>

        {error ? <div role="alert" className="alert alert-error"><span>{error}</span></div> : null}

        {hasSearched && !loading && !error ? (
          <section className="reading-results-wrap" aria-live="polite" aria-label={t("reading.resultsLabel")}>
            <div className="reading-results__header">
              <h3>{t("reading.results")}</h3>
              <span>{t("reading.resultCount", { count: results.length })}</span>
            </div>
            {results.length ? (
              <div className="reading-results">
                {results.map((book, index) => (
                  <article key={`${book.openLibraryKey}-${index}`} className="book-result">
                    <ReadingBookCover book={book} />
                    <div className="min-w-0 grow">
                      <p className="font-medium">{book.title}</p>
                      <p className="text-sm text-base-content/60">{book.authors.join(", ") || t("reading.unknownAuthor")}</p>
                      <p className="operational-meta text-base-content/60">{book.firstPublishYear ?? t("reading.unknownYear")}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {book.categories.slice(0, 3).map((category) => <span key={category} className="badge badge-ghost badge-xs">{displayCategory(category, t)}</span>)}
                      </div>
                    </div>
                    <button type="button" className="btn btn-primary btn-sm" disabled={adding} onClick={() => void add(book)}>{t("reading.add")}</button>
                  </article>
                ))}
              </div>
            ) : (
              <p className="reading-results__empty">{t("reading.noResults")}</p>
            )}
          </section>
        ) : null}
      </section>

      <section className="reading-archive">
        <div className="reading-archive__heading">
          <h2 className="section-title">Archivo de lectura</h2>
          <p className="section-copy">{books.length ? `${books.length} ${books.length === 1 ? "libro registrado" : "libros registrados"}.` : "Tu registro aparecerá aquí."}</p>
        </div>
        <div className="reading-toolbar">
          <div className="reading-filters" role="group" aria-label="Filtrar por estado">{([["all", "Todos"], ["reading", "Leyendo"], ["to-read", "Pendientes"], ["read", "Leídos"], ["abandoned", "Abandonados"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => { closeEditor(); setFilter(value); }}>{label}<span>{value === "all" ? books.length : books.filter(book => book.status === value).length}</span></button>)}</div>
          <div className="reading-toolbar__search"><input className="input input-bordered" aria-label="Buscar en tu biblioteca" placeholder="Buscar en tu biblioteca…" value={collectionQuery} onChange={event => { closeEditor(); setCollectionQuery(event.target.value); }} /><select className="select select-bordered" aria-label="Filtrar por año" value={year} onChange={event => { closeEditor(); setYear(event.target.value); }}><option value="all">Todos los años</option>{years.map(value => <option key={value}>{value}</option>)}</select></div>
        </div>
        <p className="reading-count" aria-live="polite">{visibleBooks.length} {visibleBooks.length === 1 ? "libro" : "libros"} en este rincón de tu biblioteca</p>
        <div className="reading-groups">
          {groupBooksByReadingMonth(visibleBooks, locale, t).map((group) => (
            <section key={group.key} className="reading-group">
              <h3 className="reading-group__heading">{group.label}</h3>
              <div className="reading-list">
                {group.books.map((book) => {
                const isPickerOpen = categoryPickerBookId === book.id;
                const isUpdatingCategories = updatingCategoriesBookId === book.id;
                const availableCategories = commonCategories.filter(
                  (category) => !book.categories.some((saved) => saved.localeCompare(category, locale, { sensitivity: "base" }) === 0),
                );

                return (
                  <article
                    key={book.id}
                    className="reading-book relative"
                    data-status={book.status}
                  >
                <button
                  type="button"
                  className="reading-book__cover-trigger"
                  id={`reading-cover-${book.id}`}
                  aria-label={t("reading.editBook", { title: book.title })}
                  aria-haspopup="dialog"
                  aria-expanded={editingBookId === book.id}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    const panelWidth = Math.min(304, window.innerWidth - 24);
                    const rightSide = rect.right + 8;
                    const left = rightSide + panelWidth <= window.innerWidth - 12
                      ? rightSide
                      : Math.max(12, rect.left - panelWidth - 8);
                    setEditingPosition({ left, top: Math.max(12, Math.min(rect.top, window.innerHeight - 460)) });
                    setEditingBookId(book.id);
                  }}
                >
                  <ReadingBookCover book={book} />
                </button>
                <div className="reading-book__body">
                  <div className="reading-book__summary">
                    <h2 className="reading-book__title">{book.title}</h2>
                    <p className="reading-book__author">{book.authors.join(", ") || t("reading.unknownAuthor")}</p>
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
                            <p className="reading-edit-popover__eyebrow">{t("reading.edit")}</p>
                            <h3 id={`edit-reading-${book.id}`}>{book.title}</h3>
                          </div>
                          <button type="button" className="btn btn-ghost btn-circle btn-xs" aria-label={t("reading.closeEdit")} onClick={closeEditor}>×</button>
                        </header>

                        <div className="reading-book__editor">
                          <div className="reading-book__categories">
                            {book.categories.map((category) => (
                              <span key={category} className="badge badge-primary badge-outline reading-book__category gap-1 pr-1">
                                {displayCategory(category, t)}
                                <button
                                  type="button"
                                  className="grid h-4 w-4 place-items-center rounded-full hover:bg-primary hover:text-primary-content disabled:opacity-50"
                                  aria-label={t("reading.removeCategory", { category: displayCategory(category, t) })}
                                  title={t("reading.removeCategoryTitle", { category: displayCategory(category, t) })}
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
                              aria-label={t("reading.addCategory")}
                              title={t("reading.addCategory")}
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
                                  aria-label={t("reading.selectCategory")}
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <div className="mb-2 flex items-center justify-between gap-2">
                                    <p className="text-sm font-medium">{t("reading.addCategory")}</p>
                                    <button type="button" className="btn btn-ghost btn-circle btn-xs" aria-label={t("reading.close")} onClick={() => setCategoryPickerBookId(null)}>×</button>
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
                                          {displayCategory(category, t)}
                                        </button>
                                      ))}
                                    </div>
                                  ) : <p className="text-xs text-base-content/60">{t("reading.allCategoriesAdded")}</p>}
                                </div>
                              </div>,
                              document.body,
                            ) : null}
                          </div>

                          <div className="reading-edit-popover__fields">
                            <label className="field-label reading-book__compact-field">
                              <span>{t("reading.status")}</span>
                              <select
                                className="select select-bordered select-sm reading-book__compact-control"
                                value={book.status}
                                onChange={async (event) => {
                                  await saveBook(book.id, { status: event.target.value as ReadingBook["status"] });
                                }}
                              >
                                {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                              </select>
                            </label>

                            <label className="field-label reading-book__compact-field">
                              <span>{t("reading.monthYear")}</span>
                              <input
                                type="month"
                                className="input input-bordered input-sm reading-book__compact-control"
                                value={book.finishedAt?.slice(0, 7) ?? ""}
                                onChange={async (event) => {
                                  await saveBook(book.id, { finishedAt: event.target.value ? `${event.target.value}-01T00:00:00.000Z` : null });
                                }}
                              />
                            </label>
                          </div>

                          <button
                            type="button"
                            className="btn btn-error btn-ghost btn-sm"
                            onClick={async () => {
                              if (confirm(t("reading.deleteConfirm", { title: book.title }))) {
                                closeEditor();
                                try { await deleteReadingBook(book.id); await refresh(); }
                                catch { setError("No se ha podido borrar el libro. Inténtalo de nuevo."); }
                              }
                            }}
                          >
                            {t("reading.delete")}
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

        {books.length > 0 && !visibleBooks.length ? <div className="reading-no-results"><h3>No hay libros con estos filtros.</h3><button className="btn btn-ghost" onClick={() => { setFilter("all"); setYear("all"); setCollectionQuery(""); }}>Ver toda la biblioteca ↗</button></div> : null}
        {!initialLoading && !books.length ? <div className="workbench-surface py-12 text-center text-sm text-base-content/60">{t("reading.noBooks")}</div> : null}
      </section>
    </main>
  );
}

import test from "node:test";
import assert from "node:assert/strict";
import { mapGoogleBooksPayload, mergeBookCandidates, searchBookCatalogs, type BookCandidate } from "./bookSearch";

test("mapGoogleBooksPayload normalizes Google metadata and secure cover URLs", () => {
  const [book] = mapGoogleBooksPayload({
    items: [{
      id: "google-id",
      volumeInfo: {
        title: "El nombre de la rosa",
        authors: ["Umberto Eco"],
        publishedDate: "1980-01-01",
        industryIdentifiers: [
          { type: "ISBN_10", identifier: "8426414370" },
          { type: "ISBN_13", identifier: "9788426414373" },
        ],
        imageLinks: { thumbnail: "http://books.google.com/cover.jpg" },
        categories: ["Fiction"],
      },
    }],
  });

  assert.deepEqual(book, {
    openLibraryKey: null,
    title: "El nombre de la rosa",
    authors: ["Umberto Eco"],
    coverUrl: "https://books.google.com/cover.jpg",
    firstPublishYear: 1980,
    isbn: "9788426414373",
    categories: ["Fiction"],
  });
});

test("mergeBookCandidates removes cross-catalog duplicates and fills missing metadata", () => {
  const openLibrary: BookCandidate = {
    openLibraryKey: "/works/OL8996439W",
    title: "El nombre de la rosa",
    authors: ["Umberto Eco"],
    coverUrl: null,
    firstPublishYear: 1980,
    isbn: "8426414370",
    categories: ["Novela histórica"],
  };
  const googleBooks: BookCandidate = {
    openLibraryKey: null,
    title: "EL NOMBRE DE LA ROSA",
    authors: ["Umberto Eco"],
    coverUrl: "https://books.google.com/cover.jpg",
    firstPublishYear: 1980,
    isbn: "9788426414373",
    categories: ["Fiction"],
  };

  assert.deepEqual(mergeBookCandidates([openLibrary, googleBooks]), [{
    ...openLibrary,
    coverUrl: "https://books.google.com/cover.jpg",
    categories: ["Novela histórica", "Fiction"],
  }]);
});

test("searchBookCatalogs combines Open Library and Google Books responses", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "openlibrary.org") {
      return new Response(JSON.stringify({ docs: [{
        key: "/works/open-library",
        title: "Libro de Open Library",
        author_name: ["Autora Uno"],
      }] }), { status: 200 });
    }
    if (url.hostname === "www.googleapis.com") {
      return new Response(JSON.stringify({ items: [{
        id: "google-books",
        volumeInfo: { title: "Libro de Google Books", authors: ["Autor Dos"] },
      }] }), { status: 200 });
    }
    return new Response(null, { status: 404 });
  };

  try {
    const results = await searchBookCatalogs("libros");
    assert.deepEqual(results.map((book) => book.title), ["Libro de Open Library", "Libro de Google Books"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

import { randomUUID } from "node:crypto";
import AdmZip from "adm-zip";
import * as cheerio from "cheerio";

export type PdfFigure = { id: string; alt: string; x: number; y: number; width: number; height: number };
export type ExtractedPdfPage = {
  page: number;
  html: string;
  continuesPrevious: boolean;
  joinPreviousWord: boolean;
  isToc: boolean;
  isBlank: boolean;
  figures: PdfFigure[];
};
export type PdfBookmark = { title: string; page: number; level: number };
export type PdfBookAsset = { fileName: string; data: Buffer; mediaType: string };
export type PdfBook = {
  title: string;
  author?: string;
  language?: string;
  pages: ExtractedPdfPage[];
  bookmarks: PdfBookmark[];
  pageLabels?: string[] | null;
  assets: PdfBookAsset[];
};

const ALLOWED_TAGS = new Set("p h1 h2 h3 h4 h5 h6 blockquote ul ol li table caption thead tbody tfoot tr th td pre code em strong b i u s sup sub br hr span a img figure figcaption aside section div dl dt dd".split(" "));
const DROP_TAGS = "script,style,iframe,object,embed,link,meta,base,form,input,button,svg";

export function escapePdfXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function normalizePdfText(value: string): string {
  const ligatures: Record<string, string> = { "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st" };
  return value.normalize("NFC").replace(/[ﬀﬁﬂﬃﬄﬅﬆ]/g, (c) => ligatures[c]!)
    .replace(/\u00ad/g, "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "");
}

export function pdfHtmlText(html: string): string {
  const $ = cheerio.load(html, {}, false);
  $("br").replaceWith(" ");
  $("p,li,h1,h2,h3,h4,h5,h6,td,th,blockquote,aside,figcaption").append(" ");
  return $.text().replace(/\s+/g, " ").trim();
}

function localId(page: number, id: string): string {
  if (/^(?:page-\d+|p\d+-[a-zA-Z0-9_-]+)$/.test(id)) return id;
  return `p${page}-${id.replace(/[^a-zA-Z0-9_-]/g, "-") || "anchor"}`;
}

/** Treat all model markup as untrusted; only package-owned images are allowed. */
export function sanitizePdfHtml(page: ExtractedPdfPage): string {
  const $ = cheerio.load(normalizePdfText(page.html), {}, false);
  $(DROP_TAGS).remove();
  $("*").toArray().reverse().forEach((element) => {
    if (!("tagName" in element)) return;
    if (!ALLOWED_TAGS.has(element.tagName)) $(element).replaceWith($(element).contents());
  });
  const ids = new Set<string>();
  $("*").each((_, element) => {
    if (!("tagName" in element)) return;
    const node = $(element);
    const attributes = { ...element.attribs };
    Object.keys(attributes).forEach((name) => node.removeAttr(name));
    if (attributes.id) {
      const id = attributes.id.startsWith(`p${page.page}-`) ? localId(page.page, attributes.id) : `p${page.page}-${attributes.id.replace(/[^a-zA-Z0-9_-]/g, "-") || "anchor"}`;
      if (!ids.has(id)) { node.attr("id", id); ids.add(id); }
    }
    if (element.tagName === "a" && attributes.href) {
      const href = attributes.href.trim();
      if (href.startsWith("#")) node.attr("href", `#${localId(page.page, href.slice(1))}`);
      else if (/^(https?:\/\/|mailto:)/i.test(href)) node.attr("href", href);
    }
    for (const name of ["colspan", "rowspan", "start", "value"]) {
      if (/^\d{1,4}$/.test(attributes[name] ?? "")) node.attr(name, attributes[name]!);
    }
    if (["doc-footnote", "doc-noteref"].includes(attributes.role)) {
      node.attr("epub:type", attributes.role === "doc-footnote" ? "footnote" : "noteref");
      node.attr("class", attributes.role === "doc-footnote" ? "footnote" : "noteref");
    }
    if (element.tagName === "img") {
      const figure = page.figures.find((item) => item.id === attributes["data-figure"]);
      if (!figure) { node.remove(); return; }
      node.attr("src", `../images/p${page.page}-${figure.id}.png`).attr("alt", figure.alt);
    }
  });
  // HTML entities are serialized as XML, including self-closing br/img elements.
  return $.xml();
}

type Heading = { title: string; page: number; level: number; id: string };
type NavigationItem = { title: string; level: number; href: string };

function titleKey(title: string): string {
  return normalizePdfText(title).toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function navigationList(items: NavigationItem[]): string {
  type Node = NavigationItem & { children: Node[] };
  const root: Node = { title: "", href: "", level: 0, children: [] };
  const stack = [root];
  for (const item of items) {
    while (stack.length > 1 && stack[stack.length - 1]!.level >= item.level) stack.pop();
    const node = { ...item, children: [] };
    stack[stack.length - 1]!.children.push(node);
    stack.push(node);
  }
  const render = (nodes: Node[]): string => `<ol>${nodes.map((node) => `<li><a href="${escapePdfXml(node.href)}">${escapePdfXml(node.title)}</a>${node.children.length ? render(node.children) : ""}</li>`).join("")}</ol>`;
  return render(root.children);
}

function htmlDocument(title: string, language: string, content: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapePdfXml(language)}" lang="${escapePdfXml(language)}"><head><title>${escapePdfXml(title)}</title><meta charset="utf-8"/><link rel="stylesheet" type="text/css" href="../book.css"/></head><body>${content}</body></html>`;
}

export function buildStructuredPdfEpub(book: PdfBook): Buffer {
  if (!book.pages.length) throw new Error("No hay páginas para generar el EPUB");
  const language = book.language || "und";
  const prepared = book.pages.map((page) => ({ page, $: cheerio.load(sanitizePdfHtml(page), { xml: true }, false) }));
  // A full-page cover already contains its lettering. Avoid printing the same title twice.
  const first = prepared[0]!;
  const coverFigure = first.page.page === 1 && first.page.figures.length === 1 &&
    first.page.figures[0]!.width * first.page.figures[0]!.height >= 0.95 &&
    pdfHtmlText(first.page.html).length < 400 ? first.page.figures[0] : undefined;
  const coverFile = coverFigure ? `p1-${coverFigure.id}.png` : undefined;
  if (coverFigure) first.$.root().html(`<section epub:type="cover"><figure><img src="../images/${coverFile}" alt="${escapePdfXml(pdfHtmlText(first.page.html) || coverFigure.alt)}"/></figure></section>`);
  const headings: Heading[] = [];
  for (const { page, $ } of prepared) {
    if (page.isToc) continue;
    $("h1,h2,h3,h4,h5,h6").each((index, element) => {
      let id = $(element).attr("id");
      if (!id) {
        id = `p${page.page}-heading-${index + 1}`;
        while ($(`[id='${id}']`).length) id += "-h";
        $(element).attr("id", id);
      }
      headings.push({ title: pdfHtmlText($.xml(element)), page: page.page, level: Number(element.tagName.slice(1)), id });
    });
  }

  const targets = book.bookmarks.length
    ? book.bookmarks.map((bookmark) => ({ ...bookmark, id: headings.find((heading) => heading.page === bookmark.page && titleKey(heading.title) === titleKey(bookmark.title))?.id || `page-${bookmark.page}` }))
    : headings;
  // Work on each TOC page in isolation, so a matching phrase in prose is untouched.
  for (const { page, $ } of prepared) {
    if (!page.isToc) continue;
    $("a,p,li,td,th").each((_, element) => {
      // Parent list entries may have nested lists: link their own title, retaining the children.
      if ($(element).children("a").length) return;
      const inline = $(element).contents().filter((_, child) => child.type === "text" ||
        ("tagName" in child && ["em", "strong", "b", "i", "span", "sup", "sub", "br", "code", "u", "s"].includes(child.tagName)));
      const raw = pdfHtmlText(inline.toArray().map((child) => $.xml(child)).join(""));
      const text = raw.replace(/(?:[.·…]{2,}\s*|\s+)(?:\d+|[ivxlcdm]+)\s*$/i, "").trim();
      const exactMatches = targets.filter((item) => titleKey(item.title) === titleKey(raw));
      const matches = exactMatches.length ? exactMatches : targets.filter((item) => titleKey(item.title) === titleKey(text));
      if (matches.length !== 1) return;
      if (element.tagName === "a") $(element).attr("href", `#${matches[0]!.id}`);
      else inline.wrapAll(`<a href="#${escapePdfXml(matches[0]!.id)}"/>`);
    });
  }

  // Join only explicitly identified continuations. Page anchors survive the move.
  for (let index = 0; index < prepared.length; index++) {
    const { page, $ } = prepared[index]!;
    const label = book.pageLabels?.[page.page - 1] || String(page.page);
    const anchor = `<span id="page-${page.page}" epub:type="pagebreak" title="${escapePdfXml(label)}"/>`;
    const previous = prepared[index - 1];
    const first = $.root().children().first();
    const last = previous?.$.root().children("p").last();
    const previousEndsInParagraph = previous?.$.root().children().last().is("p");
    if (page.continuesPrevious && !page.isToc && previous && previousEndsInParagraph && first.is("p") && last?.length) {
      let priorHtml = previous.$(last).html() ?? "";
      const continuation = first.html() ?? "";
      const oldId = first.attr("id");
      if (page.joinPreviousWord) priorHtml = priorHtml.replace(/-((?:<\/(?:em|strong|span|i|b)>)*\s*)$/, "$1");
      last.html(`${priorHtml}${anchor}${oldId ? `<span id="${escapePdfXml(oldId)}"/>` : ""}${page.joinPreviousWord ? "" : " "}${continuation}`);
      first.remove();
    } else {
      $.root().prepend(anchor);
    }
  }

  const minLevel = Math.min(...headings.map((heading) => heading.level), 6);
  const chapters: { id: string; title: string; html: string }[] = [];
  let current = { id: "chapter-1", title: book.title, html: "" };
  for (const { page, $ } of prepared) {
    const bookmark = book.bookmarks.find((item) => item.page === page.page && item.level === 1);
    const heading = headings.find((item) => item.page === page.page && item.level === minLevel);
    if ((bookmark || heading) && current.html && /<(?:p|h[1-6]|figure|table|ul|ol)\b/.test(current.html)) {
      chapters.push(current);
      current = { id: `chapter-${chapters.length + 1}`, title: bookmark?.title || heading!.title, html: "" };
    } else if (bookmark || heading) {
      current.title = bookmark?.title || heading!.title;
    }
    current.html += $.xml();
  }
  if (current.html) chapters.push(current);

  const idTargets = new Map<string, string>();
  const chapterTrees = chapters.map((chapter) => {
    const $ = cheerio.load(chapter.html, { xml: true }, false);
    $("[id]").each((_, element) => {
      const id = $(element).attr("id")!;
      if (idTargets.has(id)) throw new Error(`Ancla duplicada en el EPUB: ${id}`);
      idTargets.set(id, `sections/${chapter.id}.xhtml#${id}`);
    });
    return { chapter, $ };
  });
  const navigation: NavigationItem[] = targets.map((item) => ({ ...item, href: idTargets.get(item.id) || "" })).filter((item) => item.href);
  if (!navigation.length) navigation.push(...chapters.map((chapter) => ({ title: chapter.title, level: 1, href: `sections/${chapter.id}.xhtml` })));

  const assetNames = new Set(book.assets.map((asset) => asset.fileName));
  for (const { chapter, $ } of chapterTrees) {
    $("a[href^='#']").each((_, element) => {
      const destination = idTargets.get($(element).attr("href")!.slice(1));
      if (destination) $(element).attr("href", `../${destination}`);
      else $(element).removeAttr("href");
    });
    $("img").each((_, element) => {
      if (!assetNames.has($(element).attr("src")!.replace("../images/", ""))) throw new Error("Falta una ilustración del EPUB");
    });
    chapter.html = $.xml();
  }

  const zip = new AdmZip(undefined, { noSort: true });
  zip.addFile("mimetype", Buffer.from("application/epub+zip"));
  zip.getEntry("mimetype")!.header.method = 0;
  zip.addFile("META-INF/container.xml", Buffer.from(`<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`));
  zip.addFile("OEBPS/book.css", Buffer.from(`body { line-height: 1.5; } p { margin: 0 0 .5em; } h1,h2,h3,h4,h5,h6 { page-break-after: avoid; line-height: 1.2; } h1 { margin-top: 1.5em; } img { max-width: 100%; height: auto; } figure { margin: 1em 0; text-align: center; } figcaption,.footnote { font-size: .85em; } table { border-collapse: collapse; max-width: 100%; } th,td { border: 1px solid; padding: .3em; } pre { white-space: pre-wrap; } blockquote { margin: 1em; }`));
  const pageList = book.pages.map((page) => `<li><a href="${escapePdfXml(idTargets.get(`page-${page.page}`)!)}">${escapePdfXml(book.pageLabels?.[page.page - 1] || String(page.page))}</a></li>`).join("");
  zip.addFile("OEBPS/nav.xhtml", Buffer.from(htmlDocument("Índice", language, `<nav epub:type="toc" id="toc"><h1>Índice</h1>${navigationList(navigation)}</nav><nav epub:type="page-list" hidden="hidden"><h2>Páginas</h2><ol>${pageList}</ol></nav>`).replace('href="../book.css"', 'href="book.css"')));
  for (const chapter of chapters) zip.addFile(`OEBPS/sections/${chapter.id}.xhtml`, Buffer.from(htmlDocument(chapter.title, language, chapter.html)));
  for (const asset of book.assets) zip.addFile(`OEBPS/images/${asset.fileName}`, asset.data);
  zip.addFile("OEBPS/content.opf", Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">urn:uuid:${randomUUID()}</dc:identifier><dc:title>${escapePdfXml(book.title)}</dc:title><dc:language>${escapePdfXml(language)}</dc:language>${book.author ? `<dc:creator>${escapePdfXml(book.author)}</dc:creator>` : ""}<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="book.css" media-type="text/css"/>${chapters.map((chapter) => `<item id="${chapter.id}" href="sections/${chapter.id}.xhtml" media-type="application/xhtml+xml"/>`).join("")}${book.assets.map((asset, index) => `<item id="image-${index}" href="images/${escapePdfXml(asset.fileName)}" media-type="${escapePdfXml(asset.mediaType)}"${asset.fileName === coverFile ? ' properties="cover-image"' : ""}/>`).join("")}</manifest><spine>${chapters.map((chapter) => `<itemref idref="${chapter.id}"/>`).join("")}<itemref idref="nav" linear="no"/></spine></package>`));
  return zip.toBuffer();
}

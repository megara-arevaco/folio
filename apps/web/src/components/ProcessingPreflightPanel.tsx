import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchProcessingPreflight,
  previewEpubTranslation,
  previewPdfConversion,
  type EpubSamplePreview,
  type PdfSamplePreview,
  type ProcessingPreflight,
} from "../services/translation";

type Props = {
  file: File | null;
  kind: "epub-translation" | "pdf-conversion";
  onReadinessChange: (ready: boolean) => void;
  onPreviewingChange: (previewing: boolean) => void;
};

type PreviewState = { epub: EpubSamplePreview } | { pdf: PdfSamplePreview };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ProcessingPreflightPanel({ file, kind, onReadinessChange, onPreviewingChange }: Props) {
  const { t } = useTranslation();
  const [preflight, setPreflight] = useState<ProcessingPreflight | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const previewRequest = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void fetchProcessingPreflight().then((value) => {
      if (!cancelled) { setPreflight(value); setLoadError(null); }
    }).catch((error: unknown) => {
      if (!cancelled) setLoadError(error instanceof Error ? error.message : t("preflight.loadError"));
    });
    return () => { cancelled = true; };
  }, [t]);

  const isEpub = kind === "epub-translation";
  const configured = preflight !== null && (isEpub
    ? preflight.translation.mode === "mock" || preflight.translation.keyConfigured
    : preflight.pdf.provider === "local" || preflight.translation.keyConfigured);

  useEffect(() => { onReadinessChange(configured); }, [configured, onReadinessChange]);
  useEffect(() => {
    previewRequest.current += 1;
    setPreview(null);
    setPreviewError(null);
    setIsPreviewing(false);
    onPreviewingChange(false);
  }, [file, onPreviewingChange]);

  async function createPreview() {
    if (!file || isPreviewing) return;
    const requestId = ++previewRequest.current;
    setIsPreviewing(true);
    onPreviewingChange(true);
    setPreviewError(null);
    setPreview(null);
    try {
      const result = isEpub ? { epub: await previewEpubTranslation(file) } : { pdf: await previewPdfConversion(file) };
      if (requestId === previewRequest.current) setPreview(result);
    } catch (error) {
      if (requestId === previewRequest.current) setPreviewError(error instanceof Error ? error.message : t("preflight.previewError"));
    } finally {
      if (requestId === previewRequest.current) {
        setIsPreviewing(false);
        onPreviewingChange(false);
      }
    }
  }

  const provider = isEpub ? preflight?.translation.provider : preflight?.pdf.provider;
  const model = isEpub ? preflight?.translation.model : preflight?.pdf.model;
  const mode = isEpub ? preflight?.translation.mode : preflight?.pdf.mode;
  const formatCount = (value: number) => new Intl.NumberFormat().format(value);
  const budgetMeter = (used: { requests: number; inputTokenBound: number; outputTokens: number }, limit: { requests: number; inputTokenBound: number; outputTokens: number }) => t("preflight.budgetMeter", {
    usedRequests: formatCount(used.requests), maxRequests: formatCount(limit.requests),
    usedInput: formatCount(used.inputTokenBound), maxInput: formatCount(limit.inputTokenBound),
    usedOutput: formatCount(used.outputTokens), maxOutput: formatCount(limit.outputTokens),
  });

  return (
    <section className="preflight-panel" aria-labelledby="preflight-title">
      <div className="preflight-panel__heading">
        <h2 className="section-title" id="preflight-title">{t("preflight.title")}</h2>
        <p>{t("preflight.description")}</p>
      </div>
      {loadError ? <p className="preflight-message preflight-message--error" role="alert">{loadError}</p> : null}
      {preflight ? (
        <dl className="preflight-facts">
          <div><dt>{t("preflight.provider")}</dt><dd>{provider} · {mode === "mock" ? t("preflight.mock") : mode === "local" ? t("preflight.local") : t("preflight.live")}</dd></div>
          <div><dt>{t("preflight.model")}</dt><dd>{model ?? t("preflight.modelNotSet")}</dd></div>
          <div><dt>{t("preflight.file")}</dt><dd>{file ? `${file.name} · ${formatBytes(file.size)}` : t("preflight.selectFile")}</dd></div>
          {isEpub ? (
            <div><dt>{t("preflight.batchLimit")}</dt><dd>{t("preflight.batchLimitValue", { count: preflight.translation.batchTokenEstimate })}</dd></div>
          ) : (
            <div><dt>{t("preflight.limits")}</dt><dd>{t("preflight.pdfLimits", { pages: preflight.pdf.maxPages, tokens: preflight.pdf.maxOutputTokensPerRequest ?? t("preflight.notApplicable") })}</dd></div>
          )}
        </dl>
      ) : !loadError ? <p className="preflight-message">{t("preflight.loading")}</p> : null}
      {preflight ? <section className="preflight-budget" aria-labelledby="preflight-budget-title">
        <h3 id="preflight-budget-title">{t("preflight.budgetTitle")}</h3>
        <p>{t("preflight.budgetExplanation")}</p>
        <dl>
          <div><dt>{t("preflight.budgetDeployment", { used: formatCount(preflight.aiBudget.usage.deployment.requests), limit: formatCount(preflight.aiBudget.caps.deployment.requests) })}</dt><dd>{budgetMeter(preflight.aiBudget.usage.deployment, preflight.aiBudget.caps.deployment)}</dd></div>
          <div><dt>{t("preflight.budgetJob", { requests: formatCount(preflight.aiBudget.caps.job.requests), input: formatCount(preflight.aiBudget.caps.job.inputTokenBound), output: formatCount(preflight.aiBudget.caps.job.outputTokens) })}</dt><dd>{t("preflight.budgetUnitNote")}</dd></div>
          <div><dt>{t("preflight.budgetSamples", { used: formatCount(preflight.aiBudget.usage.samples.requests), limit: formatCount(preflight.aiBudget.caps.samples.requests) })}</dt><dd>{budgetMeter(preflight.aiBudget.usage.samples, preflight.aiBudget.caps.samples)}</dd></div>
          <div><dt>{t("preflight.budgetSampleCap", { requests: formatCount(preflight.aiBudget.caps.sample.requests), input: formatCount(preflight.aiBudget.caps.sample.inputTokenBound), output: formatCount(preflight.aiBudget.caps.sample.outputTokens) })}</dt><dd>{t("preflight.budgetUnitNote")}</dd></div>
        </dl>
      </section> : null}
      <p className="preflight-cost"><strong>{t("preflight.costUnknown")}</strong> {preflight?.costNote ?? t("preflight.costNote")}</p>
      {preflight && !configured ? <p className="preflight-message preflight-message--warning" role="status">
        {t("preflight.keyMissing")} <a href="/settings">{t("preflight.openSettings")}</a>
      </p> : null}
      <div className="preflight-actions">
        <button type="button" className="btn btn-outline btn-sm" disabled={!file || isPreviewing || !preflight} onClick={() => void createPreview()}>
          {isPreviewing ? t("preflight.previewing") : t("preflight.preview")}
        </button>
        {file && isEpub && preflight?.translation.mode === "mock" ? <span className="field-help">{t("preflight.mockDisclosure")}</span> : null}
        {file && !isEpub && preflight?.pdf.provider === "OpenRouter" ? <span className="field-help">{t("preflight.remotePreviewDisclosure")}</span> : null}
      </div>
      {previewError ? <p className="preflight-message preflight-message--error" role="alert">{previewError}</p> : null}
      {preview && "epub" in preview ? (
        <div className="sample-review" aria-live="polite">
          <div className="sample-review__heading">
            <h3>{t("preflight.sampleResult")}</h3>
            <p>{t("preflight.epubSampleInfo", { chapter: preview.epub.chapter, count: preview.epub.chapterCount, characters: preview.epub.sampleCharacters })}</p>
            <p>{preview.epub.mock ? t("preflight.mockResult") : t("preflight.previewNoReplace")}</p>
            {preview.epub.mock ? <p>{t("preflight.previewNoReplace")}</p> : null}
          </div>
          {preview.epub.sample.map((sample, index) => (
            <article className="sample-review__pair" key={`${preview.epub.chapter}-${index}`}>
              <p><strong>{t("preflight.sourceText")}</strong><span>{sample.source}</span></p>
              <p><strong>{t("preflight.resultText")}</strong><span>{sample.result}</span></p>
            </article>
          ))}
        </div>
      ) : null}
      {preview && "pdf" in preview ? (
        <div className="sample-review" aria-live="polite">
          <div className="sample-review__heading">
            <h3>{t("preflight.sampleResult")}</h3>
            <p>{preview.pdf.pageCount ? t("preflight.pdfSampleInfo", { count: preview.pdf.pages.length, total: preview.pdf.pageCount }) : t("preflight.pdfRemoteSampleInfo", { count: preview.pdf.pages.length })}</p>
            <p>{preview.pdf.provider === "local" ? t("preflight.localPdfNote") : t("preflight.previewNoReplace")}</p>
            {preview.pdf.provider === "local" ? <p>{t("preflight.previewNoReplace")}</p> : null}
            {preview.pdf.structure ? <div className="preflight-structure">
              <strong>{t("preflight.sampleStructure")}</strong>
              <p>{t("preflight.bookmarksDetected", { count: preview.pdf.structure.bookmarkCount })}</p>
              <p>{preview.pdf.structure.tocInSample ? t("preflight.indexDetected") : t("preflight.indexNotDetected")}</p>
              {preview.pdf.structure.warnings.includes("no-bookmarks") ? <p>{t("preflight.bookmarksMissing")}</p> : null}
              <p>{t("preflight.structureNotGuaranteed")}</p>
            </div> : null}
          </div>
          {preview.pdf.pages.map((page) => (
            <article className="sample-review__page" key={page.page}>
              <h4>{t("preflight.page", { page: page.page })}</h4>
              <p>{page.text || t("preflight.emptyPage")}</p>
              {page.needsOcr ? <p className="preflight-message preflight-message--warning">{t("preflight.ocrWarning")}</p> : null}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

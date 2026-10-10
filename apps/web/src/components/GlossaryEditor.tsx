import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchJobGlossary, updateJobGlossary, type GlossaryEntry } from "../services/translation";

type Props = { jobId: string; onClose: () => void };

export function GlossaryEditor({ jobId, onClose }: Props) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<GlossaryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchJobGlossary(jobId).then((loaded) => {
      if (!cancelled) setEntries(loaded);
    }).catch((loadError: unknown) => {
      if (!cancelled) setError(loadError instanceof Error ? loadError.message : t("queue.glossaryUnavailable"));
    }).finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [jobId, t]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      setEntries(await updateJobGlossary(jobId, entries));
      setNotice(t("queue.glossarySaved"));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("queue.glossaryUnavailable"));
    } finally { setIsSaving(false); }
  }

  return (
    <section className="glossary-editor" aria-labelledby={`glossary-title-${jobId}`}>
      <div className="workbench-toolbar">
        <div>
          <h3 className="section-title" id={`glossary-title-${jobId}`}>{t("queue.glossaryTitle")}</h3>
          <p className="section-copy">{t("queue.glossaryHelp")}</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>{t("common.close")}</button>
      </div>
      {isLoading ? <p className="preflight-message">{t("common.loading")}</p> : (
        <form onSubmit={(event) => void save(event)}>
          {entries.length === 0 ? <p className="section-copy">{t("queue.glossaryEmpty")}</p> : null}
          <div className="glossary-editor__entries">
            {entries.map((entry, index) => (
              <div className="glossary-editor__entry" key={`${entry.source}-${index}`}>
                <label className="field-label">
                  <span>{t("queue.glossarySource")}</span>
                  <input className="input input-bordered" maxLength={300} value={entry.source} onChange={(event) => setEntries((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, source: event.target.value } : item))} required />
                </label>
                <label className="field-label">
                  <span>{t("queue.glossaryTarget")}</span>
                  <input className="input input-bordered" maxLength={300} value={entry.target} onChange={(event) => setEntries((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, target: event.target.value } : item))} required />
                </label>
                <label className="field-label">
                  <span>{t("queue.glossaryType")}</span>
                  <select className="select select-bordered" value={entry.type ?? "term"} onChange={(event) => setEntries((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, type: event.target.value as GlossaryEntry["type"] } : item))}>
                    <option value="name">{t("queue.glossaryName")}</option>
                    <option value="place">{t("queue.glossaryPlace")}</option>
                    <option value="term">{t("queue.glossaryTerm")}</option>
                    <option value="title">{t("queue.glossaryTitleType")}</option>
                  </select>
                </label>
                <button type="button" className="btn btn-error btn-outline btn-sm" aria-label={t("queue.glossaryRemove", { term: entry.source || index + 1 })} onClick={() => setEntries((current) => current.filter((_, itemIndex) => itemIndex !== index))}>{t("common.delete")}</button>
              </div>
            ))}
          </div>
          <div className="glossary-editor__actions">
            <button type="button" className="btn btn-outline btn-sm" disabled={entries.length >= 100} onClick={() => setEntries((current) => [...current, { source: "", target: "", type: "term" }])}>{t("queue.glossaryAdd")}</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={isSaving || isLoading}>{isSaving ? t("settings.saving") : t("queue.glossarySave")}</button>
          </div>
          {notice ? <p className="preflight-message" role="status">{notice}</p> : null}
          {error ? <p className="preflight-message preflight-message--error" role="alert">{error}</p> : null}
        </form>
      )}
    </section>
  );
}

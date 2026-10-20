import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchProcessingPreflight, type ProcessingPreflight } from "../services/translation";

type Props = {
  kind: "epub-translation" | "pdf-conversion";
  onReadinessChange: (ready: boolean) => void;
};

export function ProcessingPreflightPanel({ kind, onReadinessChange }: Props) {
  const { t } = useTranslation();
  const [preflight, setPreflight] = useState<ProcessingPreflight | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchProcessingPreflight().then((value) => {
      if (!cancelled) { setPreflight(value); setLoadError(null); }
    }).catch((error: unknown) => {
      if (!cancelled) setLoadError(error instanceof Error ? error.message : t("preflight.loadError"));
    });
    return () => { cancelled = true; };
  }, [t]);

  const configured = preflight !== null && (kind === "epub-translation"
    ? preflight.translation.mode === "mock" || preflight.translation.keyConfigured
    : preflight.pdf.provider === "local" || preflight.translation.keyConfigured);
  useEffect(() => { onReadinessChange(configured); }, [configured, onReadinessChange]);

  if (loadError) return <p className="preflight-message preflight-message--error" role="alert">{loadError}</p>;
  if (preflight && !configured) return <p className="preflight-message preflight-message--warning" role="status">
    {t("preflight.keyMissing")} <a href="/settings">{t("preflight.openSettings")}</a>
  </p>;
  return null;
}

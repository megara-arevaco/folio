import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { DesktopCapabilities } from "../desktop";

export function DesktopSettingsPanel({ capabilities, onCapabilitiesChange }: {
  capabilities: DesktopCapabilities;
  onCapabilitiesChange(value: DesktopCapabilities): void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const bridge = window.folioDesktop;
  if (!bridge) return null;

  async function refresh() {
    if (!bridge || busy) return;
    setBusy(true);
    setNotice(null);
    try { onCapabilitiesChange(await bridge.refreshCapabilities()); }
    catch { setNotice({ error: true, text: t("desktop.detectionError") }); }
    finally { setBusy(false); }
  }

  async function maintain(command: "backup" | "verify" | "restore") {
    if (!bridge || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await bridge.maintenance(command);
      if (result.status === "error") setNotice({ error: true, text: result.message ?? t("desktop.operationError") });
      if (result.status === "busy") setNotice({ error: false, text: t("desktop.busy") });
      if (result.status === "success") setNotice({ error: false, text: t("desktop.verified") });
    } catch { setNotice({ error: true, text: t("desktop.operationError") }); }
    finally { setBusy(false); }
  }

  return <>
    <section className="settings-panel workbench-surface workbench-section" aria-labelledby="desktop-dependencies-title">
      <div>
        <h2 className="section-title" id="desktop-dependencies-title">{t("desktop.dependenciesTitle")}</h2>
        <p className="section-copy">{t("desktop.dependenciesDescription")}</p>
      </div>
      <dl className="settings-budget__facts">
        <div><dt>{t("desktop.pdfText")}</dt><dd>{t("desktop.included")}</dd></div>
        <div><dt>{t("desktop.ocr")}</dt><dd>{t(capabilities.poppler ? "desktop.detected" : "desktop.notDetected")}</dd></div>
        <div><dt>{t("desktop.kindle")}</dt><dd>{t(capabilities.calibre ? "desktop.detected" : "desktop.notDetected")}</dd></div>
        {capabilities.platform === "linux" ? <div><dt>{t("desktop.mtp")}</dt><dd>{t(capabilities.gio ? "desktop.detected" : "desktop.notDetected")}</dd></div> : null}
        <div><dt>{t("desktop.keyStorage")}</dt><dd>{t(capabilities.secureStorage ? "desktop.available" : "desktop.unavailable")}</dd></div>
      </dl>
      {!capabilities.poppler ? <p>{t("desktop.ocrHelp")}</p> : null}
      {!capabilities.calibre ? <p>{t("desktop.kindleHelp")}</p> : null}
      {capabilities.platform === "linux" && !capabilities.gio ? <p>{t("desktop.mtpHelp")}</p> : null}
      {!capabilities.secureStorage ? <p role="alert">{t("desktop.storageHelp")}</p> : null}
      <p className="field-help">{t("desktop.detectionLimit")}</p>
      <div className="settings-actions">
        <button type="button" className="btn btn-outline" disabled={busy} onClick={() => void refresh()}>{t(busy ? "common.loading" : "desktop.refresh")}</button>
      </div>
    </section>
    <section className="settings-panel settings-backup workbench-surface workbench-section" aria-labelledby="desktop-backup-title">
      <div>
        <h2 className="section-title" id="desktop-backup-title">{t("settings.backupTitle")}</h2>
        <p className="section-copy">{t("desktop.backupDescription")}</p>
      </div>
      <p>{t("settings.backupIncludes")}</p>
      <p>{t("desktop.backupExcludes")}</p>
      <p>{t("desktop.backupRestart")}</p>
      <p className="field-help">{t("settings.backupRestore")}</p>
      <div className="settings-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void maintain("backup")}>{t("desktop.backup")}</button>
        <button type="button" className="btn btn-outline" disabled={busy} onClick={() => void maintain("verify")}>{t("desktop.verify")}</button>
        <button type="button" className="btn btn-outline" disabled={busy} onClick={() => void maintain("restore")}>{t("desktop.restore")}</button>
      </div>
    </section>
    {notice ? <p role={notice.error ? "alert" : "status"}>{notice.text}</p> : null}
  </>;
}

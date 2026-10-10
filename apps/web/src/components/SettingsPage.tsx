import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchOpenRouterSettings,
  removeSavedOpenRouterApiKey,
  saveOpenRouterApiKey,
  type OpenRouterSettings,
} from "../services/settings";
import { fetchProcessingPreflight, type ProcessingPreflight } from "../services/translation";

type Notice = { kind: "success" | "error"; text: string };

export function SettingsPage() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<OpenRouterSettings | null>(null);
  const [preflight, setPreflight] = useState<ProcessingPreflight | null>(null);
  const [budgetFailed, setBudgetFailed] = useState(false);
  const [commandCopied, setCommandCopied] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    setLoadFailed(false);
    try {
      setSettings(await fetchOpenRouterSettings());
    } catch {
      setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
    let cancelled = false;
    void fetchProcessingPreflight().then((value) => {
      if (!cancelled) { setPreflight(value); setBudgetFailed(false); }
    }).catch(() => { if (!cancelled) setBudgetFailed(true); });
    return () => { cancelled = true; };
  }, [loadSettings]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = apiKey.trim();
    if (!value || value.length > 512 || isBusy) return;

    setIsBusy(true);
    setNotice(null);
    try {
      setSettings(await saveOpenRouterApiKey(value));
      setApiKey("");
      setNotice({ kind: "success", text: t("settings.saved") });
    } catch {
      setNotice({ kind: "error", text: t("settings.saveError") });
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRemove() {
    if (isBusy) return;

    setIsBusy(true);
    setNotice(null);
    try {
      setSettings(await removeSavedOpenRouterApiKey());
      setNotice({ kind: "success", text: t("settings.removed") });
    } catch {
      setNotice({ kind: "error", text: t("settings.removeError") });
    } finally {
      setIsBusy(false);
    }
  }

  async function copyBackupCommand() {
    try {
      await navigator.clipboard.writeText(t("settings.backupCreateCommand"));
      setCommandCopied(true);
    } catch {
      setCommandCopied(false);
    }
  }

  const formatCount = (value: number) => new Intl.NumberFormat().format(value);
  const budgetMeter = (used: { requests: number; inputTokenBound: number; outputTokens: number }, limit: { requests: number; inputTokenBound: number; outputTokens: number }) => t("preflight.budgetMeter", {
    usedRequests: formatCount(used.requests), maxRequests: formatCount(limit.requests),
    usedInput: formatCount(used.inputTokenBound), maxInput: formatCount(limit.inputTokenBound),
    usedOutput: formatCount(used.outputTokens), maxOutput: formatCount(limit.outputTokens),
  });

  const sourceMessage = settings?.source === "settings"
    ? t("settings.sourceSaved")
    : settings?.source === "environment"
      ? t("settings.sourceEnvironment")
      : t("settings.sourceMissing");

  return (
    <main className="workspace-page">
      <header className="workspace-intro">
        <div>
          <h1 className="workspace-title">{t("settings.title")}</h1>
        </div>
      </header>

      <div className="settings-layout">
        <section className="settings-panel workbench-surface workbench-section" aria-labelledby="settings-openrouter-title">
          <div>
            <h2 className="section-title" id="settings-openrouter-title">{t("settings.openRouter")}</h2>
            <p className="section-copy">{t("settings.description")}</p>
          </div>

          {isLoading ? <p className="settings-loading" role="status">{t("common.loading")}</p> : null}
          {loadFailed ? (
            <div className="settings-load-error">
              <p role="alert">{t("settings.loadError")}</p>
              <button type="button" className="btn btn-outline" onClick={() => void loadSettings()}>
                {t("common.retry")}
              </button>
            </div>
          ) : null}

          {settings ? (
            <div className="settings-state" data-source={settings.source} role="status">
              {sourceMessage}
            </div>
          ) : null}

          <form className="settings-form" onSubmit={(event) => void handleSave(event)}>
            <label className="field-label" htmlFor="openrouter-api-key">
              <span>{t("settings.apiKey")}</span>
              <input
                id="openrouter-api-key"
                className="input input-bordered w-full"
                type="password"
                required
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value);
                  setNotice(null);
                }}
                placeholder={t("settings.keyPlaceholder")}
                autoComplete="new-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                maxLength={512}
                disabled={isLoading || loadFailed || isBusy}
                aria-describedby="openrouter-api-key-help"
              />
            </label>
            <p className="field-help" id="openrouter-api-key-help">{t("settings.help")}</p>

            <div className="settings-actions">
              <button type="submit" className="btn btn-primary" disabled={isLoading || loadFailed || isBusy || !apiKey.trim()}>
                {isBusy ? t("settings.saving") : t("settings.saveKey")}
              </button>
              {settings?.source === "settings" ? (
                <button type="button" className="btn btn-error btn-outline" onClick={() => void handleRemove()} disabled={isBusy}>
                  {isBusy ? t("settings.saving") : t("settings.removeKey")}
                </button>
              ) : null}
            </div>
          </form>

          {notice ? (
            <p className={`settings-notice settings-notice--${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
              {notice.text}
            </p>
          ) : null}
        </section>
        <section className="settings-panel settings-budget workbench-surface workbench-section" aria-labelledby="settings-budget-title">
          <div>
            <h2 className="section-title" id="settings-budget-title">{t("settings.budgetTitle")}</h2>
            <p className="section-copy">{t("settings.budgetDescription")}</p>
          </div>
          {budgetFailed ? <p className="settings-message settings-message--error" role="alert">{t("preflight.loadError")}</p> : null}
          {preflight ? <dl className="settings-budget__facts">
            <div><dt>{t("settings.budgetDeployment")}</dt><dd>{budgetMeter(preflight.aiBudget.usage.deployment, preflight.aiBudget.caps.deployment)}</dd></div>
            <div><dt>{t("settings.budgetJob")}</dt><dd>{t("preflight.budgetJob", {
              requests: formatCount(preflight.aiBudget.caps.job.requests),
              input: formatCount(preflight.aiBudget.caps.job.inputTokenBound),
              output: formatCount(preflight.aiBudget.caps.job.outputTokens),
            })}</dd></div>
            <div><dt>{t("settings.budgetSamples")}</dt><dd>{budgetMeter(preflight.aiBudget.usage.samples, preflight.aiBudget.caps.samples)}</dd></div>
            <div><dt>{t("preflight.budgetSampleCap")}</dt><dd>{t("preflight.budgetJob", {
              requests: formatCount(preflight.aiBudget.caps.sample.requests),
              input: formatCount(preflight.aiBudget.caps.sample.inputTokenBound),
              output: formatCount(preflight.aiBudget.caps.sample.outputTokens),
            })}</dd></div>
          </dl> : !budgetFailed ? <p className="settings-loading" role="status">{t("common.loading")}</p> : null}
          <p className="field-help">{t("settings.budgetUnitNote")}</p>
        </section>

        <section className="settings-panel settings-backup workbench-surface workbench-section" aria-labelledby="settings-backup-title">
          <div>
            <h2 className="section-title" id="settings-backup-title">{t("settings.backupTitle")}</h2>
            <p className="section-copy">{t("settings.backupDescription")}</p>
          </div>
          <p>{t("settings.backupIncludes")}</p>
          <p>{t("settings.backupExcludes")}</p>
          <p>{t("settings.backupCreate")}</p>
          <p>{t("settings.backupRestore")}</p>
          <p className="field-help">{t("settings.backupCommandHelp")}</p>
          <div className="backup-commands">
            <pre><code>{t("settings.backupCreateCommand")}</code></pre>
            <pre><code>{t("settings.backupVerifyCommand")}</code></pre>
            <pre><code>{t("settings.backupRestoreCommand")}</code></pre>
          </div>
          <div className="settings-actions">
            <button type="button" className="btn btn-outline btn-sm" onClick={() => void copyBackupCommand()}>{t("settings.backupCopyCommand")}</button>
            {commandCopied ? <span role="status">{t("settings.backupCopied")}</span> : null}
          </div>
        </section>
      </div>
    </main>
  );
}

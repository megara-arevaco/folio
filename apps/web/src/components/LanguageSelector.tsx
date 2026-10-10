import { useTranslation } from "react-i18next";
import i18n from "../i18n";

export function LanguageSelector() {
  const { t } = useTranslation();
  return (
    <label className="folio-language">
      <span className="sr-only">{t("common.language")}</span>
      <select
        value={i18n.resolvedLanguage?.startsWith("en") ? "en" : "es"}
        onChange={(event) => void i18n.changeLanguage(event.target.value)}
        aria-label={t("common.language")}
      >
        <option value="es">Español</option>
        <option value="en">English</option>
      </select>
    </label>
  );
}

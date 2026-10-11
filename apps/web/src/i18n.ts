import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { resources } from "./locales/resources";

const storageKey = "folio.language";
const savedLanguage = typeof localStorage === "undefined" ? null : localStorage.getItem(storageKey);
const desktopLanguage = typeof window === "undefined" ? undefined : window.folioDesktop?.language;
const initialLanguage = desktopLanguage ?? (savedLanguage === "en" ? "en" : "es");

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage,
  fallbackLng: "es",
  defaultNS: "translation",
  interpolation: { escapeValue: false },
});

i18n.on("languageChanged", (language) => {
  const locale = language.startsWith("en") ? "en" : "es";
  if (typeof localStorage !== "undefined") localStorage.setItem(storageKey, locale);
  if (typeof window !== "undefined" && window.folioDesktop) {
    void window.folioDesktop.setLanguage(locale).catch(error => {
      // The main process also displays a native error; never claim a failed write was saved.
      console.error("No se ha podido guardar el idioma de Folio", error);
    });
  }
  if (typeof document !== "undefined") document.documentElement.lang = locale;
});

if (typeof document !== "undefined") document.documentElement.lang = initialLanguage;

export default i18n;

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/locales/en.json";
import de from "@/locales/de.json";

const LANG_KEY = "snapsnag_lang";

function detectLanguage(): string {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (stored === "en" || stored === "de") return stored;
  } catch {}
  const browser = navigator.language || "";
  return browser.startsWith("de") ? "de" : "en";
}

const detectedLang = detectLanguage();

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    de: { translation: de },
  },
  lng: detectedLang,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export function setLanguage(lang: "en" | "de") {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {}
  i18n.changeLanguage(lang);
}

export default i18n;

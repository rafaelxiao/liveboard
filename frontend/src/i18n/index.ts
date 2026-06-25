import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

// English locale files
import enCommon from "./locales/en/common.json";
import enAuth from "./locales/en/auth.json";
import enDashboard from "./locales/en/dashboard.json";
import enCompare from "./locales/en/compare.json";
import enSettings from "./locales/en/settings.json";
import enDocs from "./locales/en/docs.json";
import enShare from "./locales/en/share.json";
import enTradeCompare from "./locales/en/tradeCompare.json";

// Chinese locale files
import zhCommon from "./locales/zh/common.json";
import zhAuth from "./locales/zh/auth.json";
import zhDashboard from "./locales/zh/dashboard.json";
import zhCompare from "./locales/zh/compare.json";
import zhSettings from "./locales/zh/settings.json";
import zhDocs from "./locales/zh/docs.json";
import zhShare from "./locales/zh/share.json";
import zhTradeCompare from "./locales/zh/tradeCompare.json";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        common: enCommon,
        auth: enAuth,
        dashboard: enDashboard,
        compare: enCompare,
        settings: enSettings,
        docs: enDocs,
        share: enShare,
        tradeCompare: enTradeCompare,
      },
      zh: {
        common: zhCommon,
        auth: zhAuth,
        dashboard: zhDashboard,
        compare: zhCompare,
        settings: zhSettings,
        docs: zhDocs,
        share: zhShare,
        tradeCompare: zhTradeCompare,
      },
    },
    fallbackLng: "en",
    defaultNS: "common",
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "i18nextLng",
    },
  });

export default i18n;

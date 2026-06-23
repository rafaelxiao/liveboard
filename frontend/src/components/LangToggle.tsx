import { useTranslation } from "react-i18next";

export default function LangToggle() {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language === "en" || i18n.language?.startsWith("en");
  return (
    <div className="flex rounded-md border border-border-default overflow-hidden h-7">
      <button
        type="button"
        onClick={() => i18n.changeLanguage("en")}
        className={`w-9 px-1.5 text-[11px] font-medium transition-colors duration-150 ${
          isEn
            ? "border-accent bg-accent text-white"
            : "border-transparent bg-surface text-secondary hover:bg-surface-2"
        }`}
      >
        {t("English")}
      </button>
      <button
        type="button"
        onClick={() => i18n.changeLanguage("zh")}
        className={`w-9 px-1.5 text-[11px] font-medium transition-colors duration-150 ${
          !isEn
            ? "border-accent bg-accent text-white"
            : "border-transparent bg-surface text-secondary hover:bg-surface-2"
        }`}
      >
        {t("Chinese")}
      </button>
    </div>
  );
}

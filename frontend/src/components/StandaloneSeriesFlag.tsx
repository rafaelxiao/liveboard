import { useTranslation } from "react-i18next";

export default function StandaloneSeriesFlag({
  kind,
  name,
}: {
  kind: "no-counterpart" | "currency-mismatch";
  name: string;
}) {
  const { t } = useTranslation("dashboard");
  return (
    <span className="rounded bg-warning/20 px-2 py-1 text-xs text-warning">
      {name}: {kind === "no-counterpart" ? t("no counterpart") : t("currency mismatch")}
    </span>
  );
}

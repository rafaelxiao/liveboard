import { useTranslation } from "react-i18next";
import Select from "../../components/Select";
import type { Balances } from "./useStaging";

function fmtAbs(v: string): string {
  const n = parseFloat(v);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface Props {
  formType: string;
  setFormType: (v: string) => void;
  formAmount: string;
  setFormAmount: (v: string) => void;
  formFrom: string;
  setFormFrom: (v: string) => void;
  formTo: string;
  setFormTo: (v: string) => void;
  formError: string;
  setFormError: (v: string) => void;
  validateAdd: () => string | null;
  onAdd: () => void;
  balances: Balances;
  stratNames: string[];
}

export default function AddMovementForm({
  formType, setFormType, formAmount, setFormAmount,
  formFrom, setFormFrom, formTo, setFormTo,
  formError, setFormError, validateAdd, onAdd, balances, stratNames,
}: Props) {
  const { t } = useTranslation("capital");
  return (
    <div className="rounded-lg border border-border-default bg-surface p-5">
      <h3 className="text-sm font-medium text-primary mb-3">{t("newMovement")}</h3>
      <div className="flex flex-wrap items-end gap-3">
        <Select
          label={t("type")}
          value={formType}
          onChange={(e) => { setFormType(e.target.value); setFormFrom(""); setFormTo(""); setFormError(""); }}
          className="w-32"
        >
          <option value="deposit">{t("deposit")}</option>
          <option value="withdraw">{t("withdraw")}</option>
          <option value="allocate">{t("allocate")}</option>
          <option value="free">{t("free")}</option>
          <option value="transfer">{t("transfer")}</option>
          <option value="create_strategy">{t("createStrategy")}</option>
        </Select>

        {(formType === "free" || formType === "transfer") && (
          <Select
            label={t("from")}
            value={formFrom}
            onChange={(e) => { setFormFrom(e.target.value); setFormError(""); }}
            className="w-36"
          >
            <option value="">—</option>
            {stratNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        )}

        {(formType === "allocate" || formType === "transfer" || formType === "create_strategy") && (
          <label className="text-xs text-secondary">
            {t("to")}
            <input
              list="strategy-list"
              value={formTo}
              onChange={(e) => { setFormTo(e.target.value); setFormError(""); }}
              placeholder="type or select"
              className="mt-1 block h-8 rounded border border-border-default bg-surface px-2 text-xs text-primary w-36"
            />
            <datalist id="strategy-list">
              {stratNames.map((n) => <option key={n} value={n} />)}
            </datalist>
          </label>
        )}

        <label className="text-xs text-secondary">
          {t("amount")}
          <input
            type="number" value={formAmount} onChange={(e) => { setFormAmount(e.target.value); setFormError(""); }}
            placeholder="0.00"
            className="mt-1 block h-8 rounded border border-border-default bg-surface px-2 text-xs text-primary w-32 font-mono"
          />
        </label>

        <button
          onClick={onAdd}
          disabled={!!validateAdd()}
          className="h-8 rounded-md bg-accent text-white px-4 text-xs font-medium hover:opacity-90 disabled:opacity-50"
        >
          {t("stage")}
        </button>
      </div>
      {formType !== "deposit" && (
        <div className="mt-2 text-[10px] text-muted">
          {formType === "withdraw" && `${t("available")}: ${fmtAbs(String(balances.projFree ?? 0))}`}
          {formType === "allocate" && `${t("available")}: ${fmtAbs(String(balances.projFree ?? 0))}`}
          {formType === "free" && formFrom && `${t("available")}: ${fmtAbs(String(balances.projStrats?.[formFrom] || 0))}`}
          {formType === "transfer" && formFrom && `${t("available")}: ${fmtAbs(String(balances.projStrats?.[formFrom] || 0))}`}
        </div>
      )}
      {formError && <p className="mt-2 text-xs text-pnl-loss">{formError}</p>}
    </div>
  );
}

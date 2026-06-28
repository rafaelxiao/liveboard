import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../api/client";
import { useSeriesList } from "../state/useSeries";
import { useAccountData } from "./account/useAccountData";
import { useStaging } from "./account/useStaging";
import BalanceCards from "./account/BalanceCards";
import StrategyTable from "./account/StrategyTable";
import AddMovementForm from "./account/AddMovementForm";
import StagedChangesPanel from "./account/StagedChangesPanel";
import MovementHistory from "./account/MovementHistory";
import CloseAccountSection from "./account/CloseAccountSection";

export default function AccountPage() {
  const { t } = useTranslation("capital");
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const seriesId = Number(id);
  const { data: seriesList } = useSeriesList();
  const seriesName = (seriesList as { id: number; name: string }[] | undefined)?.find((s) => s.id === seriesId)?.name || `Series ${seriesId}`;

  const { capital, committed, stratCreationTimes, loading, refresh } = useAccountData(seriesId);
  const staging = useStaging(seriesId, capital, refresh);

  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState("");

  // Include both committed and staged strategy names in dropdowns
  const stratNames = useMemo(() => {
    const names = new Set((capital?.strategies || []).map((s) => s.name_key));
    if (staging.balanced) {
      for (const k of Object.keys(staging.balanced.projStrats)) {
        names.add(k);
      }
    }
    return Array.from(names).sort();
  }, [capital, staging.balanced]);

  const handleClose = async () => {
    if (!confirm(t("confirmClose"))) return;
    setClosing(true);
    setCloseError("");
    try {
      await apiFetch(`/series/${seriesId}`, { method: "DELETE" });
      navigate(`${import.meta.env.BASE_URL}dashboard`);
    } catch (e: unknown) {
      setCloseError(e instanceof Error ? e.message : "Failed to close");
      setClosing(false);
    }
  };

  const totalNet = capital
    ? String(parseFloat(capital.free_cash) + capital.strategies.reduce((s, st) => s + parseFloat(st.net_value), 0))
    : "0";

  if (loading) return <div className="p-8 text-secondary">Loading...</div>;
  if (!capital) return <div className="p-8 text-secondary">No data</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <h2 className="text-lg font-semibold text-primary">{seriesName} · {t("title")}</h2>

      <BalanceCards
        accountTotal={capital.account_total}
        strategiesCount={capital.strategies.length}
        totalNet={totalNet}
        balances={staging.balanced}
        staged={staging.staged}
      />

      <StrategyTable
        strategies={capital.strategies}
        balances={staging.balanced}
        onDelete={staging.addDeleteStrategy}
      />

      <AddMovementForm
        formType={staging.formType}
        setFormType={staging.setFormType}
        formAmount={staging.formAmount}
        setFormAmount={staging.setFormAmount}
        formFrom={staging.formFrom}
        setFormFrom={staging.setFormFrom}
        formTo={staging.formTo}
        setFormTo={staging.setFormTo}
        formError={staging.formError}
        setFormError={staging.setFormError}
        validateAdd={staging.validateAdd}
        onAdd={staging.addStaged}
        balances={staging.balanced}
        stratNames={stratNames}
      />

      <StagedChangesPanel
        staged={staging.staged}
        committing={staging.committing}
        commitOk={staging.commitOk}
        onRemove={staging.removeStaged}
        onCommit={staging.commit}
      />

      <MovementHistory committed={committed} stratCreationTimes={stratCreationTimes} />

      <CloseAccountSection closing={closing} closeError={closeError} onClose={handleClose} />
    </div>
  );
}

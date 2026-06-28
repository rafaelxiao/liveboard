import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../../api/client";
import type { SeriesCapital } from "../../lib/types";

export interface StagedMove {
  id: number;
  type: "move" | "delete_strategy";
  fromBucket: string;
  toBucket: string;
  fromStrat: string | null;
  toStrat: string | null;
  amount: number;
  label: string;
}

export interface Balances {
  curFree: number;
  curStrats: Record<string, number>;
  projFree: number;
  projStrats: Record<string, number>;
}

function fmtAbs(v: string): string {
  const n = parseFloat(v);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function applyMove(
  free: number, strats: Record<string, number>,
  fromB: string, toB: string, amt: number,
  fromS: string | null, toS: string | null,
): { free: number; strats: Record<string, number> } {
  const ns = { ...strats };
  let f = free;
  if (fromB === "FREE_CASH") f -= amt;
  if (toB === "FREE_CASH") f += amt;
  if (fromB === "STRATEGY" && fromS) ns[fromS] = (ns[fromS] || 0) - amt;
  if (toB === "STRATEGY" && toS) ns[toS] = (ns[toS] || 0) + amt;
  return { free: f, strats: ns };
}

export function computeBalances(capital: SeriesCapital | null, staged: StagedMove[]): Balances {
  if (!capital) return { curFree: 0, curStrats: {}, projFree: 0, projStrats: {} };
  let free = parseFloat(capital.free_cash);
  const strats: Record<string, number> = {};
  for (const s of capital.strategies) {
    strats[s.name_key] = parseFloat(s.net_value);
  }
  const curFree = free;
  const curStrats = { ...strats } as Record<string, number>;
  let pFree = free;
  let pStrats = { ...strats };
  for (const s of staged) {
    if (s.type === "delete_strategy" && s.fromStrat) {
      delete pStrats[s.fromStrat];
    } else if (s.type === "move") {
      const r = applyMove(pFree, pStrats, s.fromBucket, s.toBucket, s.amount, s.fromStrat, s.toStrat);
      pFree = r.free;
      pStrats = r.strats;
    }
  }
  return {
    curFree: Math.round(curFree * 100) / 100,
    curStrats,
    projFree: Math.round(pFree * 100) / 100,
    projStrats: pStrats as Record<string, number>,
  };
}

export function useStaging(seriesId: number, capital: SeriesCapital | null, onRefresh: () => Promise<void>) {
  const { t } = useTranslation("capital");
  const [staged, setStaged] = useState<StagedMove[]>([]);
  const [nextId, setNextId] = useState(1);

  // Form
  const [formType, setFormType] = useState("deposit");
  const [formAmount, setFormAmount] = useState("");
  const [formFrom, setFormFrom] = useState("");
  const [formTo, setFormTo] = useState("");
  const [formError, setFormError] = useState("");
  const [committing, setCommitting] = useState(false);
  const [commitOk, setCommitOk] = useState("");

  const balances = useMemo(() => computeBalances(capital, staged), [capital, staged]);

  const canWithdraw = (balances.projFree ?? 0) >= parseFloat(formAmount || "0");
  const canAllocate = (balances.projFree ?? 0) >= parseFloat(formAmount || "0");
  const canFree = formFrom ? (balances.projStrats?.[formFrom] || 0) >= parseFloat(formAmount || "0") : false;
  const canTransfer = formFrom && formTo ? (balances.projStrats?.[formFrom] || 0) >= parseFloat(formAmount || "0") : false;

  const validateAdd = (): string | null => {
    const amt = parseFloat(formAmount);
    const needsAmount = ["deposit", "withdraw", "free", "transfer"].includes(formType);
    if (needsAmount && (isNaN(amt) || amt <= 0)) return "Amount must be > 0";
    if (isNaN(amt)) return "Invalid amount";
    switch (formType) {
      case "withdraw": if (!canWithdraw) return "Insufficient free cash"; break;
      case "allocate": if (!canAllocate) return "Insufficient free cash"; break;
      case "free": if (!formFrom) return "Select source strategy"; if (!canFree) return "Insufficient strategy capital"; break;
      case "transfer": if (!formFrom || !formTo) return "Select both strategies"; if (formFrom === formTo) return "Same strategy"; if (!canTransfer) return "Insufficient source capital"; break;
      case "create_strategy": if (!formTo) return "Enter strategy name"; if (isNaN(amt)) return "Invalid amount"; break;
    }
    return null;
  };

  const addStaged = () => {
    const err = validateAdd();
    if (err) { setFormError(err); return; }
    setFormError("");
    const amt = parseFloat(formAmount);
    let fromB = "", toB = "", fromS: string | null = null, toS: string | null = null;
    let label = "";
    switch (formType) {
      case "deposit": fromB = "EXTERNAL"; toB = "FREE_CASH"; label = `${t("deposit")} ${fmtAbs(formAmount)}`; break;
      case "withdraw": fromB = "FREE_CASH"; toB = "EXTERNAL"; label = `${t("withdraw")} ${fmtAbs(formAmount)}`; break;
      case "allocate": fromB = "FREE_CASH"; toB = "STRATEGY"; toS = formTo; label = `${t("allocate")} ${fmtAbs(formAmount)} → ${formTo}`; break;
      case "free": fromB = "STRATEGY"; toB = "FREE_CASH"; fromS = formFrom; label = `${t("free")} ${fmtAbs(formAmount)} ← ${formFrom}`; break;
      case "transfer": fromB = "STRATEGY"; toB = "STRATEGY"; fromS = formFrom; toS = formTo; label = `${t("transfer")} ${fmtAbs(formAmount)} ${formFrom} → ${formTo}`; break;
      case "create_strategy": fromB = "FREE_CASH"; toB = "STRATEGY"; toS = formTo; label = `${t("createStrategy")}: ${formTo}`; break;
    }
    setStaged((prev) => [...prev, { id: nextId, type: "move", fromBucket: fromB, toBucket: toB, fromStrat: fromS, toStrat: toS, amount: amt, label }]);
    setNextId((n) => n + 1);
    setFormAmount("");
  };

  const addDeleteStrategy = (nameKey: string) => {
    const projCap = balances.projStrats?.[nameKey] || 0;
    if (projCap > 0) {
      alert(`${t("cantDeleteHasCapital")}: ${projCap.toFixed(2)}. ${t("freeFirst")}`);
      return;
    }
    setStaged((prev) => [...prev, { id: nextId, type: "delete_strategy", fromBucket: "", toBucket: "", fromStrat: nameKey, toStrat: null, amount: 0, label: `${t("deletedStrategy")}: ${nameKey}` }]);
    setNextId((n) => n + 1);
  };

  const removeStaged = (idx: number) => {
    setStaged((prev) => prev.slice(0, idx));
  };

  const commit = async () => {
    if (staged.length === 0) return;
    setCommitting(true);
    setCommitOk("");
    try {
      const moves = staged.filter((s) => s.type === "move" && s.amount > 0);
      if (moves.length > 0) {
        const baseTs = new Date();
        await apiFetch(`/series/${seriesId}/fund-movements`, {
          method: "POST",
          body: moves.map((s, i) => ({
            client_movement_id: `ui-${Date.now()}-${i}`,
            ts: new Date(baseTs.getTime() + i * 1000).toISOString(),
            currency: "CNY",
            amount: s.amount.toFixed(2),
            from_bucket: s.fromBucket,
            to_bucket: s.toBucket,
            from_strategy: s.fromStrat,
            to_strategy: s.toStrat,
          })),
        });
      }
      const dels = staged.filter((s) => s.type === "delete_strategy");
      for (const d of dels) {
        try {
          if (d.fromStrat) {
            await apiFetch(`/series/${seriesId}/strategies/${d.fromStrat}`, { method: "DELETE" });
          }
        } catch (e: unknown) {
          setFormError(`${t("deleteFailed")}: ${d.fromStrat} — ${e instanceof Error ? e.message : "unknown"}`);
        }
      }
      setCommitOk(t("committed"));
      setStaged([]);
      setTimeout(() => setCommitOk(""), 3000);
      await onRefresh();
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : "Commit failed");
    } finally {
      setCommitting(false);
    }
  };

  return {
    staged,
    formType, setFormType, formAmount, setFormAmount,
    formFrom, setFormFrom, formTo, setFormTo,
    formError, setFormError,
    committing, commitOk,
    validateAdd,
    balanced: balances,
    addStaged, addDeleteStrategy, removeStaged, commit,
  };
}

import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Select from "../components/Select";
import { apiFetch } from "../api/client";
import type { SeriesCapital, FundMovement } from "../lib/types";
import { useSeriesList } from "../state/useSeries";

function fmt(v: string): string {
  const n = parseFloat(v);
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtAbs(v: string): string {
  const n = parseFloat(v);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface StagedMove {
  id: number;
  fromBucket: string;
  toBucket: string;
  fromStrat: string | null;
  toStrat: string | null;
  amount: number;
  label: string;
}

export default function AccountPage() {
  const { t } = useTranslation("capital");
  const { id } = useParams<{ id: string }>();
  const seriesId = Number(id);
  const { data: seriesList } = useSeriesList();
  const seriesName = (seriesList as { id: number; name: string }[] | undefined)?.find((s) => s.id === seriesId)?.name || `Series ${seriesId}`;

  const [capital, setCapital] = useState<SeriesCapital | null>(null);
  const [committed, setCommitted] = useState<FundMovement[]>([]);
  const [lifecycleEvents, setLifecycleEvents] = useState<{ ts: string; label: string; type: "created" | "deleted" }[]>([]);
  const [staged, setStaged] = useState<StagedMove[]>([]);
  const [loading, setLoading] = useState(true);
  const [nextId, setNextId] = useState(1);

  // Form
  const [formType, setFormType] = useState("deposit");
  const [formAmount, setFormAmount] = useState("");
  const [formFrom, setFormFrom] = useState("");
  const [formTo, setFormTo] = useState("");
  const [formError, setFormError] = useState("");
  const [committing, setCommitting] = useState(false);
  const [commitOk, setCommitOk] = useState("");
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState("");

  useEffect(() => {
    if (!seriesId) return;
    setLoading(true);
    Promise.all([
      apiFetch<SeriesCapital>(`/series/${seriesId}/capital`),
      apiFetch<FundMovement[]>(`/series/${seriesId}/fund-movements?limit=100`),
    ])
      .then(([cap, mov]) => {
        setCapital(cap);
        setCommitted(mov);
        // Infer strategy creation events from first allocation
        const stratFirstAlloc = new Map<string, string>();
        for (const m of mov) {
          if (m.to_bucket === "STRATEGY" && m.to_strategy) {
            if (!stratFirstAlloc.has(m.to_strategy) || m.ts < stratFirstAlloc.get(m.to_strategy)!) {
              stratFirstAlloc.set(m.to_strategy, m.ts);
            }
          }
        }
        const events: { ts: string; label: string; type: "created" | "deleted" }[] = [];
        for (const [name, ts] of stratFirstAlloc) {
          events.push({ ts, label: `${t("createdStrategy")}: ${name}`, type: "created" as const });
        }
        setLifecycleEvents(events);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [seriesId]);

  // Computed balances: start from capital, apply committed + staged
  const balances = useMemo(() => {
    if (!capital) return { free: 0, strats: {} as Record<string, number> };
    let free = parseFloat(capital.free_cash);
    const strats: Record<string, number> = {};
    for (const s of capital.strategies) {
      strats[s.name_key] = parseFloat(s.net_value);
    }
    // API already reflects all committed movements, so cur = API values
    const curFree = free;
    const curStrats = { ...strats } as Record<string, number>;
    // Apply staged to get projected
    let pFree = free;
    let pStrats = { ...strats };
    for (const s of staged) {
      const r = applyMove(pFree, pStrats, s.fromBucket, s.toBucket, s.amount, s.fromStrat, s.toStrat);
      pFree = r.free;
      pStrats = r.strats;
    }
    return { curFree: Math.round(curFree * 100) / 100, curStrats, projFree: Math.round(pFree * 100) / 100, projStrats: pStrats as Record<string, number> };
  }, [capital, committed, staged]);

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

  // Validate against projected (post-staged) balances so chaining works
  const canWithdraw = (balances.projFree ?? 0) >= parseFloat(formAmount || "0");
  const canAllocate = (balances.projFree ?? 0) >= parseFloat(formAmount || "0");
  const canFree = formFrom ? (balances.projStrats?.[formFrom] || 0) >= parseFloat(formAmount || "0") : false;
  const canTransfer = formFrom && formTo ? (balances.projStrats?.[formFrom] || 0) >= parseFloat(formAmount || "0") : false;

  const validateAdd = (): string | null => {
    const amt = parseFloat(formAmount);
    if (isNaN(amt) || amt <= 0) return "Amount must be > 0";
    switch (formType) {
      case "withdraw": if (!canWithdraw) return "Insufficient free cash"; break;
      case "allocate": if (!canAllocate) return "Insufficient free cash"; break;
      case "free": if (!formFrom) return "Select source strategy"; if (!canFree) return "Insufficient strategy capital"; break;
      case "transfer": if (!formFrom || !formTo) return "Select both strategies"; if (formFrom === formTo) return "Same strategy"; if (!canTransfer) return "Insufficient source capital"; break;
    }
    return null;
  };

  const handleAdd = () => {
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
    }
    setStaged((prev) => [...prev, { id: nextId, fromBucket: fromB, toBucket: toB, fromStrat: fromS, toStrat: toS, amount: amt, label }]);
    setNextId((n) => n + 1);
    setFormAmount("");
  };

  const handleDelete = (idx: number) => {
    setStaged((prev) => prev.slice(0, idx));
  };

  const handleCommit = async () => {
    if (staged.length === 0) return;
    setCommitting(true);
    setCommitOk("");
    try {
      await apiFetch(`/series/${seriesId}/fund-movements`, {
        method: "POST",
        body: staged.map((s, i) => ({
          client_movement_id: `ui-${Date.now()}-${i}`,
          ts: new Date().toISOString(),
          currency: "CNY",
          amount: s.amount.toFixed(2),
          from_bucket: s.fromBucket,
          to_bucket: s.toBucket,
          from_strategy: s.fromStrat,
          to_strategy: s.toStrat,
        })),
      });
      setCommitOk("Committed");
      // Detect new strategies created by allocation
      const prevStrats = new Set(capital?.strategies.map((s) => s.name_key) ?? []);
      setStaged([]);
      const [cap, mov] = await Promise.all([
        apiFetch<SeriesCapital>(`/series/${seriesId}/capital`),
        apiFetch<FundMovement[]>(`/series/${seriesId}/fund-movements?limit=100`),
      ]);
      const newStrats = cap.strategies.filter((s) => !prevStrats.has(s.name_key));
      if (newStrats.length > 0) {
        setLifecycleEvents((prev) => [...prev, ...newStrats.map((s) => ({
          ts: new Date().toISOString(),
          label: `${t("createdStrategy")}: ${s.name_key}`,
          type: "created" as const,
        }))]);
      }
      setCapital(cap);
      setCommitted(mov);
      // Refresh lifecycle events from allocations
      const stratAlloc = new Map<string, string>();
      for (const m of mov) {
        if (m.to_bucket === "STRATEGY" && m.to_strategy) {
          if (!stratAlloc.has(m.to_strategy) || m.ts < stratAlloc.get(m.to_strategy)!) {
            stratAlloc.set(m.to_strategy, m.ts);
          }
        }
      }
      setLifecycleEvents((prev) => {
        const del = prev.filter((e) => e.type === "deleted");
        const created: { ts: string; label: string; type: "created" }[] = Array.from(stratAlloc.entries()).map(([name, ts]) => ({ ts, label: `${t("createdStrategy")}: ${name}`, type: "created" }));
        return [...created, ...del] as { ts: string; label: string; type: "created" | "deleted" }[];
      });
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : "Commit failed");
    } finally {
      setCommitting(false);
    }
  };

  const handleDeleteStrategy = async (nameKey: string) => {
    if (!confirm(`${t("confirmDeleteStrategy")} '${nameKey}'?`)) return;
    try {
      await apiFetch(`/series/${seriesId}/strategies/${nameKey}`, { method: "DELETE" });
      setLifecycleEvents((prev) => [...prev, { ts: new Date().toISOString(), label: `${t("deletedStrategy")}: ${nameKey}`, type: "deleted" }]);
      const [cap, mov] = await Promise.all([
        apiFetch<SeriesCapital>(`/series/${seriesId}/capital`),
        apiFetch<FundMovement[]>(`/series/${seriesId}/fund-movements?limit=100`),
      ]);
      setCapital(cap);
      setCommitted(mov);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed");
    }
  };

  const handleClose = async () => {
    if (!confirm(t("confirmClose"))) return;
    setClosing(true);
    setCloseError("");
    try {
      await apiFetch(`/series/${seriesId}`, { method: "DELETE" });
      window.location.href = `${import.meta.env.BASE_URL}dashboard`;
    } catch (e: unknown) {
      setCloseError(e instanceof Error ? e.message : "Failed to close");
      setClosing(false);
    }
  };

  if (loading) return <div className="p-8 text-secondary">Loading...</div>;
  if (!capital) return <div className="p-8 text-secondary">No data</div>;

  const stratNames = capital.strategies.map((s) => s.name_key);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <h2 className="text-lg font-semibold text-primary">{seriesName} · {t("title")}</h2>

      {/* Balances */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-lg border border-border-default bg-surface p-3">
          <div className="text-[10px] text-secondary uppercase">{t("accountTotal")}</div>
          <div className="text-base font-mono font-semibold text-primary mt-0.5">{fmtAbs(capital.account_total)}</div>
        </div>
        <div className="rounded-lg border border-border-default bg-surface p-3">
          <div className="text-[10px] text-secondary uppercase">{t("freeCash")}</div>
          <div className="text-base font-mono font-semibold text-primary mt-0.5">
            {fmtAbs(String(balances.curFree))}
            {staged.length > 0 && (
              <span className="text-[10px] text-muted ml-1">→ {fmtAbs(String(balances.projFree ?? 0))}</span>
            )}
          </div>
        </div>
        <div className="rounded-lg border border-border-default bg-surface p-3">
          <div className="text-[10px] text-secondary uppercase">{t("strategies")}</div>
          <div className="text-base font-mono font-semibold text-primary mt-0.5">{capital.strategies.length}</div>
        </div>
        <div className="rounded-lg border border-border-default bg-surface p-3">
          <div className="text-[10px] text-secondary uppercase">{t("totalNetValue")}</div>
          <div className="text-base font-mono font-semibold text-primary mt-0.5">
            {fmtAbs(String(parseFloat(capital.free_cash) + capital.strategies.reduce((s, st) => s + parseFloat(st.net_value), 0)))}
          </div>
        </div>
      </div>

      {/* Strategy allocations */}
      <div className="rounded-lg border border-border-default overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border-default bg-surface-2">
          <h3 className="text-sm font-medium text-primary">{t("strategyAllocations")}</h3>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border-default bg-surface-2/50">
              <th className="text-left py-2 px-4 font-medium text-secondary">{t("strategy")}</th>
              <th className="text-right py-2 px-4 font-medium text-secondary">{t("capital")}</th>
              <th className="text-right py-2 px-4 font-medium text-secondary">{t("pnl")}</th>
              <th className="text-right py-2 px-4 font-medium text-secondary">{t("netValue")}</th>
              <th className="text-right py-2 px-4 font-medium text-secondary">{t("returnPct")}</th>
              <th className="text-right py-2 px-4 font-medium text-secondary">{t("projected")}</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {capital.strategies.map((s) => {
              const retPct = parseFloat(s.capital) > 0 ? (parseFloat(s.pnl) / parseFloat(s.capital) * 100) : 0;
              const proj = balances.projStrats?.[s.name_key] ?? parseFloat(s.net_value);
              const diff = proj - parseFloat(s.net_value);
              return (
                <tr key={s.strategy_id} className="hover:bg-surface-2/50">
                  <td className="py-2 px-4 text-primary font-medium">{s.name_key}</td>
                  <td className="py-2 px-4 text-right font-mono text-secondary">{fmtAbs(s.capital)}</td>
                  <td className={`py-2 px-4 text-right font-mono ${parseFloat(s.pnl) >= 0 ? "text-pnl-gain" : "text-pnl-loss"}`}>{fmt(s.pnl)}</td>
                  <td className="py-2 px-4 text-right font-mono text-primary">{fmtAbs(s.net_value)}</td>
                  <td className={`py-2 px-4 text-right font-mono ${retPct >= 0 ? "text-pnl-gain" : "text-pnl-loss"}`}>{retPct >= 0 ? "+" : ""}{retPct.toFixed(1)}%</td>
                  <td className={`py-2 px-4 text-right font-mono ${diff !== 0 ? "text-accent" : "text-muted"}`}>
                    {fmtAbs(String(proj))}
                  </td>
                  <td className="py-2 px-2 text-center">
                    <button
                      onClick={() => handleDeleteStrategy(s.name_key)}
                      className="text-[10px] text-pnl-loss hover:underline"
                      title={t("deleteStrategy")}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add movement form */}
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

          {(formType === "allocate" || formType === "transfer") && (
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
            onClick={handleAdd}
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

      {/* Staged movements */}
      {staged.length > 0 && (
        <div className="rounded-lg border border-accent/30 bg-accent/5 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-accent/20 flex items-center justify-between">
            <h3 className="text-sm font-medium text-accent">{t("stagedChanges")} ({staged.length})</h3>
            <span className="text-[10px] text-muted">{t("notYetPersisted")}</span>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border-default">
                <th className="text-left py-2 px-3 font-medium text-secondary w-8">#</th>
                <th className="text-left py-2 px-3 font-medium text-secondary">{t("action")}</th>
                <th className="text-right py-2 px-3 font-medium text-secondary">{t("amount")}</th>
                <th className="text-right py-2 px-3 font-medium text-secondary w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {staged.map((s, idx) => (
                <tr key={s.id} className="hover:bg-surface-2/50">
                  <td className="py-1.5 px-3 text-muted">{idx + 1}</td>
                  <td className="py-1.5 px-3 text-primary">{s.label}</td>
                  <td className="py-1.5 px-3 text-right font-mono text-primary">{fmtAbs(String(s.amount))}</td>
                  <td className="py-1.5 px-3 text-right">
                    <button
                      onClick={() => handleDelete(idx)}
                      className="text-[10px] text-pnl-loss hover:underline"
                      title="Delete this and all after"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-3 border-t border-accent/20 flex justify-end">
            <button
              onClick={handleCommit}
              disabled={committing}
              className="rounded-md bg-accent text-white px-6 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {committing ? t("committing") : t("commitAll")}
            </button>
          </div>
        </div>
      )}
      {commitOk && <p className="text-xs text-pnl-gain text-center">{t("committed")}</p>}

      {/* Committed history */}
      <div className="rounded-lg border border-border-default overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border-default bg-surface-2">
          <h3 className="text-sm font-medium text-primary">{t("recentMovements")}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border-default bg-surface-2/50">
                <th className="text-left py-2 px-3 font-medium text-secondary">{t("time")}</th>
                <th className="text-left py-2 px-3 font-medium text-secondary">{t("from")}</th>
                <th className="text-left py-2 px-3 font-medium text-secondary">{t("to")}</th>
                <th className="text-right py-2 px-3 font-medium text-secondary">{t("amount")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {[...committed.slice(0, 40).map((m) => ({ type: "movement" as const, ts: m.ts, data: m })),
                ...lifecycleEvents.slice(0, 20).map((e) => ({ type: "lifecycle" as const, ts: e.ts, data: e }))]
                .sort((a, b) => {
                  const dt = new Date(b.ts).getTime() - new Date(a.ts).getTime();
                  if (dt !== 0) return dt;
                  // lifecycle events after movements at same timestamp
                  return a.type === "lifecycle" ? 1 : -1;
                })
                .slice(0, 40)
                .map((entry, i) => {
                  if (entry.type === "lifecycle") {
                    return (
                      <tr key={`lc-${i}`} className="hover:bg-surface-2/50 bg-accent/5">
                        <td className="py-1.5 px-3 text-secondary whitespace-nowrap">{entry.ts.slice(0, 19).replace("T", " ")}</td>
                        <td className="py-1.5 px-3 text-accent" colSpan={2}>{entry.data.label}</td>
                        <td className="py-1.5 px-3 text-right font-mono text-muted">—</td>
                      </tr>
                    );
                  }
                  const m = entry.data;
                  return (
                    <tr key={`m-${i}`} className="hover:bg-surface-2/50">
                      <td className="py-1.5 px-3 text-secondary whitespace-nowrap">{m.ts.slice(0, 19).replace("T", " ")}</td>
                      <td className="py-1.5 px-3 text-secondary">{m.from_bucket}{m.from_strategy ? ` — ${m.from_strategy}` : ""}</td>
                      <td className="py-1.5 px-3 text-secondary">{m.to_bucket}{m.to_strategy ? ` — ${m.to_strategy}` : ""}</td>
                      <td className="py-1.5 px-3 text-right font-mono text-primary">{fmtAbs(m.amount)}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Close section */}
      <div className="rounded-lg border border-border-default bg-surface p-4">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-medium text-primary">{t("closeAccount")}</span>
            <p className="text-[11px] text-muted mt-0.5">{t("closeHint")}</p>
          </div>
          <button
            onClick={handleClose}
            disabled={closing}
            className="rounded-md border border-pnl-loss/30 bg-pnl-loss/10 text-pnl-loss px-3 py-1.5 text-xs font-medium hover:bg-pnl-loss/20 disabled:opacity-50"
          >
            {closing ? "..." : t("closeAccount")}
          </button>
        </div>
        {closeError && <p className="mt-2 text-xs text-pnl-loss">{closeError}</p>}
      </div>
    </div>
  );
}

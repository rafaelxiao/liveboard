import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
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

export default function CapitalPage() {
  const { id } = useParams<{ id: string }>();
  const seriesId = Number(id);
  const { data: seriesList } = useSeriesList();
  const seriesName = (seriesList as { id: number; name: string }[] | undefined)?.find((s) => s.id === seriesId)?.name || `Series ${seriesId}`;

  const [capital, setCapital] = useState<SeriesCapital | null>(null);
  const [movements, setMovements] = useState<FundMovement[]>([]);
  const [loading, setLoading] = useState(true);

  // Fund movement form
  const [formType, setFormType] = useState("deposit"); // deposit|withdraw|allocate|free|transfer
  const [formAmount, setFormAmount] = useState("");
  const [formFrom, setFormFrom] = useState("");
  const [formTo, setFormTo] = useState("");
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [formOk, setFormOk] = useState("");

  useEffect(() => {
    if (!seriesId) return;
    setLoading(true);
    Promise.all([
      apiFetch<SeriesCapital>(`/series/${seriesId}/capital`),
      apiFetch<FundMovement[]>(`/series/${seriesId}/fund-movements?limit=50`),
    ])
      .then(([cap, mov]) => {
        setCapital(cap);
        setMovements(mov);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [seriesId]);

  const handleSubmit = async () => {
    setFormError("");
    setFormOk("");
    const amt = parseFloat(formAmount);
    if (isNaN(amt) || amt <= 0) { setFormError("Amount must be > 0"); return; }

    let fromBucket = "";
    let toBucket = "";
    let fromStrat: string | null = null;
    let toStrat: string | null = null;

    switch (formType) {
      case "deposit":
        fromBucket = "EXTERNAL"; toBucket = "FREE_CASH"; break;
      case "withdraw":
        fromBucket = "FREE_CASH"; toBucket = "EXTERNAL"; break;
      case "allocate":
        fromBucket = "FREE_CASH"; toBucket = "STRATEGY"; toStrat = formTo; break;
      case "free":
        fromBucket = "STRATEGY"; toBucket = "FREE_CASH"; fromStrat = formFrom; break;
      case "transfer":
        fromBucket = "STRATEGY"; toBucket = "STRATEGY"; fromStrat = formFrom; toStrat = formTo; break;
    }

    if ((formType === "allocate" || formType === "transfer") && !toStrat) {
      setFormError("Select target strategy"); return;
    }
    if ((formType === "free" || formType === "transfer") && !fromStrat) {
      setFormError("Select source strategy"); return;
    }

    setFormSubmitting(true);
    try {
      await apiFetch(`/series/${seriesId}/fund-movements`, {
        method: "POST",
        body: [{
          client_movement_id: `ui-${Date.now()}`,
          ts: new Date().toISOString(),
          currency: "CNY",
          amount: amt.toFixed(2),
          from_bucket: fromBucket,
          to_bucket: toBucket,
          from_strategy: fromStrat,
          to_strategy: toStrat,
        }],
      });
      setFormOk("Done");
      setFormAmount("");
      // Refresh
      const [cap, mov] = await Promise.all([
        apiFetch<SeriesCapital>(`/series/${seriesId}/capital`),
        apiFetch<FundMovement[]>(`/series/${seriesId}/fund-movements?limit=50`),
      ]);
      setCapital(cap);
      setMovements(mov);
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : "Failed");
    } finally {
      setFormSubmitting(false);
    }
  };

  if (loading) return <div className="p-8 text-secondary">Loading...</div>;
  if (!capital) return <div className="p-8 text-secondary">No data</div>;

  const strategNames = capital.strategies.map((s) => s.name_key);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <h2 className="text-lg font-semibold text-primary">{seriesName} · Fund Management</h2>

      {/* Snapshot */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="rounded-lg border border-border-default bg-surface p-4">
          <div className="text-xs text-secondary">Account Total</div>
          <div className="text-lg font-mono font-semibold text-primary mt-1">{fmtAbs(capital.account_total)}</div>
        </div>
        <div className="rounded-lg border border-border-default bg-surface p-4">
          <div className="text-xs text-secondary">Free Cash</div>
          <div className="text-lg font-mono font-semibold text-primary mt-1">{fmtAbs(capital.free_cash)}</div>
        </div>
        <div className="rounded-lg border border-border-default bg-surface p-4">
          <div className="text-xs text-secondary">Strategies</div>
          <div className="text-lg font-mono font-semibold text-primary mt-1">{capital.strategies.length}</div>
        </div>
        <div className="rounded-lg border border-border-default bg-surface p-4">
          <div className="text-xs text-secondary">Total Net Value</div>
          <div className="text-lg font-mono font-semibold text-primary mt-1">
            {fmtAbs(
              String(parseFloat(capital.free_cash) + capital.strategies.reduce((s, st) => s + parseFloat(st.net_value), 0))
            )}
          </div>
        </div>
      </div>

      {/* Strategy table */}
      <div className="rounded-lg border border-border-default overflow-hidden">
        <div className="px-4 py-3 border-b border-border-default bg-surface-2">
          <h3 className="text-sm font-medium text-primary">Strategy Allocations</h3>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border-default bg-surface-2/50">
              <th className="text-left py-2 px-4 font-medium text-secondary">Strategy</th>
              <th className="text-right py-2 px-4 font-medium text-secondary">Capital</th>
              <th className="text-right py-2 px-4 font-medium text-secondary">PnL</th>
              <th className="text-right py-2 px-4 font-medium text-secondary">Net Value</th>
              <th className="text-right py-2 px-4 font-medium text-secondary">Return %</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {capital.strategies.map((s) => {
              const retPct = parseFloat(s.capital) > 0
                ? (parseFloat(s.pnl) / parseFloat(s.capital) * 100)
                : 0;
              return (
                <tr key={s.strategy_id} className="hover:bg-surface-2/50">
                  <td className="py-2 px-4 text-primary font-medium">{s.name_key}</td>
                  <td className="py-2 px-4 text-right font-mono text-secondary">{fmtAbs(s.capital)}</td>
                  <td className={`py-2 px-4 text-right font-mono ${parseFloat(s.pnl) >= 0 ? "text-pnl-gain" : "text-pnl-loss"}`}>
                    {fmt(s.pnl)}
                  </td>
                  <td className="py-2 px-4 text-right font-mono text-primary">{fmtAbs(s.net_value)}</td>
                  <td className={`py-2 px-4 text-right font-mono ${retPct >= 0 ? "text-pnl-gain" : "text-pnl-loss"}`}>
                    {retPct >= 0 ? "+" : ""}{retPct.toFixed(1)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Fund movement form */}
      <div className="rounded-lg border border-border-default bg-surface p-5">
        <h3 className="text-sm font-medium text-primary mb-4">Fund Movement</h3>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-secondary">
            Type
            <select
              value={formType}
              onChange={(e) => { setFormType(e.target.value); setFormFrom(""); setFormTo(""); }}
              className="mt-1 block rounded border border-border-default bg-surface px-2 py-1.5 text-xs text-primary w-28"
            >
              <option value="deposit">Deposit</option>
              <option value="withdraw">Withdraw</option>
              <option value="allocate">Allocate → Strategy</option>
              <option value="free">Free ← Strategy</option>
              <option value="transfer">Strategy → Strategy</option>
            </select>
          </label>

          {(formType === "free" || formType === "transfer") && (
            <label className="text-xs text-secondary">
              From
              <select value={formFrom} onChange={(e) => setFormFrom(e.target.value)} className="mt-1 block rounded border border-border-default bg-surface px-2 py-1.5 text-xs text-primary w-36">
                <option value="">—</option>
                {strategNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          )}

          {(formType === "allocate" || formType === "transfer") && (
            <label className="text-xs text-secondary">
              To
              <select value={formTo} onChange={(e) => setFormTo(e.target.value)} className="mt-1 block rounded border border-border-default bg-surface px-2 py-1.5 text-xs text-primary w-36">
                <option value="">—</option>
                {strategNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          )}

          <label className="text-xs text-secondary">
            Amount
            <input
              type="number"
              value={formAmount}
              onChange={(e) => setFormAmount(e.target.value)}
              placeholder="0.00"
              className="mt-1 block rounded border border-border-default bg-surface px-2 py-1.5 text-xs text-primary w-32 font-mono"
            />
          </label>

          <button
            onClick={handleSubmit}
            disabled={formSubmitting}
            className="rounded-md bg-accent text-white px-4 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-50"
          >
            {formSubmitting ? "..." : "Submit"}
          </button>
        </div>
        {formError && <p className="mt-2 text-xs text-pnl-loss">{formError}</p>}
        {formOk && <p className="mt-2 text-xs text-pnl-gain">{formOk}</p>}
      </div>

      {/* Movement history */}
      <div className="rounded-lg border border-border-default overflow-hidden">
        <div className="px-4 py-3 border-b border-border-default bg-surface-2">
          <h3 className="text-sm font-medium text-primary">Recent Movements</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border-default bg-surface-2/50">
                <th className="text-left py-2 px-3 font-medium text-secondary">Time</th>
                <th className="text-left py-2 px-3 font-medium text-secondary">From</th>
                <th className="text-left py-2 px-3 font-medium text-secondary">To</th>
                <th className="text-right py-2 px-3 font-medium text-secondary">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {movements.slice(0, 30).map((m, i) => (
                <tr key={i} className="hover:bg-surface-2/50">
                  <td className="py-1.5 px-3 text-secondary whitespace-nowrap">{m.ts.slice(0, 19).replace("T", " ")}</td>
                  <td className="py-1.5 px-3 text-secondary">
                    {m.from_bucket}{m.from_strategy ? ` — ${m.from_strategy}` : ""}
                  </td>
                  <td className="py-1.5 px-3 text-secondary">
                    {m.to_bucket}{m.to_strategy ? ` — ${m.to_strategy}` : ""}
                  </td>
                  <td className="py-1.5 px-3 text-right font-mono text-primary">{fmtAbs(m.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

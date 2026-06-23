interface NormalizationToggleProps {
  value: "absolute" | "indexed";
  onChange: (v: "absolute" | "indexed") => void;
}

export default function NormalizationToggle({ value, onChange }: NormalizationToggleProps) {
  return (
    <div className="inline-flex rounded-md border border-border-default">
      <button type="button" onClick={() => onChange("absolute")}
        className={`px-3 py-1.5 text-xs rounded-l-md ${value === "absolute" ? "bg-accent text-white" : "bg-surface text-secondary"}`}>
        Absolute $
      </button>
      <button type="button" onClick={() => onChange("indexed")}
        className={`px-3 py-1.5 text-xs rounded-r-md ${value === "indexed" ? "bg-accent text-white" : "bg-surface text-secondary"}`}>
        Indexed
      </button>
    </div>
  );
}

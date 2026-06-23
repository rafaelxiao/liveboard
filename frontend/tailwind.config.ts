import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        app: "rgb(var(--bg-app) / <alpha-value>)",
        surface: "rgb(var(--bg-surface) / <alpha-value>)",
        "surface-2": "rgb(var(--bg-surface-2) / <alpha-value>)",
        "surface-3": "rgb(var(--bg-surface-3) / <alpha-value>)",
        "border-subtle": "rgb(var(--border-subtle) / <alpha-value>)",
        "border-default": "rgb(var(--border-default) / <alpha-value>)",
        "border-strong": "rgb(var(--border-strong) / <alpha-value>)",
        primary: "rgb(var(--text-primary) / <alpha-value>)",
        secondary: "rgb(var(--text-secondary) / <alpha-value>)",
        muted: "rgb(var(--text-muted) / <alpha-value>)",
        tertiary: "rgb(var(--text-tertiary) / <alpha-value>)",
        disabled: "rgb(var(--text-disabled) / <alpha-value>)",
        accent: "rgb(var(--accent-primary) / <alpha-value>)",
        "accent-hover": "rgb(var(--accent-primary-hover) / <alpha-value>)",
        "pnl-gain": "rgb(var(--pnl-gain) / <alpha-value>)",
        "pnl-loss": "rgb(var(--pnl-loss) / <alpha-value>)",
        "pnl-neutral": "rgb(var(--pnl-neutral) / <alpha-value>)",
        "success-ui": "rgb(var(--success-ui) / <alpha-value>)",
        "danger-ui": "rgb(var(--danger-ui) / <alpha-value>)",
        warning: "rgb(var(--warning) / <alpha-value>)",
        info: "rgb(var(--info) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["'Fira Sans'", "system-ui", "sans-serif"],
        mono: ["'Fira Code'", "ui-monospace", "monospace"],
      },
      borderRadius: { sm: "6px", md: "8px", lg: "12px" },
      ringColor: { focus: "rgb(var(--focus-ring))" },
    },
  },
  plugins: [],
};

export default config;

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "../../packages/ui/src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: "var(--bg)",
          1: "var(--bg-1)",
          2: "var(--bg-2)",
          3: "var(--bg-3)",
          elev: "var(--bg-elev)",
        },
        fg: {
          DEFAULT: "var(--fg)",
          2: "var(--fg-2)",
          3: "var(--fg-3)",
          muted: "var(--fg-muted)",
        },
        "border-strong": "var(--border-strong)",
        hover: "var(--hover)",
        selected: "var(--selected)",
        accent: {
          DEFAULT: "var(--accent)",
          strong: "var(--accent-strong)",
          soft: "var(--accent-soft)",
          fg: "var(--accent-fg)",
          glow: "var(--accent-glow)",
        },
        background: { DEFAULT: "hsl(var(--background))" },
        foreground: "hsl(var(--foreground))",
        border: { DEFAULT: "var(--border)", hover: "var(--border-strong)" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        "slide-in-right": { from: { transform: "translateX(8px)", opacity: "0" }, to: { transform: "translateX(0)", opacity: "1" } },
      },
      animation: {
        "fade-in": "fade-in 0.15s ease-out",
        "slide-in-right": "slide-in-right 0.15s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

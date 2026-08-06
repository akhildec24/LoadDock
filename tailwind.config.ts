import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        rams: {
          bg: "#FAFAF9",
          surface: "#FFFFFF",
          border: "#E5E5E4",
          "border-strong": "#D4D4D3",
          text: "#1C1C1C",
          "text-secondary": "#6B6B6B",
          "text-muted": "#A0A0A0",
          accent: "#E8550D",
          "accent-hover": "#C9460B",
          pass: "#3B7A57",
          fail: "#C0392B",
          running: "#2D6A9F",
          warning: "#D4943A",
        },
      },
      fontFamily: {
        sans: ["Inter", "SF Pro Text", "-apple-system", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "SF Mono", "Menlo", "monospace"],
      },
      fontSize: {
        "2xs": ["0.6875rem", "1rem"],
        "3xs": ["0.625rem", "0.875rem"],
      },
      borderRadius: {
        rams: "3px",
      },
      borderWidth: {
        hairline: "0.5px",
      },
      boxShadow: {
        rams: "0 1px 2px rgba(0, 0, 0, 0.04)",
        "rams-lg": "0 4px 12px rgba(0, 0, 0, 0.06)",
      },
      animation: {
        "fade-in": "fadeIn 150ms ease-out",
        "slide-up": "slideUp 200ms ease-out",
        "pulse-subtle": "pulseSubtle 2s ease-in-out infinite",
        "pulse-ring": "pulseRing 1.5s ease-out infinite",
        "shimmer": "shimmer 2s linear infinite",
        "flow": "flow 1.5s linear infinite",
        "blink": "blink 1s step-start infinite",
        "bar-fill": "barFill 0.4s ease-out",
        "bounce-in": "bounceIn 300ms cubic-bezier(0.34, 1.56, 0.64, 1)",
        "scan": "scan 2s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulseSubtle: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
        pulseRing: {
          "0%": { transform: "scale(1)", opacity: "0.8" },
          "100%": { transform: "scale(2.5)", opacity: "0" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        flow: {
          "0%": { transform: "translateX(-100%)", opacity: "0" },
          "20%": { opacity: "1" },
          "80%": { opacity: "1" },
          "100%": { transform: "translateX(400%)", opacity: "0" },
        },
        blink: {
          "0%, 50%": { opacity: "1" },
          "51%, 100%": { opacity: "0.2" },
        },
        barFill: {
          "0%": { width: "0%" },
          "100%": { width: "var(--bar-width, 100%)" },
        },
        bounceIn: {
          "0%": { opacity: "0", transform: "scale(0.8)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        scan: {
          "0%, 100%": { transform: "translateX(0)" },
          "50%": { transform: "translateX(100%)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;

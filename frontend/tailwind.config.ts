import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        metatron: {
          bg: "#0a0a0f",
          card: "#16161f",
          text: "#e8e8ed",
          muted: "#8888a0",
          accent: "#6c5ce7",
          "accent-hover": "#5b4bd4",
          "accent-glow": "rgba(108, 92, 231, 0.2)",
          border: "rgba(255, 255, 255, 0.06)"
        }
      },
      fontFamily: {
        sans: ["var(--font-dm-sans)", "DM Sans", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains-mono)", "JetBrains Mono", "monospace"]
      },
      borderRadius: {
        metatron: "12px"
      },
      backgroundImage: {
        "metatron-grid":
          "linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)",
        "metatron-orb":
          "radial-gradient(circle, rgba(108, 92, 231, 0.2) 0%, transparent 65%)"
      },
      backgroundSize: {
        grid: "52px 52px"
      },
      animation: {
        "orb-pulse": "orbPulse 8s ease-in-out infinite"
      },
      keyframes: {
        orbPulse: {
          "0%, 100%": { opacity: "0.6" },
          "50%": { opacity: "0.85" }
        }
      }
    }
  },
  plugins: []
};

export default config;

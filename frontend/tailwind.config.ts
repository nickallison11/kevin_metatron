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
        "orb-pulse": "orbPulse 8s ease-in-out infinite",
        aurora: "aurora 60s linear infinite",
        spotlight: "spotlight 2s ease 0.75s forwards",
        "meteor-effect": "meteor 5s linear infinite",
        "border-beam": "border-beam calc(var(--duration, 12) * 1s) linear infinite",
        shimmer: "shimmer 2s linear infinite",
        "grid-drift": "gridDrift 32s linear infinite"
      },
      keyframes: {
        orbPulse: {
          "0%, 100%": { opacity: "0.6" },
          "50%": { opacity: "0.85" }
        },
        aurora: {
          from: { backgroundPosition: "50% 50%, 50% 50%" },
          to: { backgroundPosition: "350% 50%, 350% 50%" }
        },
        spotlight: {
          "0%": {
            opacity: "0",
            transform: "translate(-72%, -62%) scale(0.5)"
          },
          "100%": {
            opacity: "1",
            transform: "translate(-50%, -40%) scale(1)"
          }
        },
        meteor: {
          "0%": { transform: "rotate(45deg) translateX(0)", opacity: "1" },
          "70%": { opacity: "1" },
          "100%": {
            transform: "rotate(45deg) translateX(-520px)",
            opacity: "0"
          }
        },
        "border-beam": {
          "100%": { offsetDistance: "100%" }
        },
        shimmer: {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(100%)" }
        },
        gridDrift: {
          "0%": { backgroundPosition: "0px 0px" },
          "100%": { backgroundPosition: "52px 52px" }
        }
      }
    }
  },
  plugins: []
};

export default config;

import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    // Shared className tokens live here (lib/ui.ts) — Tailwind must scan it or
    // those utilities (panel fill, blur, focus rings) never get generated.
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;

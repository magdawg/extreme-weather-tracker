// ESLint 9 flat config. Next 16 removed the `next lint` subcommand, so we run
// the ESLint CLI directly (see the "lint" script) against this config.
import coreWebVitals from "eslint-config-next/core-web-vitals";

const config = [
  ...coreWebVitals,
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
];

export default config;

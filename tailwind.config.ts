import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: { colors: { acid: "#caff68", ink: "#0b0d0c", muted: "#969e97" } },
  },
  plugins: [],
} satisfies Config;

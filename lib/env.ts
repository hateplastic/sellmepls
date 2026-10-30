import "server-only";
import { z } from "zod";
import { RPC_DEFAULTS, type EvmNetwork } from "./network";
const schema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(10),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10),
  NEXT_PUBLIC_CHAIN_ENV: z.enum(["testnet", "mainnet"]).default("testnet"),
  QUOTE_SIGNER_PRIVATE_KEY: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  REFERRAL_SECRET: z.string().min(32),
  BASE_RPC_URL: z.string().url(),
  ARBITRUM_RPC_URL: z.string().url(),
  ETHEREUM_RPC_URL: z.string().url().default(RPC_DEFAULTS.ethereum),
  BSC_RPC_URL: z.string().url().default(RPC_DEFAULTS.bsc),
  SOLANA_RPC_URL: z.string().url(),
  PLATFORM_EVM_WALLET: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  PLATFORM_SOLANA_WALLET: z.string().min(32),
  BASE_PAYMENT_ROUTER: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  ARBITRUM_PAYMENT_ROUTER: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  EVM_CONFIRMATIONS: z.coerce.number().int().min(1).max(100).default(1),
  SOLANA_COMMITMENT: z.enum(["confirmed", "finalized"]).default("confirmed"),
  S3_ENDPOINT: z.string().url().optional().or(z.literal("")),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("false"),
  CRON_SECRET: z.string().min(32),
  MAX_FILE_BYTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(1_073_741_824)
    .default(104_857_600),
});
function parse<T extends z.ZodTypeAny>(scope: T): z.infer<T> {
  const parsed = scope.safeParse(process.env);
  if (!parsed.success)
    throw new Error(
      `Server configuration missing/invalid: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    );
  const appUrl =
    typeof parsed.data === "object" &&
    parsed.data !== null &&
    "NEXT_PUBLIC_APP_URL" in parsed.data
      ? parsed.data.NEXT_PUBLIC_APP_URL
      : undefined;
  if (
    process.env.NODE_ENV === "production" &&
    typeof appUrl === "string" &&
    !appUrl.startsWith("https://")
  )
    throw new Error("Production APP_URL must use HTTPS");
  return parsed.data;
}
export const appEnv = () => parse(schema.pick({ NEXT_PUBLIC_APP_URL: true }));
export const databaseEnv = () =>
  parse(
    schema.pick({
      NEXT_PUBLIC_SUPABASE_URL: true,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: true,
      SUPABASE_SERVICE_ROLE_KEY: true,
    }),
  );
export const storageEnv = () =>
  parse(
    schema.pick({
      S3_ENDPOINT: true,
      S3_REGION: true,
      S3_BUCKET: true,
      S3_ACCESS_KEY_ID: true,
      S3_SECRET_ACCESS_KEY: true,
      S3_FORCE_PATH_STYLE: true,
      MAX_FILE_BYTES: true,
    }),
  );
export const referralEnv = () =>
  parse(schema.pick({ NEXT_PUBLIC_APP_URL: true, REFERRAL_SECRET: true }));
export const settlementEnv = () =>
  parse(
    schema.pick({
      BASE_RPC_URL: true,
      ARBITRUM_RPC_URL: true,
      ETHEREUM_RPC_URL: true,
      BSC_RPC_URL: true,
      SOLANA_RPC_URL: true,
      EVM_CONFIRMATIONS: true,
      SOLANA_COMMITMENT: true,
    }),
  );
export const paymentEnv = () => ({
  ...settlementEnv(),
  ...parse(
    schema.pick({
      PLATFORM_EVM_WALLET: true,
      PLATFORM_SOLANA_WALLET: true,
      QUOTE_SIGNER_PRIVATE_KEY: true,
    }),
  ),
});
export function serverEvmRpc(network: EvmNetwork) {
  const value =
    process.env[`${network.toUpperCase()}_RPC_URL`] || RPC_DEFAULTS[network];
  if (!z.string().url().safeParse(value).success)
    throw new Error("Invalid EVM RPC configuration");
  return value;
}
export function paymentRouter(network: EvmNetwork) {
  const key = `${network.toUpperCase()}_PAYMENT_ROUTER`;
  const value = process.env[key];
  if (!value) return null;
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) throw new Error(`Invalid ${key}`);
  return value;
}
export const cronEnv = () => parse(schema.pick({ CRON_SECRET: true }));
export const env = () => parse(schema);

import { z } from "zod";
import type { Hex } from "viem";
import { requireAdmin } from "@/lib/admin";
import { rateLimit } from "@/lib/auth";
import { sameOrigin, readJson, json, failure } from "@/lib/http";
import { configuredRouter } from "@/lib/payment-routers";
import { deploymentConfig } from "@/lib/router-deployment";
import { registerEvmDeployment } from "@/lib/evm-deployment";
import { CHAIN_ENV, EVM_NETWORKS } from "@/lib/network";
const networkSchema = z.enum(EVM_NETWORKS);
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const network = networkSchema.parse(
      new URL(request.url).searchParams.get("network"),
    );
    return json({
      ...deploymentConfig(network),
      address: await configuredRouter(network),
      environment: CHAIN_ENV,
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const user = await requireAdmin();
    await rateLimit("deploy:" + user.id, 20);
    const { network, hash } = z
      .object({
        network: networkSchema,
        hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
      })
      .parse(await readJson(request));
    return json(await registerEvmDeployment(network, hash as Hex, user.id));
  } catch (error) {
    return failure(error);
  }
}

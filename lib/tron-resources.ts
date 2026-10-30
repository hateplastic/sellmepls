export type TronResources = {
  EnergyLimit?: number;
  EnergyUsed?: number;
  NetLimit?: number;
  NetUsed?: number;
  freeNetLimit?: number;
  freeNetUsed?: number;
};
export function tronResourceBudget(
  energy: number,
  bytes: number,
  energyPrice: number,
  bandwidthPrice: number,
  resources: TronResources,
) {
  const remaining = (limit = 0, used = 0) => Math.max(0, limit - used);
  const availableEnergy = remaining(
    resources.EnergyLimit,
    resources.EnergyUsed,
  );
  const availableBandwidth = Math.max(
    remaining(resources.NetLimit, resources.NetUsed),
    remaining(resources.freeNetLimit, resources.freeNetUsed),
  );
  // TRON uses one bandwidth source for the whole transaction; small leftovers are not pooled.
  const energyCost = Math.max(0, energy - availableEnergy) * energyPrice;
  const bandwidthCost =
    availableBandwidth >= bytes ? 0 : bytes * bandwidthPrice;
  if (
    !Number.isSafeInteger(energyCost + bandwidthCost) ||
    energyCost < 0 ||
    bandwidthCost < 0
  )
    throw new Error("Invalid TRON resource budget");
  return BigInt(energyCost + bandwidthCost);
}

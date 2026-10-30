"use client";
import { useState } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getWagmiConfig } from "@/lib/web3";
export function Providers({ children }: { children: React.ReactNode }) {
  const [config] = useState(getWagmiConfig),
    [query] = useState(
      () =>
        new QueryClient({
          defaultOptions: { queries: { staleTime: 15_000, retry: 1 } },
        }),
    );
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={query}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}

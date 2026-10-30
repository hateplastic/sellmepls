import Link from "next/link";
import { ArrowUpRight, Command } from "lucide-react";
import { WalletAuth } from "./wallet-auth";
import { TESTNET } from "@/lib/network";
export function Nav() {
  return (
    <header className="border-b border-white/10">
      {TESTNET && (
        <div className="text-center text-xs bg-acid/10 text-acid py-2 px-4">
          Тестовый режим · Base Sepolia / Arbitrum Sepolia / Solana Devnet ·
          тестовые токены
        </div>
      )}
      <nav className="shell flex min-h-20 items-center justify-between gap-2 sm:gap-5">
        <Link
          href="/"
          className="flex items-center gap-2 text-xl font-bold tracking-tight"
        >
          <Command className="text-acid" size={24} />
          sellmepls<span className="text-acid">.</span>
        </Link>
        <div className="hidden md:flex items-center gap-8 text-sm text-muted">
          <Link href="/#market" className="hover:text-white">
            Маркетплейс
          </Link>
          <Link href="/messages" className="hover:text-white">
            Сообщения
          </Link>
          <Link href="/affiliates" className="hover:text-white">
            Партнёрам
          </Link>
          <Link href="/wallets" className="hover:text-white">
            Кошельки и сети
          </Link>
        </div>
        <div className="flex gap-3 items-center">
          <Link
            href="/dashboard"
            className="text-sm hidden sm:flex items-center gap-1"
          >
            Кабинет
            <ArrowUpRight size={15} />
          </Link>
          <WalletAuth compact />
        </div>
      </nav>
      <div className="shell flex flex-wrap gap-4 pb-4 text-xs text-muted md:hidden">
        <Link href="/#market">Маркетплейс</Link>
        <Link href="/dashboard">Кабинет</Link>
        <Link href="/affiliates">Партнёрам</Link>
        <Link href="/messages">Сообщения</Link>
        <Link href="/wallets">Кошельки и сети</Link>
      </div>
    </header>
  );
}

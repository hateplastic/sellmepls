import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import { Nav } from "@/components/nav";
import "./globals.css";
export const metadata: Metadata = {
  title: {
    default: "Sellmepls — творчество без границ",
    template: "%s · Sellmepls",
  },
  description:
    "Цифровые товары. Оплата криптовалютой. Прямые выплаты создателям.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" data-scroll-behavior="smooth">
      <body>
        <Providers>
          <Nav />
          <main>{children}</main>
          <footer className="mt-20 border-t border-white/10">
            <div className="shell py-8 flex flex-wrap justify-between gap-4 text-xs text-muted">
              <span>© {new Date().getFullYear()} Sellmepls</span>
              <span>Base · Arbitrum · Solana</span>
              <span>Создавайте. Делитесь. Получайте оплату.</span>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}

"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, walletError } from "@/lib/wallet";
export function ProfileForm({
  profile,
}: {
  profile: {
    display_name: string;
    bio: string;
    evm_wallet: string | null;
    solana_wallet: string | null;
    tron_wallet?: string | null;
  };
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const router = useRouter();
  return (
    <details id="profile" className="panel p-6 mb-8">
      <summary className="cursor-pointer text-xl">Профиль и выплаты</summary>
      <form
        className="mt-6 grid sm:grid-cols-2 gap-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMessage("");
          const d = new FormData(e.currentTarget);
          try {
            await api("/api/profile", {
              displayName: d.get("displayName"),
              bio: d.get("bio"),
              evmWallet: d.get("evmWallet"),
              solanaWallet: d.get("solanaWallet"),
              tronWallet: d.get("tronWallet"),
            });
            setMessage("Профиль сохранён");
            router.refresh();
          } catch (err) {
            setMessage(walletError(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Имя автора или магазина
          <input
            className="mt-2"
            name="displayName"
            minLength={2}
            maxLength={60}
            defaultValue={profile.display_name}
            required
          />
        </label>
        <label>
          О себе
          <textarea
            className="mt-2"
            name="bio"
            maxLength={1000}
            defaultValue={profile.bio}
          />
        </label>
        <label>
          EVM адрес для выплат
          <input
            className="mt-2 font-mono text-xs"
            name="evmWallet"
            defaultValue={profile.evm_wallet || ""}
            maxLength={42}
          />
        </label>
        <label>
          Solana адрес для выплат
          <input
            className="mt-2 font-mono text-xs"
            name="solanaWallet"
            defaultValue={profile.solana_wallet || ""}
            maxLength={44}
          />
        </label>
        <input
          type="hidden"
          name="tronWallet"
          value={profile.tron_wallet || ""}
        />
        <p className="text-xs text-muted sm:col-span-2">
          На эти адреса поступают продажи и партнёрские вознаграждения. Укажите
          адреса для выбранных сетей. Изменения применяются к новым заказам.
        </p>
        <button disabled={busy} className="button-primary">
          {busy ? "Сохраняем…" : "Сохранить профиль"}
        </button>
        <p role="status" className="text-sm text-acid">
          {message}
        </p>
      </form>
    </details>
  );
}

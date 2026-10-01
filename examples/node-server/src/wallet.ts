/**
 * Reads the credit wallet with an sk_ key (a cron job, an ops script or an
 * admin endpoint of YOUR backend; never expose it to browsers).
 *
 * Since API 1.4.0 credit belongs to the organization, not to one app: the
 * balance is shared by every app of the organization, and the ledger shows the
 * wallet's credits plus only this app's debits.
 */
import type { OtpServerClient } from "@k-otp/sdk-server";

export type WalletSummary = {
  /** Credits left in the wallet (the whole organization's when shared). */
  balance: number;
  /** "organization" (shared) or "app" (legacy per-app wallet). */
  scope: "organization" | "app";
  walletId?: string;
  /** Debits of THIS app among the latest ledger entries. */
  recentAppDebits: number;
};

export const readWallet = async (
  otp: OtpServerClient,
): Promise<WalletSummary> => {
  const wallet = await otp.getBalance();
  const ledger = await otp.listCreditLedger({ limit: 20, entryType: "debit" });
  return {
    balance: wallet.balance,
    // An API older than 1.4.0 omits walletScope: the balance is then the app's own.
    scope: wallet.walletScope ?? "app",
    walletId: wallet.walletId,
    recentAppDebits: ledger.items.length,
  };
};

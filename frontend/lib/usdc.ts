import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";

export async function getSplBalance(
  connection: Connection,
  walletPublicKey: PublicKey,
  mintAddress: string,
): Promise<number> {
  const mint = new PublicKey(mintAddress);
  const ata = await getAssociatedTokenAddress(mint, walletPublicKey);
  try {
    const bal = await connection.getTokenAccountBalance(ata);
    return bal.value.uiAmount ?? 0;
  } catch {
    return 0;
  }
}

export async function getUsdcBalance(
  connection: Connection,
  walletPublicKey: PublicKey,
): Promise<number> {
  const mintStr = process.env.NEXT_PUBLIC_USDC_MINT;
  if (!mintStr) return 0;
  return getSplBalance(connection, walletPublicKey, mintStr);
}

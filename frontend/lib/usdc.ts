import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";

export async function getUsdcBalance(
  connection: Connection,
  walletPublicKey: PublicKey,
): Promise<number> {
  const mintStr = process.env.NEXT_PUBLIC_USDC_MINT;
  if (!mintStr) return 0;
  const usdcMint = new PublicKey(mintStr);
  const ata = await getAssociatedTokenAddress(usdcMint, walletPublicKey);
  try {
    const bal = await connection.getTokenAccountBalance(ata);
    return bal.value.uiAmount ?? 0;
  } catch {
    return 0;
  }
}

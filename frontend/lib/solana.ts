import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  Connection,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import type { WalletContextState } from "@solana/wallet-adapter-react";

export async function sendUsdcPayment({
  connection,
  senderPublicKey,
  amountUsdc,
  memo,
  sendTransaction,
}: {
  connection: Connection;
  senderPublicKey: PublicKey;
  amountUsdc: number;
  memo: string;
  sendTransaction: WalletContextState["sendTransaction"];
}): Promise<string> {
  const mintStr = process.env.NEXT_PUBLIC_USDC_MINT;
  const treasuryStr = process.env.NEXT_PUBLIC_SOLANA_TREASURY;
  if (!mintStr || !treasuryStr) {
    throw new Error("Missing NEXT_PUBLIC_USDC_MINT or NEXT_PUBLIC_SOLANA_TREASURY");
  }

  const usdcMint = new PublicKey(mintStr);
  const treasury = new PublicKey(treasuryStr);
  const senderAta = await getAssociatedTokenAddress(usdcMint, senderPublicKey);
  const treasuryAta = await getAssociatedTokenAddress(usdcMint, treasury);

  const smallestUnitAmount = Math.round(amountUsdc * 1_000_000);
  const tx = new Transaction();
  const treasuryAtaInfo = await connection.getAccountInfo(treasuryAta);
  if (!treasuryAtaInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        senderPublicKey,
        treasuryAta,
        treasury,
        usdcMint,
      ),
    );
  }
  tx.add(
    createTransferCheckedInstruction(
      senderAta,
      usdcMint,
      treasuryAta,
      senderPublicKey,
      smallestUnitAmount,
      6,
    ),
    new TransactionInstruction({
      keys: [],
      programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
      data: Buffer.from(memo),
    }),
  );

  tx.feePayer = senderPublicKey;
  const latest = await connection.getLatestBlockhash("finalized");
  tx.recentBlockhash = latest.blockhash;

  const signature = await sendTransaction(tx, connection);
  await connection.confirmTransaction(signature, "finalized");
  return signature;
}

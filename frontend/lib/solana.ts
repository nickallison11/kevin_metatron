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

const SPL_DECIMALS_DEFAULT = 6;

export async function sendSplPayment({
  connection,
  senderPublicKey,
  amountUsdc,
  memo,
  sendTransaction,
  mintAddress,
  decimals = SPL_DECIMALS_DEFAULT,
}: {
  connection: Connection;
  senderPublicKey: PublicKey;
  amountUsdc: number;
  memo: string;
  sendTransaction: WalletContextState["sendTransaction"];
  mintAddress: string;
  decimals?: number;
}): Promise<string> {
  const treasuryStr = process.env.NEXT_PUBLIC_SOLANA_TREASURY;
  if (!treasuryStr) {
    throw new Error("Missing NEXT_PUBLIC_SOLANA_TREASURY");
  }

  const mint = new PublicKey(mintAddress);
  const treasury = new PublicKey(treasuryStr);
  const senderAta = await getAssociatedTokenAddress(mint, senderPublicKey);
  const treasuryAta = await getAssociatedTokenAddress(mint, treasury);

  const factor = 10 ** decimals;
  const smallestUnitAmount = Math.round(amountUsdc * factor);
  const tx = new Transaction();
  const treasuryAtaInfo = await connection.getAccountInfo(treasuryAta);
  if (!treasuryAtaInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        senderPublicKey,
        treasuryAta,
        treasury,
        mint,
      ),
    );
  }
  tx.add(
    createTransferCheckedInstruction(
      senderAta,
      mint,
      treasuryAta,
      senderPublicKey,
      smallestUnitAmount,
      decimals,
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

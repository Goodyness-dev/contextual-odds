import * as fs from 'fs';
import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import axios from 'axios';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { ACTIVE_NETWORK, NETWORK_CONFIG, SIGNAL_CONFIG } from './signal-config';
import { logger } from '../lib/logger';

export interface TxLineCredentials {
  jwt: string;
  apiToken: string;
}

// Global cached credentials
let cachedCredentials: TxLineCredentials | null = null;
let tokenExpiryTime: number = 0;

/**
 * Ensures a devnet wallet exists at the configured path, generates one if it doesn't,
 * and requests an airdrop if the balance is too low.
 */
export async function loadOrCreateWallet(): Promise<Keypair> {
  let keypair: Keypair;
  
  if (process.env.SOLANA_WALLET_PRIVATE_KEY) {
    keypair = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_WALLET_PRIVATE_KEY));
    logger.info({ pubkey: keypair.publicKey.toBase58() }, 'Loaded Solana wallet from ENV');
  } else if (fs.existsSync(SIGNAL_CONFIG.walletPath)) {
    const secretKeyData = JSON.parse(fs.readFileSync(SIGNAL_CONFIG.walletPath, 'utf8'));
    keypair = Keypair.fromSecretKey(Uint8Array.from(secretKeyData));
    logger.info({ pubkey: keypair.publicKey.toBase58() }, 'Loaded existing Solana wallet from file');
  } else {
    keypair = Keypair.generate();
    fs.writeFileSync(SIGNAL_CONFIG.walletPath, JSON.stringify(Array.from(keypair.secretKey)));
    logger.info({ pubkey: keypair.publicKey.toBase58() }, 'Generated new Solana wallet');
  }

  // If on devnet, ensure we have some SOL for transaction fees
  if (ACTIVE_NETWORK === 'devnet') {
    try {
      const connection = new Connection(NETWORK_CONFIG.rpcUrl, 'confirmed');
      const balance = await connection.getBalance(keypair.publicKey);
      if (balance < 0.05 * LAMPORTS_PER_SOL) {
        logger.info('Wallet balance low. Requesting devnet airdrop...');
        const sig = await connection.requestAirdrop(keypair.publicKey, 1 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig, 'confirmed');
        logger.info('Airdrop successful');
      }
    } catch (err) {
      logger.warn('Solana Devnet RPC failed to fetch balance or airdrop. Continuing anyway...');
    }
  }

  return keypair;
}

/**
 * Executes the 4-step TxLINE authentication flow to get active API credentials.
 */
export async function authenticateTxLine(): Promise<TxLineCredentials> {
  if (cachedCredentials && Date.now() < tokenExpiryTime) {
    return cachedCredentials;
  }

  logger.info('Starting TxLINE authentication flow...');
  const wallet = await loadOrCreateWallet();
  const connection = new Connection(NETWORK_CONFIG.rpcUrl, 'confirmed');
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(wallet), {
    commitment: 'confirmed',
  });
  anchor.setProvider(provider);

  // 1. Get Guest JWT
  logger.info('Step 1: Requesting guest JWT');
  const authResponse = await axios.post(`${NETWORK_CONFIG.apiOrigin}/auth/guest/start`);
  const jwt = authResponse.data.token;

  // 2. Subscribe On-Chain
  logger.info('Step 2: Subscribing on-chain');
  let txSig: string;
  try {
    const idl = await anchor.Program.fetchIdl(NETWORK_CONFIG.programId, provider);
    if (!idl) throw new Error('Could not fetch IDL for TxLINE program');
    const program = new anchor.Program(idl, provider);

    const [tokenTreasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('token_treasury_v2')],
      program.programId
    );

    const tokenTreasuryVault = getAssociatedTokenAddressSync(
      NETWORK_CONFIG.txlTokenMint,
      tokenTreasuryPda,
      true,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const [pricingMatrixPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('pricing_matrix')],
      program.programId
    );

    const userTokenAccount = getAssociatedTokenAddressSync(
      NETWORK_CONFIG.txlTokenMint,
      wallet.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const durationWeeks = 4;
    
    // Check if we need to create the Associated Token Account first
    const ataInfo = await connection.getAccountInfo(userTokenAccount);
    if (!ataInfo) {
      logger.info('Creating Associated Token Account for TxL Token...');
      const { createAssociatedTokenAccountInstruction } = require('@solana/spl-token');
      const createAtaIx = createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        userTokenAccount,
        wallet.publicKey,
        NETWORK_CONFIG.txlTokenMint,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      const tx = new anchor.web3.Transaction().add(createAtaIx);
      await provider.sendAndConfirm(tx);
      logger.info('ATA created successfully.');
    }
    
    // We only call the subscribe method. The TxLINE program handles the rest.
    txSig = await (program.methods as any)
      .subscribe(NETWORK_CONFIG.serviceLevelId, durationWeeks)
      .accounts({
        user: wallet.publicKey,
        pricingMatrix: pricingMatrixPda,
        tokenMint: NETWORK_CONFIG.txlTokenMint,
        userTokenAccount,
        tokenTreasuryVault,
        tokenTreasuryPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
      
    logger.info({ txSig }, 'On-chain subscription successful');
  } catch (err: any) {
    // If it fails because we're already subscribed, we might just need to pull a recent txSig.
    // For simplicity in the hackathon, we'll log the error and try to proceed if we have a way,
    // but typically a fresh devnet wallet will succeed.
    logger.error({ err: err.message }, 'Failed to subscribe on-chain');
    throw err;
  }

  // 3. Sign Activation Message
  logger.info('Step 3: Signing activation message');
  const selectedLeagues: number[] = [];
  const messageString = `${txSig}:${selectedLeagues.join(',')}:${jwt}`;
  const messageBytes = new TextEncoder().encode(messageString);
  const signatureBytes = (nacl.sign as any).detached(messageBytes, wallet.secretKey);
  const walletSignature = Buffer.from(signatureBytes).toString('base64');

  // 4. Activate API Token
  logger.info('Step 4: Activating API Token');
  const activationResponse = await axios.post(
    `${NETWORK_CONFIG.apiOrigin}/api/token/activate`,
    {
      txSig,
      walletSignature,
      leagues: selectedLeagues,
    },
    { headers: { Authorization: `Bearer ${jwt}` } }
  );

  const apiToken = activationResponse.data.token || activationResponse.data;
  
  cachedCredentials = { jwt, apiToken };
  // Set expiry to 23 hours from now (assuming 24h JWT lifetime)
  tokenExpiryTime = Date.now() + 23 * 60 * 60 * 1000;
  
  logger.info('TxLINE authentication successful');
  return cachedCredentials;
}

export async function getAuthHeaders(): Promise<{ Authorization: string; 'X-Api-Token': string }> {
  const creds = await authenticateTxLine();
  return {
    Authorization: `Bearer ${creds.jwt}`,
    'X-Api-Token': creds.apiToken,
  };
}

export function clearAuthCache() {
  cachedCredentials = null;
  tokenExpiryTime = 0;
}

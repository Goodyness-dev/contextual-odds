import { z } from 'zod';
import { config } from '../config';
import { PublicKey } from '@solana/web3.js';
import * as path from 'path';

// Define the core constants for the Signal Agent based on the chosen network

export const SIGNAL_CONSTANTS = {
  mainnet: {
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    apiOrigin: 'https://txline.txodds.com',
    programId: new PublicKey('9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA'),
    txlTokenMint: new PublicKey('Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL'),
    serviceLevelId: 12, // Real-time World Cup tier
  },
  devnet: {
    rpcUrl: 'https://api.devnet.solana.com',
    apiOrigin: 'https://txline-dev.txodds.com',
    programId: new PublicKey('6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J'),
    txlTokenMint: new PublicKey('4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG'),
    serviceLevelId: 1, // Devnet World Cup tier
  },
} as const;

export const ACTIVE_NETWORK = config.TXLINE_NETWORK;
export const NETWORK_CONFIG = SIGNAL_CONSTANTS[ACTIVE_NETWORK];

export const SIGNAL_CONFIG = {
  walletPath: path.resolve(process.cwd(), config.SOLANA_WALLET_PATH),
  threshold: config.SIGNAL_THRESHOLD, // e.g. 0.05 means 5% divergence required
  enabled: true, // Force enabled for the hackathon live demo
  pollIntervalMs: 60000, // Check for updates every 60s
  paperTradeStake: 100, // 100 units virtual stake per signal
  worldCupCompetitionId: 72, // 72 is the actual TxLINE World Cup ID
};

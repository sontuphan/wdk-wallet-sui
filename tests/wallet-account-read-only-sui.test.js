import { afterEach, beforeAll, beforeEach, describe, expect, test } from '@jest/globals'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { toSerializedSignature } from '@mysten/sui/cryptography'

import WalletAccountReadOnlySui from '../src/wallet-account-read-only-sui.js'

const TEST_ADDRESS = '0xac5bceec1b789ff840d7d4e6ce4ce61c90d190a7f8c4f4ddf0bff6ee2413c33c'
const TEST_RPC_URL = 'https://fullnode.mainnet.sui.io:443'
const TEST_NETWORK = 'mainnet'

describe('WalletAccountReadOnlySui', () => {
  let readOnlyAccount

  beforeEach(() => {
    readOnlyAccount = new WalletAccountReadOnlySui(TEST_ADDRESS, {
      rpcUrl: TEST_RPC_URL,
      network: TEST_NETWORK
    })
  })

  afterEach(() => {
    readOnlyAccount = undefined
  })

  describe('Constructor', () => {
    test('should create instance with valid config', () => {
      const account = new WalletAccountReadOnlySui(TEST_ADDRESS, {
        rpcUrl: TEST_RPC_URL,
        network: TEST_NETWORK
      })

      expect(account).toBeInstanceOf(WalletAccountReadOnlySui)
      expect(account._client).toBeDefined()
      expect(account._config.network).toBe(TEST_NETWORK)
    })
  })

  describe('getBalance', () => {
    test('should return SUI balance in MISTs', async () => {
      const balance = await readOnlyAccount.getBalance()

      expect(typeof balance).toBe('bigint')
      expect(balance > 0n).toBe(true)
    })

    test('should return zero balance for empty account', async () => {
      const emptyAddress = new Ed25519Keypair().toSuiAddress();
      const emptyAccount = new WalletAccountReadOnlySui(emptyAddress, {
        rpcUrl: TEST_RPC_URL,
        network: TEST_NETWORK
      })

      const balance = await emptyAccount.getBalance()

      expect(balance).toBe(0n)
    })

    test('should throw error when not connected to provider', async () => {
      const disconnectedAccount = new WalletAccountReadOnlySui(TEST_ADDRESS, {})

      await expect(disconnectedAccount.getBalance()).rejects.toThrow(
        'The wallet must be connected to a provider to retrieve balances.'
      )
    })
  })

  describe('getTokenBalance', () => {
    const USDT = '0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT'

    test('should return token balance (USDT)', async () => {
      const balance = await readOnlyAccount.getTokenBalance(USDT)

      expect(typeof balance).toBe('bigint')
      expect(balance > 0n).toBe(true)
    })

    test('should throw error when not connected to provider', async () => {
      const disconnectedAccount = new WalletAccountReadOnlySui(TEST_ADDRESS, {})

      await expect(
        disconnectedAccount.getTokenBalance(USDT)
      ).rejects.toThrow(
        'The wallet must be connected to a provider to retrieve token balances.'
      )
    })

    test('should throw error for invalid token mint address', async () => {
      const invalidMint = 'invalid-mint-address'

      await expect(
        readOnlyAccount.getTokenBalance(invalidMint)
      ).rejects.toThrow()
    })
  })

  describe('quoteSendTransaction', () => {
    const RECIPIENT = new Ed25519Keypair().toSuiAddress();

    test('should successfully quote a transaction', async () => {
      const TRANSFER = {
        to: RECIPIENT,
        value: 1_000
      }

      const { fee } = await readOnlyAccount.quoteSendTransaction(TRANSFER)

      expect(typeof fee).toBe('bigint')
    })
  })

  describe('quoteTransfer', () => {
    const USDT = '0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT'
    const RECIPIENT = new Ed25519Keypair().toSuiAddress();

    test('should successfully quote a transfer operation', async () => {
      const TRANSFER = {
        token: USDT,
        recipient: RECIPIENT,
        amount: 100
      }

      const { fee } = await readOnlyAccount.quoteTransfer(TRANSFER)

      expect(typeof fee).toBe('bigint')
    })
  })

  describe('verify', () => {
    const MESSAGE = 'Dummy message to sign.'
    const SIGNER = new Ed25519Keypair();

    const account = new WalletAccountReadOnlySui(SIGNER.toSuiAddress(), {
      rpcUrl: TEST_RPC_URL,
      network: TEST_NETWORK
    })
    let SIGNATURE

    beforeAll(async () => {
      const signature = await SIGNER.sign(new TextEncoder().encode(MESSAGE))
      SIGNATURE = toSerializedSignature({ signature, signatureScheme: 'ED25519', publicKey: SIGNER.getPublicKey() })
    })

    test('should return true for a valid signature', async () => {
      const result = await account.verify(MESSAGE, SIGNATURE)

      expect(result).toBe(true)
    })

    test('should return false for an invalid signature', async () => {
      const result = await account.verify('Another message.', SIGNATURE)

      expect(result).toBe(false)
    })

    test('should throw on a malformed signature', async () => {
      await expect(account.verify(MESSAGE, 'A bad signature'))
        .rejects.toThrow('The string to be decoded is not correctly encoded.')
    })
  })

  describe('verifyPersonalMessage', () => {
    const ADDRESS = '0x4811486fe962452e3106e2991b88201703e08c4ee3772d120e941ee057cb3496'
    const MESSAGE = 'Dummy message to sign.'
    const SIGNATURE = 'AGTWDFMnLBFQTvjXuJmqiYYvdFbJ0BTdrEkCJbNwrDBquMtSI8mWr6jNbcZcIl6BkTRnNPq+popoP4nWAHPanADHRhAvruMzcoHScq6xLL6y8nBkVxiVOdkFSqn8oK9KoA=='

    const account = new WalletAccountReadOnlySui(ADDRESS, {
      rpcUrl: TEST_RPC_URL,
      network: TEST_NETWORK
    })

    test('should return true for a valid signature', async () => {
      const result = await account.verifyPersonalMessage(MESSAGE, SIGNATURE)

      expect(result).toBe(true)
    })

    test('should return false for an invalid signature', async () => {
      const INCORRECT_MESSAGE = 'Incorrect message.'
      const result = await account.verifyPersonalMessage(INCORRECT_MESSAGE, SIGNATURE)

      expect(result).toBe(false)
    })

    test('should throw on a malformed signature', async () => {
      await expect(account.verifyPersonalMessage(MESSAGE, 'A bad signature'))
        .rejects.toThrow('The string to be decoded is not correctly encoded.')
    })
  })
})
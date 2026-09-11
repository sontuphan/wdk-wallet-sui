import { afterEach, beforeAll, beforeEach, describe, expect, test } from '@jest/globals'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { toSerializedSignature } from '@mysten/sui/cryptography'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { NoSuchElementError, ProviderRequiredError, TransactionError, TransactionErrorReason, TransferError, TransferErrorReason, ValueError } from '@tetherto/wdk-wallet'

import WalletAccountReadOnlySui from '../../src/wallet-account-read-only-sui.js'

const TEST_ADDRESS = '0xac5bceec1b789ff840d7d4e6ce4ce61c90d190a7f8c4f4ddf0bff6ee2413c33c'
const TEST_RPC_URL = 'https://fullnode.mainnet.sui.io:443'
const TEST_NETWORK = 'mainnet'

describe('@tetherto/wdk-wallet-sui', () => {
  let readOnlyAccount

  // The digest of a transaction that is already part of a checkpoint. It is read
  // from the chain rather than hardcoded, so the tests don't depend on the node's
  // pruning window.
  let DIGEST

  beforeAll(async () => {
    const client = new SuiGrpcClient({ network: TEST_NETWORK, baseUrl: TEST_RPC_URL })

    const { response } = await client.ledgerService.getCheckpoint({
      checkpointId: { oneofKind: undefined },
      readMask: { paths: ['sequence_number', 'transactions.digest'] }
    })

    DIGEST = response.checkpoint.transactions[0].digest
  }, 20_000)

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

      await expect(disconnectedAccount.getBalance()).rejects.toThrow(ProviderRequiredError)
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

      await expect(disconnectedAccount.getTokenBalance(USDT)).rejects.toThrow(ProviderRequiredError)
      await expect(disconnectedAccount.getTokenBalance(USDT)).rejects.toThrow(
        'The wallet must be connected to a provider to retrieve token balances.'
      )
    })

    test('should throw a value error for an invalid token mint address', async () => {
      const invalidMint = 'invalid-mint-address'

      await expect(
        readOnlyAccount.getTokenBalance(invalidMint)
      ).rejects.toThrow(ValueError)
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

    test('should throw a transaction error when the account cannot cover the amount', async () => {
      const TRANSFER = {
        to: RECIPIENT,
        value: 10n ** 18n
      }

      await expect(readOnlyAccount.quoteSendTransaction(TRANSFER))
        .rejects.toMatchObject({
          name: 'TransactionError',
          reason: TransactionErrorReason.INSUFFICIENT_BALANCE
        })
    })

    test('should throw a transaction error when the account holds no sui at all', async () => {
      const emptyAccount = new WalletAccountReadOnlySui(new Ed25519Keypair().toSuiAddress(), {
        rpcUrl: TEST_RPC_URL,
        network: TEST_NETWORK
      })

      await expect(emptyAccount.quoteSendTransaction({ to: RECIPIENT, value: 1_000 }))
        .rejects.toThrow(TransactionError)
    })

    test('should throw a value error for a malformed recipient', async () => {
      await expect(readOnlyAccount.quoteSendTransaction({ to: 'not-an-address', value: 1_000 }))
        .rejects.toThrow(ValueError)
    })

    test('should throw error when not connected to a provider', async () => {
      const disconnectedAccount = new WalletAccountReadOnlySui(TEST_ADDRESS, {})

      await expect(disconnectedAccount.quoteSendTransaction({ to: RECIPIENT, value: 1_000 }))
        .rejects.toThrow(ProviderRequiredError)
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

    test('should throw a transfer error when the account cannot cover the amount', async () => {
      const TRANSFER = {
        token: USDT,
        recipient: RECIPIENT,
        amount: 10n ** 15n
      }

      await expect(readOnlyAccount.quoteTransfer(TRANSFER))
        .rejects.toMatchObject({
          name: 'TransferError',
          reason: TransferErrorReason.INSUFFICIENT_TOKEN_BALANCE
        })
    })

    test('should throw a value error for a malformed token', async () => {
      await expect(readOnlyAccount.quoteTransfer({ token: 'not-a-type', recipient: RECIPIENT, amount: 1 }))
        .rejects.toThrow(ValueError)
    })

    test('should throw error when not connected to a provider', async () => {
      const disconnectedAccount = new WalletAccountReadOnlySui(TEST_ADDRESS, {})

      await expect(disconnectedAccount.quoteTransfer({ token: USDT, recipient: RECIPIENT, amount: 1 }))
        .rejects.toThrow(ProviderRequiredError)
    })
  })

  describe('getTransaction', () => {
    const UNKNOWN_DIGEST = '11111111111111111111111111111111'

    test('should return a normalized receipt for a checkpointed transaction', async () => {
      const receipt = await readOnlyAccount.getTransaction(DIGEST)

      expect(receipt.hash).toBe(DIGEST)
      expect(receipt.finality).toBe('final')
      expect(typeof receipt.success).toBe('boolean')
      expect(typeof receipt.block).toBe('number')
      expect(typeof receipt.fee).toBe('bigint')
      expect(typeof receipt.checkpoint).toBe('bigint')
      expect(receipt.block).toBe(Number(receipt.checkpoint))
      expect(typeof receipt.timestamp).toBe('number')
    })

    test('should expose the native receipt', async () => {
      const { receipt } = await readOnlyAccount.getTransaction(DIGEST)

      expect(receipt.digest).toBe(DIGEST)
      expect(receipt.effects.status).toBeDefined()
    })

    test('should throw a no such element error for an unknown digest', async () => {
      await expect(readOnlyAccount.getTransaction(UNKNOWN_DIGEST))
        .rejects.toThrow(NoSuchElementError)
    })

    test('should throw a value error for a malformed digest', async () => {
      await expect(readOnlyAccount.getTransaction('not-a-digest'))
        .rejects.toThrow(ValueError)
    })

    test('should throw error when not connected to a provider', async () => {
      const disconnectedAccount = new WalletAccountReadOnlySui(TEST_ADDRESS, {})

      await expect(disconnectedAccount.getTransaction(DIGEST))
        .rejects.toThrow(ProviderRequiredError)
    })

    test('should let waitForTransaction resolve on an executed transaction', async () => {
      const receipt = await readOnlyAccount.waitForTransaction(DIGEST, { target: 'final' })

      expect(receipt.finality).toBe('final')
    })
  })

  describe('getTransactionReceipt', () => {
    test('should return the native receipt', async () => {
      const receipt = await readOnlyAccount.getTransactionReceipt(DIGEST)

      expect(receipt.digest).toBe(DIGEST)
      expect(receipt.effects).toBeDefined()
      expect(receipt.checkpoint).toBeDefined()
    })

    test('should return null for an unknown digest', async () => {
      const receipt = await readOnlyAccount.getTransactionReceipt('11111111111111111111111111111111')

      expect(receipt).toBeNull()
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

    test('should throw a value error on a malformed signature', async () => {
      await expect(account.verify(MESSAGE, 'A bad signature'))
        .rejects.toThrow(ValueError)
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

    test('should throw a value error on a malformed signature', async () => {
      await expect(account.verifyPersonalMessage(MESSAGE, 'A bad signature'))
        .rejects.toThrow(ValueError)
      await expect(account.verifyPersonalMessage(MESSAGE, 'A bad signature'))
        .rejects.toThrow('The string to be decoded is not correctly encoded.')
    })
  })
})
import { describe, expect, jest, test } from '@jest/globals'

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { toSerializedSignature } from '@mysten/sui/cryptography'
import { Transaction } from '@mysten/sui/transactions'

import WalletAccountReadOnlySui from '../src/wallet-account-read-only-sui.js'
import {
  NoSuchElementError,
  ProviderError,
  ProviderErrorReason,
  ProviderRequiredError,
  TransactionError,
  TransactionErrorReason,
  TransferError,
  TransferErrorReason,
  TimeoutError,
  ValueError
} from '@tetherto/wdk-wallet'

const ADDRESS = '0xac5bceec1b789ff840d7d4e6ce4ce61c90d190a7f8c4f4ddf0bff6ee2413c33c'
const RECIPIENT = '0x4811486fe962452e3106e2991b88201703e08c4ee3772d120e941ee057cb3496'
const TOKEN = '0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT'
const DIGEST = '4b114JubGjmLDosn5AHQCJPEsnKGxEAqXAy9tNfeEF5V'

const DUMMY_BALANCE = 4_770_665_516_979n
const DUMMY_TOKEN_BALANCE = 482n
const DUMMY_CHECKPOINT = 321_220_176n
const DUMMY_TIMESTAMP = { seconds: 1_789_098_078n, nanos: 740_000_000 }

// Fee constants implied by the mocked gas summary below:
// fee = computationCost + storageCost - storageRebate = 100_000 + 4_780_400 - 4_732_596.
const DUMMY_GAS_USED = {
  computationCost: 100_000n,
  storageCost: 4_780_400n,
  storageRebate: 4_732_596n,
  nonRefundableStorageFee: 47_804n
}
const MOCKED_FEE = 147_804n

/**
 * The repeated fields of a transaction's effects. The sdk walks them while
 * parsing a response, so they are always part of one.
 */
const EMPTY_EFFECTS = {
  dependencies: [],
  changedObjects: [],
  unchangedConsensusObjects: [],
  unchangedLoadedRuntimeObjects: []
}

const DUMMY_GAS_COIN = {
  objectId: '0x0466a9a57add505b7b85ac485054f9b71f574f4504d9c70acd8f73ef11e0dc30',
  version: 954_274_396n,
  digest: 'ECoiTzmhn29C7ruyPD69C4smexiC7bMdhbUTHcqbCpHF'
}

const DUMMY_TOKEN_COIN = {
  objectId: '0x33e9894a79b5662af29cfcecca812c52844d3ace8f1054c065ac92e9e6274ec7',
  version: 575_995_264n,
  digest: 'TTJ2GCTqeB4fzNu79XUC4wHSfrEs4xofvamSCHChy8b',
  owner: { kind: 1, address: ADDRESS },
  objectType: `0x0000000000000000000000000000000000000000000000000000000000000002::coin::Coin<${TOKEN}>`,
  balance: DUMMY_TOKEN_BALANCE
}

/**
 * A grpc error, as the transport reports the status returned by a node: the
 * code is the name of the grpc status and the message is percent-encoded.
 */
function grpcError (code, message) {
  return Object.assign(new Error(encodeURIComponent(message)), { code })
}

function createTransport (overrides = {}) {
  const handlers = {
    GetBalance: ({ coinType }) => ({
      balance: {
        coinType,
        balance: coinType.endsWith('::sui::SUI') ? DUMMY_BALANCE : DUMMY_TOKEN_BALANCE,
        coinBalance: coinType.endsWith('::sui::SUI') ? DUMMY_BALANCE : DUMMY_TOKEN_BALANCE
      }
    }),
    ListOwnedObjects: () => ({ objects: [DUMMY_TOKEN_COIN] }),
    // The node resolves a transaction by running it: the first pass picks the
    // gas coins, the second one is the quote itself and reports the gas used.
    SimulateTransaction: (input) => input.doGasSelection
      ? {
          transaction: {
            transaction: {
              ...input.transaction,
              gasPayment: { objects: [DUMMY_GAS_COIN], owner: ADDRESS, price: 100n, budget: 1_188_000n }
            },
            effects: { ...EMPTY_EFFECTS, status: { success: true } }
          }
        }
      : {
          transaction: {
            digest: DIGEST,
            effects: { ...EMPTY_EFFECTS, status: { success: true }, gasUsed: DUMMY_GAS_USED }
          }
        },
    GetTransaction: ({ digest }) => ({
      transaction: {
        digest,
        effects: { ...EMPTY_EFFECTS, status: { success: true }, gasUsed: DUMMY_GAS_USED },
        checkpoint: DUMMY_CHECKPOINT,
        timestamp: DUMMY_TIMESTAMP
      }
    }),
    ...overrides
  }

  return {
    mergeOptions: (options) => options ?? {},
    unary: jest.fn(async (method, input) => {
      const handler = handlers[method.name]
      if (!handler) throw new Error(`Unexpected grpc method: ${method.name}`)
      return { response: await handler(input) }
    })
  }
}

function createAccount (overrides = {}) {
  return new WalletAccountReadOnlySui(ADDRESS, { transport: createTransport(overrides), network: 'mainnet' })
}

describe('WalletAccountReadOnlySui', () => {
  const account = createAccount()

  describe('Constructor', () => {
    test('should create an instance connected to the given transport', () => {
      expect(account).toBeInstanceOf(WalletAccountReadOnlySui)
      expect(account._client).toBeDefined()
      expect(account._config.network).toBe('mainnet')
    })

    test('should not create a client without a provider', () => {
      const disconnectedAccount = new WalletAccountReadOnlySui(ADDRESS, {})

      expect(disconnectedAccount._client).toBeUndefined()
    })
  })

  describe('address', () => {
    test('should return the correct address', () => {
      expect(account.address).toBe(ADDRESS)
    })
  })

  describe('failover', () => {
    function createFailingTransport () {
      return {
        mergeOptions: (options) => options ?? { },
        unary: jest.fn(async () => { throw grpcError('UNAVAILABLE', 'node is down') })
      }
    }

    test('should answer from the next provider when one fails', async () => {
      const failing = createFailingTransport()
      const working = createTransport()

      const account = new WalletAccountReadOnlySui(ADDRESS, { transport: [failing, working] })

      expect(await account.getBalance()).toBe(DUMMY_BALANCE)
      expect(failing.unary).toHaveBeenCalledTimes(1)
      expect(working.unary).toHaveBeenCalledTimes(1)
    })

    test('should fail over the calls the sdk makes through its own service clients', async () => {
      const failing = createFailingTransport()
      const working = createTransport()

      const account = new WalletAccountReadOnlySui(ADDRESS, { transport: [failing, working] })

      const receipt = await account.getTransaction(DIGEST)

      expect(receipt.finality).toBe('final')
      expect(failing.unary).toHaveBeenCalledTimes(1)
      expect(working.unary).toHaveBeenCalledTimes(1)
    })

    test('should give up once the retries are exhausted', async () => {
      const first = createFailingTransport()
      const second = createFailingTransport()

      const account = new WalletAccountReadOnlySui(ADDRESS, { transport: [first, second], retries: 0 })

      await expect(account.getBalance()).rejects.toThrow(ProviderError)

      expect(first.unary).toHaveBeenCalledTimes(1)
      expect(second.unary).not.toHaveBeenCalled()
    })

    test('should report the failure of the last provider it tried', async () => {
      const account = new WalletAccountReadOnlySui(ADDRESS, {
        transport: [createFailingTransport(), createFailingTransport()]
      })

      const promise = account.getBalance()

      await expect(promise).rejects.toThrow(ProviderError)
      await expect(promise).rejects.toThrow('node is down')
    })

    test('should send every call to a single provider', async () => {
      const transport = createTransport()

      const account = new WalletAccountReadOnlySui(ADDRESS, { transport: [transport] })

      await account.getBalance()

      expect(transport.unary).toHaveBeenCalledTimes(1)
    })

    test.each([
      ['an empty list of urls', { rpcUrl: [] }],
      ['an empty list of transports', { transport: [] }]
    ])('should not connect to a provider for %s', (_, config) => {
      expect(new WalletAccountReadOnlySui(ADDRESS, config)._client).toBeUndefined()
    })
  })

  describe('getBalance', () => {
    test('should return the sui balance in mists', async () => {
      const balance = await account.getBalance()

      expect(balance).toBe(DUMMY_BALANCE)
    })

    test('should return a zero balance for an empty account', async () => {
      const account = createAccount({ GetBalance: ({ coinType }) => ({ balance: { coinType, balance: 0n } }) })

      const balance = await account.getBalance()

      expect(balance).toBe(0n)
    })

    test('should throw if the account is not connected to a provider', async () => {
      const account = new WalletAccountReadOnlySui(ADDRESS)

      const promise = account.getBalance()

      await expect(promise).rejects.toThrow(ProviderRequiredError)
      await expect(promise).rejects.toThrow('The wallet must be connected to a provider to retrieve balances.')
    })

    test('should throw a provider error if the node fails to answer', async () => {
      const account = createAccount({
        GetBalance: () => { throw grpcError('UNAVAILABLE', 'node is down') }
      })

      const promise = account.getBalance()

      await expect(promise).rejects.toThrow(ProviderError)
      await expect(promise).rejects.toThrow('node is down')
      await expect(promise).rejects.toMatchObject({ reason: ProviderErrorReason.NETWORK_ERROR })
    })
  })

  describe('getTokenBalance', () => {
    test('should return the token balance in base units', async () => {
      const balance = await account.getTokenBalance(TOKEN)

      expect(balance).toBe(DUMMY_TOKEN_BALANCE)
    })

    test('should request the balance of the given coin type', async () => {
      const transport = createTransport()
      const account = new WalletAccountReadOnlySui(ADDRESS, { transport })

      await account.getTokenBalance(TOKEN)

      expect(transport.unary).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'GetBalance' }),
        expect.objectContaining({ owner: ADDRESS, coinType: TOKEN }),
        expect.anything()
      )
    })

    test('should throw if the account is not connected to a provider', async () => {
      const account = new WalletAccountReadOnlySui(ADDRESS)

      const promise = account.getTokenBalance(TOKEN)

      await expect(promise).rejects.toThrow(ProviderRequiredError)
      await expect(promise).rejects.toThrow('The wallet must be connected to a provider to retrieve token balances.')
    })

    test('should throw a value error for an invalid coin type', async () => {
      const account = createAccount({
        GetBalance: () => { throw grpcError('INVALID_ARGUMENT', 'invalid coin_type: unable to parse type "nope"') }
      })

      const promise = account.getTokenBalance('nope')

      await expect(promise).rejects.toThrow(ValueError)
      await expect(promise).rejects.toThrow('invalid coin_type: unable to parse type "nope"')
    })
  })

  describe('quoteSendTransaction', () => {
    test('should quote a native transfer', async () => {
      const { fee } = await account.quoteSendTransaction({ to: RECIPIENT, value: 1_000 })

      expect(fee).toBe(MOCKED_FEE)
    })

    test('should quote a transaction built with the sdk', async () => {
      const tx = new Transaction()
      tx.setSender(ADDRESS)
      const [coin] = tx.splitCoins(tx.gas, [1_000])
      tx.transferObjects([coin], RECIPIENT)

      await expect(account.quoteSendTransaction(tx)).resolves.toEqual({ fee: MOCKED_FEE })
    })

    test('should quote a transaction built by another copy of the sdk', async () => {
      const tx = new Transaction()
      tx.setSender(ADDRESS)
      const [coin] = tx.splitCoins(tx.gas, [1_000])
      tx.transferObjects([coin], RECIPIENT)

      // A transaction from a second copy of the sdk carries the brand but is not
      // an instance of this copy's class, which is how npm installs it whenever
      // two packages ask for incompatible ranges.
      const foreign = {
        [Symbol.for('@mysten/transaction')]: true,
        getData: () => tx.getData(),
        setSenderIfNotSet: (sender) => tx.setSenderIfNotSet(sender),
        build: (options) => tx.build(options)
      }

      expect(foreign instanceof Transaction).toBe(false)

      await expect(account.quoteSendTransaction(foreign)).resolves.toEqual({ fee: MOCKED_FEE })
    })

    test('should throw if the account is not connected to a provider', async () => {
      const account = new WalletAccountReadOnlySui(ADDRESS)

      const promise = account.quoteSendTransaction({ to: RECIPIENT, value: 1_000 })

      await expect(promise).rejects.toThrow(ProviderRequiredError)
      await expect(promise).rejects.toThrow('The wallet must be connected to a provider to quote send transaction operations.')
    })

    test('should throw a value error for a malformed recipient', async () => {
      const promise = account.quoteSendTransaction({ to: 'not-an-address', value: 1_000 })

      await expect(promise).rejects.toThrow(ValueError)
      await expect(promise).rejects.toThrow('Invalid Sui address not-an-address')
    })

    test('should throw a transaction error when the account cannot cover the amount', async () => {
      const account = createAccount({
        SimulateTransaction: () => { throw new Error('Transaction resolution failed: InsufficientCoinBalance in command 0') }
      })

      const promise = account.quoteSendTransaction({ to: RECIPIENT, value: 1_000 })

      await expect(promise).rejects.toThrow(TransactionError)
      await expect(promise).rejects.toMatchObject({ reason: TransactionErrorReason.INSUFFICIENT_BALANCE })
    })

    test('should throw a transaction error when the account holds no gas coin', async () => {
      const account = createAccount({
        SimulateTransaction: () => {
          throw new Error('Unable to perform gas selection due to insufficient SUI balance for account')
        }
      })

      const promise = account.quoteSendTransaction({ to: RECIPIENT, value: 1_000 })

      await expect(promise).rejects.toThrow(TransactionError)
      await expect(promise).rejects.toMatchObject({ reason: TransactionErrorReason.INSUFFICIENT_BALANCE })
    })

    test('should throw a transaction error when the simulation reverts', async () => {
      const account = createAccount({
        SimulateTransaction: (input) => input.doGasSelection
          ? {
              transaction: {
                transaction: {
                  ...input.transaction,
                  gasPayment: { objects: [DUMMY_GAS_COIN], owner: ADDRESS, price: 100n, budget: 1_188_000n }
                },
                effects: { ...EMPTY_EFFECTS, status: { success: true } }
              }
            }
          : {
              transaction: {
                digest: DIGEST,
                effects: {
                  ...EMPTY_EFFECTS,
                  status: { success: false, error: { description: 'MoveAbort' } },
                  gasUsed: DUMMY_GAS_USED
                }
              }
            }
      })

      await expect(account.quoteSendTransaction({ to: RECIPIENT, value: 1_000 }))
        .rejects.toThrow(TransactionError)
    })

    test('should throw a provider error when the node reports no gas used', async () => {
      const account = createAccount({
        SimulateTransaction: (input) => input.doGasSelection
          ? {
              transaction: {
                transaction: {
                  ...input.transaction,
                  gasPayment: { objects: [DUMMY_GAS_COIN], owner: ADDRESS, price: 100n, budget: 1_188_000n }
                },
                effects: { ...EMPTY_EFFECTS, status: { success: true } }
              }
            }
          : {
              transaction: { digest: DIGEST, effects: { ...EMPTY_EFFECTS, status: { success: true } } }
            }
      })

      const promise = account.quoteSendTransaction({ to: RECIPIENT, value: 1_000 })

      await expect(promise).rejects.toThrow(ProviderError)
      await expect(promise).rejects.toThrow('The provider did not report the gas used by the transaction.')
      await expect(promise).rejects.toMatchObject({ reason: ProviderErrorReason.INTERNAL_SERVER_ERROR })
    })

    test('should throw a provider error if the node fails to answer', async () => {
      const account = createAccount({
        SimulateTransaction: () => { throw grpcError('DEADLINE_EXCEEDED', 'deadline exceeded') }
      })

      const promise = account.quoteSendTransaction({ to: RECIPIENT, value: 1_000 })

      await expect(promise).rejects.toThrow(ProviderError)
      await expect(promise).rejects.toMatchObject({ reason: ProviderErrorReason.REQUEST_TIMEOUT })
    })
  })

  describe('quoteTransfer', () => {
    test('should quote a token transfer', async () => {
      const { fee } = await account.quoteTransfer({ token: TOKEN, recipient: RECIPIENT, amount: 1 })

      expect(fee).toBe(MOCKED_FEE)
    })

    test('should throw if the account is not connected to a provider', async () => {
      const account = new WalletAccountReadOnlySui(ADDRESS)

      const promise = account.quoteTransfer({ token: TOKEN, recipient: RECIPIENT, amount: 1 })

      await expect(promise).rejects.toThrow(ProviderRequiredError)
      await expect(promise).rejects.toThrow('The wallet must be connected to a provider to quote transfer operations.')
    })

    test('should throw a value error for a malformed token', async () => {
      const promise = account.quoteTransfer({ token: 'not-a-type', recipient: RECIPIENT, amount: 1 })

      await expect(promise).rejects.toThrow(ValueError)
    })

    test('should throw a transfer error when the account holds too few tokens', async () => {
      const account = createAccount({ ListOwnedObjects: () => ({ objects: [] }) })

      const promise = account.quoteTransfer({ token: TOKEN, recipient: RECIPIENT, amount: 1_000 })

      await expect(promise).rejects.toThrow(TransferError)
      await expect(promise).rejects.toMatchObject({ reason: TransferErrorReason.INSUFFICIENT_TOKEN_BALANCE })
    })

    test('should throw a transfer error when the account cannot cover the gas', async () => {
      const account = createAccount({
        SimulateTransaction: () => { throw new Error('Transaction resolution failed: InsufficientCoinBalance in command 0') }
      })

      const promise = account.quoteTransfer({ token: TOKEN, recipient: RECIPIENT, amount: 1 })

      await expect(promise).rejects.toThrow(TransferError)
      await expect(promise).rejects.toMatchObject({ reason: TransferErrorReason.INSUFFICIENT_BALANCE })
    })
  })

  describe('getTransaction', () => {
    test('should return a normalized receipt for a checkpointed transaction', async () => {
      const receipt = await account.getTransaction(DIGEST)

      expect(receipt).toMatchObject({
        hash: DIGEST,
        finality: 'final',
        success: true,
        block: Number(DUMMY_CHECKPOINT),
        fee: MOCKED_FEE,
        checkpoint: DUMMY_CHECKPOINT,
        timestamp: 1_789_098_078_740
      })
      expect(receipt.receipt.digest).toBe(DIGEST)
    })

    test('should report a transaction that is not checkpointed yet as confirmed', async () => {
      const account = createAccount({
        GetTransaction: ({ digest }) => ({
          transaction: { digest, effects: { ...EMPTY_EFFECTS, status: { success: true }, gasUsed: DUMMY_GAS_USED } }
        })
      })

      const receipt = await account.getTransaction(DIGEST)

      expect(receipt.finality).toBe('confirmed')
      expect(receipt.block).toBeUndefined()
      expect(receipt.checkpoint).toBeUndefined()
      expect(receipt.timestamp).toBeUndefined()
    })

    test('should report a reverted transaction as unsuccessful', async () => {
      const account = createAccount({
        GetTransaction: ({ digest }) => ({
          transaction: {
            digest,
            effects: { ...EMPTY_EFFECTS, status: { success: false }, gasUsed: DUMMY_GAS_USED },
            checkpoint: DUMMY_CHECKPOINT
          }
        })
      })

      const receipt = await account.getTransaction(DIGEST)

      expect(receipt.success).toBe(false)
      expect(receipt.finality).toBe('final')
    })

    test('should read only the fields the receipt is built from', async () => {
      const transport = createTransport()
      const account = new WalletAccountReadOnlySui(ADDRESS, { transport })

      await account.getTransaction(DIGEST)

      expect(transport.unary).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'GetTransaction' }),
        {
          digest: DIGEST,
          readMask: { paths: ['digest', 'checkpoint', 'timestamp', 'effects.status', 'effects.gas_used'] }
        },
        expect.anything()
      )
    })

    test('should throw if the account is not connected to a provider', async () => {
      const account = new WalletAccountReadOnlySui(ADDRESS)

      const promise = account.getTransaction(DIGEST)

      await expect(promise).rejects.toThrow(ProviderRequiredError)
      await expect(promise).rejects.toThrow('The wallet must be connected to a provider to fetch transactions.')
    })

    test('should throw a value error for a malformed digest', async () => {
      const promise = account.getTransaction('not-a-digest')

      await expect(promise).rejects.toThrow(ValueError)
      await expect(promise).rejects.toThrow("'not-a-digest' is not a valid transaction digest.")
    })

    test('should throw a no such element error for an unknown digest', async () => {
      const account = createAccount({
        GetTransaction: () => { throw grpcError('NOT_FOUND', `Transaction ${DIGEST} not found`) }
      })

      const promise = account.getTransaction(DIGEST)

      await expect(promise).rejects.toThrow(NoSuchElementError)
      await expect(promise).rejects.toThrow(`No transaction found for the digest '${DIGEST}'.`)
    })

    test('should throw a no such element error for an empty response', async () => {
      const account = createAccount({ GetTransaction: () => ({}) })

      await expect(account.getTransaction(DIGEST)).rejects.toThrow(NoSuchElementError)
    })

    test('should throw a provider error if the node fails to answer', async () => {
      const account = createAccount({
        GetTransaction: () => { throw grpcError('INTERNAL', 'internal error') }
      })

      const promise = account.getTransaction(DIGEST)

      await expect(promise).rejects.toThrow(ProviderError)
      await expect(promise).rejects.toMatchObject({ reason: ProviderErrorReason.INTERNAL_SERVER_ERROR })
    })

    test('should decode the percent-encoded message of a grpc status', async () => {
      const account = createAccount({
        GetTransaction: () => { throw grpcError('INTERNAL', 'the node is not happy') }
      })

      await expect(account.getTransaction(DIGEST)).rejects.toThrow('the node is not happy')
    })
  })

  describe('wait defaults', () => {
    test('should poll at the cadence sui produces checkpoints at', () => {
      expect(account.defaultWaitInterval).toBe(500)
    })

    test('should give a transaction half a minute to land', () => {
      expect(account.defaultWaitTimeout).toBe(30_000)
    })
  })

  describe('waitForTransaction', () => {
    test('should resolve once the transaction reaches the target finality', async () => {
      const receipt = await account.waitForTransaction(DIGEST, { target: 'final' })

      expect(receipt.finality).toBe('final')
      expect(receipt.hash).toBe(DIGEST)
    })

    test('should poll and time out on its own defaults', async () => {
      const account = createAccount({
        GetTransaction: () => { throw grpcError('NOT_FOUND', `Transaction ${DIGEST} not found`) }
      })

      jest.spyOn(account, 'defaultWaitInterval', 'get').mockReturnValue(1)
      jest.spyOn(account, 'defaultWaitTimeout', 'get').mockReturnValue(20)

      await expect(account.waitForTransaction(DIGEST)).rejects.toThrow(TimeoutError)
    })

    test('should keep polling while the node does not know the digest', async () => {
      let calls = 0

      const account = createAccount({
        GetTransaction: ({ digest }) => {
          if (++calls < 3) {
            throw grpcError('NOT_FOUND', `Transaction ${digest} not found`)
          }

          return {
            transaction: {
              digest,
              effects: { ...EMPTY_EFFECTS, status: { success: true }, gasUsed: DUMMY_GAS_USED },
              checkpoint: DUMMY_CHECKPOINT
            }
          }
        }
      })

      const receipt = await account.waitForTransaction(DIGEST, { interval: 1, timeout: 5_000 })

      expect(calls).toBe(3)
      expect(receipt.finality).toBe('final')
    })
  })

  describe('getTransactionReceipt', () => {
    test('should return the native receipt', async () => {
      const account = createAccount()

      const receipt = await account.getTransactionReceipt(DIGEST)

      expect(receipt.digest).toBe(DIGEST)
      expect(receipt.checkpoint).toBe(DUMMY_CHECKPOINT)
      expect(receipt.effects.status).toEqual({ success: true })
    })

    test('should read the fields a native receipt is made of', async () => {
      const transport = createTransport()
      const account = new WalletAccountReadOnlySui(ADDRESS, { transport })

      await account.getTransactionReceipt(DIGEST)

      expect(transport.unary).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'GetTransaction' }),
        {
          digest: DIGEST,
          readMask: { paths: ['digest', 'signatures', 'checkpoint', 'timestamp', 'effects', 'balance_changes'] }
        },
        expect.anything()
      )
    })

    test('should return null for an unknown digest', async () => {
      const account = createAccount({
        GetTransaction: () => { throw grpcError('NOT_FOUND', `Transaction ${DIGEST} not found`) }
      })

      await expect(account.getTransactionReceipt(DIGEST)).resolves.toBeNull()
    })

    test('should return null for an empty response', async () => {
      const account = createAccount({ GetTransaction: () => ({}) })

      await expect(account.getTransactionReceipt(DIGEST)).resolves.toBeNull()
    })

    test('should throw a value error for a malformed digest', async () => {
      const account = createAccount()

      const promise = account.getTransactionReceipt('not-a-digest')

      await expect(promise).rejects.toThrow(ValueError)
      await expect(promise).rejects.toThrow("'not-a-digest' is not a valid transaction digest.")
    })

    test('should throw a provider error if the node fails to answer', async () => {
      const account = createAccount({
        GetTransaction: () => { throw grpcError('UNAVAILABLE', 'node is down') }
      })

      const promise = account.getTransactionReceipt(DIGEST)

      await expect(promise).rejects.toThrow(ProviderError)
      await expect(promise).rejects.toMatchObject({ reason: ProviderErrorReason.NETWORK_ERROR })
    })

    test('should throw if the account is not connected to a provider', async () => {
      const account = new WalletAccountReadOnlySui(ADDRESS)

      const promise = account.getTransactionReceipt(DIGEST)

      await expect(promise).rejects.toThrow(ProviderRequiredError)
      await expect(promise).rejects.toThrow('The wallet must be connected to a provider to fetch transaction receipts.')
    })
  })

  describe('verify', () => {
    const MESSAGE = 'Dummy message to sign.'
    const SIGNER = new Ed25519Keypair()

    const account = new WalletAccountReadOnlySui(SIGNER.toSuiAddress())

    let SIGNATURE

    beforeAll(async () => {
      const signature = await SIGNER.sign(new TextEncoder().encode(MESSAGE))

      SIGNATURE = toSerializedSignature({ signature, signatureScheme: 'ED25519', publicKey: SIGNER.getPublicKey() })
    })

    test('should return true for a valid signature', async () => {
      expect(await account.verify(MESSAGE, SIGNATURE)).toBe(true)
    })

    test('should return false for another message', async () => {
      expect(await account.verify('Another message.', SIGNATURE)).toBe(false)
    })

    test('should return false for a signature of another account', async () => {
      const account = new WalletAccountReadOnlySui(ADDRESS)

      expect(await account.verify(MESSAGE, SIGNATURE)).toBe(false)
    })

    test('should throw a value error on a malformed signature', async () => {
      const promise = account.verify(MESSAGE, 'A bad signature')

      await expect(promise).rejects.toThrow(ValueError)
      await expect(promise).rejects.toThrow('The string to be decoded is not correctly encoded.')
    })
  })

  describe('verifyPersonalMessage', () => {
    const ADDRESS = '0x4811486fe962452e3106e2991b88201703e08c4ee3772d120e941ee057cb3496'
    const MESSAGE = 'Dummy message to sign.'
    const SIGNATURE = 'AGTWDFMnLBFQTvjXuJmqiYYvdFbJ0BTdrEkCJbNwrDBquMtSI8mWr6jNbcZcIl6BkTRnNPq+popoP4nWAHPanADHRhAvruMzcoHScq6xLL6y8nBkVxiVOdkFSqn8oK9KoA=='

    const account = new WalletAccountReadOnlySui(ADDRESS)

    test('should return true for a valid signature', async () => {
      expect(await account.verifyPersonalMessage(MESSAGE, SIGNATURE)).toBe(true)
    })

    test('should return false for another message', async () => {
      expect(await account.verifyPersonalMessage('Incorrect message.', SIGNATURE)).toBe(false)
    })

    test('should throw a value error on a malformed signature', async () => {
      const promise = account.verifyPersonalMessage(MESSAGE, 'A bad signature')

      await expect(promise).rejects.toThrow(ValueError)
      await expect(promise).rejects.toThrow('The string to be decoded is not correctly encoded.')
    })
  })
})

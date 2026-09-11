import { describe, expect, jest, test } from '@jest/globals'

import { Ed25519Keypair, Ed25519PublicKey } from '@mysten/sui/keypairs/ed25519'
import { Transaction } from '@mysten/sui/transactions'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import { fromBase64 } from '@mysten/sui/utils'
import * as bip39 from 'bip39'

import WalletAccountSui from '../src/wallet-account-sui.js'
import WalletAccountReadOnlySui from '../src/wallet-account-read-only-sui.js'
import { AssertionError, MaximumFeeExceededError, ProviderError, ProviderRequiredError, TransactionError, TransferError, TransferErrorReason, ValueError } from '@tetherto/wdk-wallet'

const SEED_PHRASE = 'cook voyage document eight skate token alien guide drink uncle term abuse'

const PATH = "0'/0'/0'"
const FULL_PATH = "m/44'/784'/0'/0'/0'"

// The accounts SEED_PHRASE derives at m/44'/784'/{index}'/0'/0'.
const ACCOUNT_0 = {
  index: 0,
  path: PATH,
  fullPath: FULL_PATH,
  address: '0x566b21e6145532dcaf6d2fe07d0f3d9d886acc9b3c2f9b2bd1d2b55984172ff5',
  keyPair: {
    publicKey: '88e4f0387757a5e31dc4152dee843487b6bc6fe37180be1001b3bda3911d5fdf',
    privateKey: 'd67a44d2b76c687a77b71ef1e9a694edea43ad5a5c5f5dfc597572e393361e23'
  }
}

const ACCOUNT_1 = {
  index: 1,
  path: "1'/0'/0'",
  fullPath: "m/44'/784'/1'/0'/0'",
  address: '0x8050930b1ed0bb2e4283accfacf4f1c35cd47cc7f81b7b84cf0ca12543980465',
  keyPair: {
    publicKey: '85009f09dd57d348d0ecf88b31f06d7d30eb72c236a29807eb9e88419574e794',
    privateKey: '4474c0542a513371b87b29f4aa53688c6b7b145029683daf87ed66b6b5287ffe'
  }
}

const hex = (bytes) => Buffer.from(bytes).toString('hex')

const RECIPIENT = '0x4811486fe962452e3106e2991b88201703e08c4ee3772d120e941ee057cb3496'

const DUMMY_GAS_COIN = {
  objectId: '0x0466a9a57add505b7b85ac485054f9b71f574f4504d9c70acd8f73ef11e0dc30',
  version: 954_274_396n,
  digest: 'ECoiTzmhn29C7ruyPD69C4smexiC7bMdhbUTHcqbCpHF'
}

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

const DIGEST = 'FY7TzypQkPgqrb4Vp1K2QMzT7hGyevDWQdoLq3vDfr4R'

const TOKEN = '0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT'

const DUMMY_TOKEN_BALANCE = 482n

const DUMMY_TOKEN_COIN = {
  objectId: '0x33e9894a79b5662af29cfcecca812c52844d3ace8f1054c065ac92e9e6274ec7',
  version: 575_995_264n,
  digest: 'TTJ2GCTqeB4fzNu79XUC4wHSfrEs4xofvamSCHChy8b',
  owner: { kind: 1, address: ACCOUNT_0.address },
  objectType: `0x0000000000000000000000000000000000000000000000000000000000000002::coin::Coin<${TOKEN}>`,
  balance: DUMMY_TOKEN_BALANCE
}

// Fee constants implied by the mocked gas summary below:
// fee = computationCost + storageCost - storageRebate = 100_000 + 4_780_400 - 4_732_596.
const DUMMY_GAS_USED = {
  computationCost: 100_000n,
  storageCost: 4_780_400n,
  storageRebate: 4_732_596n,
  nonRefundableStorageFee: 47_804n
}
const MOCKED_FEE = 147_804n

const EXECUTED_TRANSACTION = {
  transaction: {
    digest: DIGEST,
    effects: { ...EMPTY_EFFECTS, status: { success: true }, gasUsed: DUMMY_GAS_USED }
  }
}

/**
 * A grpc transport answering the calls a transaction goes through: the node
 * resolves it (picking the gas coins), simulates it for the quote, then
 * executes it.
 */
function createTransport (overrides = {}) {
  const handlers = {
    GetBalance: ({ coinType }) => ({ balance: { coinType, balance: DUMMY_TOKEN_BALANCE, coinBalance: DUMMY_TOKEN_BALANCE } }),
    ListOwnedObjects: () => ({ objects: [DUMMY_TOKEN_COIN] }),
    SimulateTransaction: (input) => input.doGasSelection
      ? {
          transaction: {
            transaction: {
              ...input.transaction,
              gasPayment: { objects: [DUMMY_GAS_COIN], owner: ACCOUNT_0.address, price: 1_000n, budget: 2_000_000n }
            },
            effects: { ...EMPTY_EFFECTS, status: { success: true } }
          }
        }
      : EXECUTED_TRANSACTION,
    ExecuteTransaction: () => EXECUTED_TRANSACTION,
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

function createAccount (path = PATH, overrides = {}) {
  return new WalletAccountSui(SEED_PHRASE, path, { transport: createTransport(overrides), network: 'mainnet' })
}

describe('WalletAccountSui', () => {
  describe('Constructor', () => {
    test('should derive the account at the given path', () => {
      const account = new WalletAccountSui(SEED_PHRASE, ACCOUNT_0.path)

      expect(account).toBeInstanceOf(WalletAccountSui)
      expect(account).toBeInstanceOf(WalletAccountReadOnlySui)
      expect(account.address).toBe(ACCOUNT_0.address)
    })

    test('should derive a distinct account per index', () => {
      const account = new WalletAccountSui(SEED_PHRASE, ACCOUNT_1.path)

      expect(account.address).toBe(ACCOUNT_1.address)
      expect(account.address).not.toBe(ACCOUNT_0.address)
    })

    test('should derive the same account from the raw seed bytes', () => {
      const account = new WalletAccountSui(bip39.mnemonicToSeedSync(SEED_PHRASE), PATH)

      expect(account.address).toBe(ACCOUNT_0.address)
    })

    test('should derive the account the sdk derives at the full path', () => {
      const account = new WalletAccountSui(SEED_PHRASE, PATH)

      const keypair = Ed25519Keypair.deriveKeypair(SEED_PHRASE, FULL_PATH)

      expect(account.address).toBe(keypair.getPublicKey().toSuiAddress())
    })

    test('should keep the account key material', () => {
      const account = new WalletAccountSui(SEED_PHRASE, PATH)

      expect(account._path).toBe(FULL_PATH)
      expect(account._rawPrivateKey).toHaveLength(32)
      expect(account._rawPublicKey).toHaveLength(32)
      expect(Ed25519Keypair.fromSecretKey(account._rawPrivateKey).getPublicKey().toSuiAddress())
        .toBe(ACCOUNT_0.address)
    })

    test('should hold on to the given configuration', () => {
      const config = { rpcUrl: 'https://fullnode.mainnet.sui.io:443', network: 'mainnet' }

      const account = new WalletAccountSui(SEED_PHRASE, PATH, config)

      expect(account._config).toBe(config)
      expect(account._client).toBeDefined()
    })

    test('should not connect to a provider without a configuration', () => {
      const account = new WalletAccountSui(SEED_PHRASE, PATH)

      expect(account._client).toBeUndefined()
    })

    test('should throw a value error for an invalid seed phrase', () => {
      expect(() => new WalletAccountSui('not a real seed phrase at all', PATH))
        .toThrow(ValueError)
      expect(() => new WalletAccountSui('not a real seed phrase at all', PATH))
        .toThrow('The seed phrase is invalid.')
    })

    test.each([
      ["a non-hardened segment", "0'/0/0"],
      ['too few segments', "0'/0'"],
      ['too many segments', "0'/0'/0'/0'"],
      ['a leading zero', "00'/0'/0'"],
      ['the full path', FULL_PATH],
      ['an empty path', '']
    ])('should throw a value error for a path with %s', (_, path) => {
      expect(() => new WalletAccountSui(SEED_PHRASE, path)).toThrow(ValueError)
    })
  })

  describe('index', () => {
    test('should return the index of the account', () => {
      const account = new WalletAccountSui(SEED_PHRASE, ACCOUNT_0.path)

      expect(account.index).toBe(ACCOUNT_0.index)
    })

    test('should return the index of a far account', () => {
      const account = new WalletAccountSui(SEED_PHRASE, "999'/0'/0'")

      expect(account.index).toBe(999)
    })

    test.each([
      ["0'/0'/7'", 0],
      ["1'/0'/15'", 1],
      ["0'/5'/123'", 0]
    ])('should read the account segment of %s', (path, index) => {
      const account = new WalletAccountSui(SEED_PHRASE, path)

      expect(account.index).toBe(index)
    })
  })

  describe('path', () => {
    test('should return the full slip-0010 path of the account', () => {
      const account = new WalletAccountSui(SEED_PHRASE, ACCOUNT_0.path)

      expect(account.path).toBe(ACCOUNT_0.fullPath)
    })

    test.each([
      [ACCOUNT_1.path, ACCOUNT_1.fullPath],
      ["5'/0'/0'", "m/44'/784'/5'/0'/0'"],
      ["1'/2'/3'", "m/44'/784'/1'/2'/3'"]
    ])('should prepend the coin type to %s', (path, fullPath) => {
      const account = new WalletAccountSui(SEED_PHRASE, path)

      expect(account.path).toBe(fullPath)
    })
  })

  describe('keyPair', () => {
    test('should return the account key pair', () => {
      const { keyPair } = new WalletAccountSui(SEED_PHRASE, ACCOUNT_0.path)

      expect(hex(keyPair.publicKey)).toBe(ACCOUNT_0.keyPair.publicKey)
      expect(hex(keyPair.privateKey)).toBe(ACCOUNT_0.keyPair.privateKey)
    })

    test('should return a different key pair per account', () => {
      const { keyPair: keyPair0 } = new WalletAccountSui(SEED_PHRASE, ACCOUNT_0.path)
      const { keyPair: keyPair1 } = new WalletAccountSui(SEED_PHRASE, ACCOUNT_1.path)

      expect(hex(keyPair0.publicKey)).toBe(ACCOUNT_0.keyPair.publicKey)
      expect(hex(keyPair0.privateKey)).toBe(ACCOUNT_0.keyPair.privateKey)
      expect(hex(keyPair1.publicKey)).toBe(ACCOUNT_1.keyPair.publicKey)
      expect(hex(keyPair1.privateKey)).toBe(ACCOUNT_1.keyPair.privateKey)
    })

    test('should return the public key the address is derived from', () => {
      const account = new WalletAccountSui(SEED_PHRASE, ACCOUNT_0.path)

      expect(new Ed25519PublicKey(account.keyPair.publicKey).toSuiAddress()).toBe(ACCOUNT_0.address)
    })
  })

  describe('sign', () => {
    const MESSAGE = 'Dummy message to sign.'

    // The signatures ACCOUNT_0 produces: ed25519 is deterministic, so a given
    // key and message always sign to the same bytes.
    const SIGNATURE = 'AAVX/HlNuaycwCx7hG3MBwM1REHHNOcMvj0ZDKGUOxUQ/CyNHfFdz+ci4wA5UunhGEihv8HHPO6r24SHNzYIwwCI5PA4d1el4x3EFS3uhDSHtrxv43GAvhABs72jkR1f3w=='
    const OTHER_SIGNATURE = 'AP/LQmYN/McZIpUo6UpJGMUQITOm4ki2pdO9LK09hAk3WAa3Zr+yErAthXZJBg17iWdcW74h2QjRXDHV6qrZGgSI5PA4d1el4x3EFS3uhDSHtrxv43GAvhABs72jkR1f3w=='

    test('should produce a consistent signature for a message', async () => {
      const account = new WalletAccountSui(SEED_PHRASE, ACCOUNT_0.path)

      expect(await account.sign(MESSAGE)).toBe(SIGNATURE)
      expect(await account.sign(MESSAGE)).toBe(SIGNATURE)
    })

    test('should produce different signatures for different messages', async () => {
      const account = new WalletAccountSui(SEED_PHRASE, ACCOUNT_0.path)

      expect(await account.sign(MESSAGE)).toBe(SIGNATURE)
      expect(await account.sign('Another message.')).toBe(OTHER_SIGNATURE)
    })

    test('should produce different signatures for different accounts', async () => {
      const account = new WalletAccountSui(SEED_PHRASE, ACCOUNT_0.path)
      const other = new WalletAccountSui(SEED_PHRASE, ACCOUNT_1.path)

      expect(await other.sign(MESSAGE)).not.toBe(await account.sign(MESSAGE))
    })

    test('should produce a signature the account verifies', async () => {
      const account = new WalletAccountSui(SEED_PHRASE, ACCOUNT_0.path)

      const signature = await account.sign(MESSAGE)

      expect(await account.verify(MESSAGE, signature)).toBe(true)
    })

    test('should not produce a signature that verifies another message', async () => {
      const account = new WalletAccountSui(SEED_PHRASE, ACCOUNT_0.path)

      const signature = await account.sign(MESSAGE)

      expect(await account.verify('Another message.', signature)).toBe(false)
    })

    test('should not produce a signature that verifies against another account', async () => {
      const account = new WalletAccountSui(SEED_PHRASE, ACCOUNT_0.path)
      const other = new WalletAccountSui(SEED_PHRASE, ACCOUNT_1.path)

      const signature = await account.sign(MESSAGE)

      expect(await other.verify(MESSAGE, signature)).toBe(false)
    })

    test('should throw an assertion error once the key has been erased', async () => {
      const account = new WalletAccountSui(SEED_PHRASE, ACCOUNT_0.path)

      account.dispose()

      await expect(account.sign(MESSAGE)).rejects.toThrow(AssertionError)
      await expect(account.sign(MESSAGE)).rejects.toThrow('The wallet account has been disposed.')
    })
  })

  describe('signTransaction', () => {
    // What ACCOUNT_0 signs for a 1000 mist transfer to RECIPIENT, once the
    // mocked node has resolved the gas payment.
    const SIGNED_BYTES = 'AAACAAjoAwAAAAAAAAAgSBFIb+liRS4xBuKZG4ggFwPgjE7jdy0SDpQe4FfLNJYCAgABAQAAAQEDAAAAAAEBAFZrIeYUVTLcr20v4H0PPZ2IasybPC+bK9HStVmEFy/1AQRmqaV63VBbe4WsSFBU+bcfV09FBNnHCs2Pc+8R4NwwXBLhOAAAAAAgxC4jwZUViGUXf8c3gBMj8wOwyL/oUyYgc0EpuPhwmeJWayHmFFUy3K9tL+B9Dz2diGrMmzwvmyvR0rVZhBcv9egDAAAAAAAAgIQeAAAAAAAA'
    const SIGNATURE = 'AMpfTKBdKmAz3Idqyqlfvc5lsXsJZfAKlKflqvYNHhP0BNJO9JN4PgLzqChjeCSJMZ2SRDtGw1ZGkWm+GuVUqgeI5PA4d1el4x3EFS3uhDSHtrxv43GAvhABs72jkR1f3w=='

    test('should sign a native transfer', async () => {
      const account = createAccount()

      const signed = await account.signTransaction({ to: RECIPIENT, value: 1_000 })

      expect(signed.bytes).toBe(SIGNED_BYTES)
      expect(signed.signature).toBe(SIGNATURE)
    })

    test('should produce a signature of the transaction it returns', async () => {
      const account = createAccount()

      const { bytes, signature } = await account.signTransaction({ to: RECIPIENT, value: 1_000 })

      const publicKey = await verifyTransactionSignature(fromBase64(bytes), signature)

      expect(publicKey.toSuiAddress()).toBe(ACCOUNT_0.address)
    })

    test('should send a transaction that does not name its sender from this account', async () => {
      const account = createAccount()

      const tx = new Transaction()
      const [coin] = tx.splitCoins(tx.gas, [1_000])
      tx.transferObjects([coin], RECIPIENT)

      const { bytes } = await account.signTransaction(tx)

      expect(Transaction.from(fromBase64(bytes)).getData().sender).toBe(ACCOUNT_0.address)
    })

    test('should produce a different signature per account', async () => {
      const account = createAccount()
      const other = createAccount(ACCOUNT_1.path)

      const signed = await account.signTransaction({ to: RECIPIENT, value: 1_000 })
      const otherSigned = await other.signTransaction({ to: RECIPIENT, value: 1_000 })

      expect(otherSigned.signature).not.toBe(signed.signature)
    })

    test('should throw if the account is not connected to a provider', async () => {
      const account = new WalletAccountSui(SEED_PHRASE, PATH)

      const promise = account.signTransaction({ to: RECIPIENT, value: 1_000 })

      await expect(promise).rejects.toThrow(ProviderRequiredError)
      await expect(promise).rejects.toThrow('The wallet must be connected to a provider to build transactions.')
    })

    test('should throw a value error for a malformed recipient', async () => {
      const account = createAccount()

      await expect(account.signTransaction({ to: 'not-an-address', value: 1_000 }))
        .rejects.toThrow(ValueError)
    })

    test('should throw a transaction error when the transaction cannot be resolved', async () => {
      const account = createAccount(PATH, {
        SimulateTransaction: () => {
          throw new Error('Unable to perform gas selection due to insufficient SUI balance for account')
        }
      })

      await expect(account.signTransaction({ to: RECIPIENT, value: 1_000 }))
        .rejects.toThrow(TransactionError)
    })

    test('should throw an assertion error once the key has been erased', async () => {
      const account = createAccount()

      account.dispose()

      await expect(account.signTransaction({ to: RECIPIENT, value: 1_000 }))
        .rejects.toThrow(AssertionError)
    })
  })

  describe('quoteSendTransaction', () => {
    test('should quote a transaction that is not signed yet', async () => {
      const account = createAccount()

      const { fee } = await account.quoteSendTransaction({ to: RECIPIENT, value: 1_000 })

      expect(fee).toBe(MOCKED_FEE)
    })

    test('should quote an already signed transaction', async () => {
      const account = createAccount()

      const signed = await account.signTransaction({ to: RECIPIENT, value: 1_000 })

      const { fee } = await account.quoteSendTransaction(signed)

      expect(fee).toBe(MOCKED_FEE)
    })

    test('should quote a signed transaction without resolving it again', async () => {
      const transport = createTransport()
      const account = new WalletAccountSui(SEED_PHRASE, PATH, { transport, network: 'mainnet' })

      const signed = await account.signTransaction({ to: RECIPIENT, value: 1_000 })

      transport.unary.mockClear()

      await account.quoteSendTransaction(signed)

      expect(transport.unary).toHaveBeenCalledTimes(1)
      expect(transport.unary).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'SimulateTransaction' }),
        expect.objectContaining({ doGasSelection: false }),
        expect.anything()
      )
    })
  })

  describe('sendTransaction', () => {
    test('should return the hash and the fee of the transaction', async () => {
      const account = createAccount()

      const result = await account.sendTransaction({ to: RECIPIENT, value: 1_000 })

      expect(result).toEqual({ hash: DIGEST, fee: MOCKED_FEE })
    })

    test('should resolve, quote and then execute the transaction', async () => {
      const transport = createTransport()
      const account = new WalletAccountSui(SEED_PHRASE, PATH, { transport, network: 'mainnet' })

      await account.sendTransaction({ to: RECIPIENT, value: 1_000 })

      expect(transport.unary.mock.calls.map(([method]) => method.name))
        .toEqual(['SimulateTransaction', 'SimulateTransaction', 'ExecuteTransaction'])
    })

    test('should execute the signature of an already signed transaction', async () => {
      const transport = createTransport()
      const account = new WalletAccountSui(SEED_PHRASE, PATH, { transport, network: 'mainnet' })

      const signed = await account.signTransaction({ to: RECIPIENT, value: 1_000 })

      transport.unary.mockClear()

      const result = await account.sendTransaction(signed)

      const [method, request] = transport.unary.mock.calls.at(-1)

      expect(result).toEqual({ hash: DIGEST, fee: MOCKED_FEE })
      expect(method.name).toBe('ExecuteTransaction')
      expect(request.transaction.bcs.value).toEqual(fromBase64(signed.bytes))
      expect(request.signatures[0].bcs.value).toEqual(fromBase64(signed.signature))
    })

    test('should throw if the fee exceeds the maximum transaction fee', async () => {
      const account = new WalletAccountSui(SEED_PHRASE, PATH, {
        transport: createTransport(),
        network: 'mainnet',
        transactionMaxFee: MOCKED_FEE - 1n
      })

      const promise = account.sendTransaction({ to: RECIPIENT, value: 1_000 })

      await expect(promise).rejects.toThrow(MaximumFeeExceededError)
      await expect(promise).rejects.toThrow('Exceeded maximum fee cost for transaction operation.')
    })

    test('should not execute a transaction that exceeds the maximum fee', async () => {
      const transport = createTransport()
      const account = new WalletAccountSui(SEED_PHRASE, PATH, {
        transport,
        network: 'mainnet',
        transactionMaxFee: MOCKED_FEE - 1n
      })

      await expect(account.sendTransaction({ to: RECIPIENT, value: 1_000 })).rejects.toThrow(MaximumFeeExceededError)

      expect(transport.unary.mock.calls.map(([method]) => method.name))
        .not.toContain('ExecuteTransaction')
    })

    test('should send a transaction whose fee is the maximum transaction fee', async () => {
      const account = new WalletAccountSui(SEED_PHRASE, PATH, {
        transport: createTransport(),
        network: 'mainnet',
        transactionMaxFee: MOCKED_FEE
      })

      await expect(account.sendTransaction({ to: RECIPIENT, value: 1_000 })).resolves.toEqual({
        hash: DIGEST,
        fee: MOCKED_FEE
      })
    })

    test('should throw a transaction error when the execution fails', async () => {
      const account = createAccount(PATH, {
        ExecuteTransaction: () => ({
          transaction: {
            digest: DIGEST,
            effects: {
              ...EMPTY_EFFECTS,
              status: { success: false, error: { description: 'MoveAbort' } },
              gasUsed: DUMMY_GAS_USED
            }
          }
        })
      })

      await expect(account.sendTransaction({ to: RECIPIENT, value: 1_000 }))
        .rejects.toThrow(TransactionError)
    })

    test('should throw a provider error when the node fails to answer', async () => {
      const account = createAccount(PATH, {
        ExecuteTransaction: () => {
          throw Object.assign(new Error('unavailable'), { code: 'UNAVAILABLE' })
        }
      })

      await expect(account.sendTransaction({ to: RECIPIENT, value: 1_000 }))
        .rejects.toThrow(ProviderError)
    })

    test('should throw if the account is not connected to a provider', async () => {
      const account = new WalletAccountSui(SEED_PHRASE, PATH)

      const promise = account.sendTransaction({ to: RECIPIENT, value: 1_000 })

      await expect(promise).rejects.toThrow(ProviderRequiredError)
      await expect(promise).rejects.toThrow('The wallet must be connected to a provider to send transactions.')
    })

    test('should throw an assertion error once the key has been erased', async () => {
      const account = createAccount()

      account.dispose()

      await expect(account.sendTransaction({ to: RECIPIENT, value: 1_000 }))
        .rejects.toThrow(AssertionError)
    })
  })

  describe('transfer', () => {
    const TRANSFER = { token: TOKEN, recipient: RECIPIENT, amount: 1 }

    test('should return the hash and the fee of the transfer', async () => {
      const account = createAccount()

      await expect(account.transfer(TRANSFER)).resolves.toEqual({ hash: DIGEST, fee: MOCKED_FEE })
    })

    test('should execute the transfer it quoted', async () => {
      const transport = createTransport()
      const account = new WalletAccountSui(SEED_PHRASE, PATH, { transport, network: 'mainnet' })

      await account.transfer(TRANSFER)

      const [method, request] = transport.unary.mock.calls.at(-1)
      const [, quoted] = transport.unary.mock.calls.at(-2)

      expect(method.name).toBe('ExecuteTransaction')
      expect(request.transaction.bcs.value).toEqual(quoted.transaction.bcs.value)
    })

    test('should throw if the fee exceeds the maximum transfer fee', async () => {
      const account = new WalletAccountSui(SEED_PHRASE, PATH, {
        transport: createTransport(),
        network: 'mainnet',
        transferMaxFee: MOCKED_FEE - 1n
      })

      const promise = account.transfer(TRANSFER)

      await expect(promise).rejects.toThrow(MaximumFeeExceededError)
      await expect(promise).rejects.toThrow('Exceeded maximum fee cost for transfer operation.')
    })

    test('should not execute a transfer that exceeds the maximum fee', async () => {
      const transport = createTransport()
      const account = new WalletAccountSui(SEED_PHRASE, PATH, {
        transport,
        network: 'mainnet',
        transferMaxFee: MOCKED_FEE - 1n
      })

      await expect(account.transfer(TRANSFER)).rejects.toThrow(MaximumFeeExceededError)

      expect(transport.unary.mock.calls.map(([method]) => method.name)).not.toContain('ExecuteTransaction')
    })

    test('should transfer when the fee is the maximum transfer fee', async () => {
      const account = new WalletAccountSui(SEED_PHRASE, PATH, {
        transport: createTransport(),
        network: 'mainnet',
        transferMaxFee: MOCKED_FEE
      })

      await expect(account.transfer(TRANSFER)).resolves.toEqual({ hash: DIGEST, fee: MOCKED_FEE })
    })

    test('should throw a transfer error when the account holds too few tokens', async () => {
      const account = createAccount(PATH, { ListOwnedObjects: () => ({ objects: [] }) })

      const promise = account.transfer({ ...TRANSFER, amount: 1_000 })

      await expect(promise).rejects.toThrow(TransferError)
      await expect(promise).rejects.toMatchObject({ reason: TransferErrorReason.INSUFFICIENT_TOKEN_BALANCE })
    })

    test('should throw a value error for a malformed token', async () => {
      const account = createAccount()

      await expect(account.transfer({ ...TRANSFER, token: 'not-a-type' })).rejects.toThrow(ValueError)
    })

    test('should throw if the account is not connected to a provider', async () => {
      const account = new WalletAccountSui(SEED_PHRASE, PATH)

      const promise = account.transfer(TRANSFER)

      await expect(promise).rejects.toThrow(ProviderRequiredError)
      await expect(promise).rejects.toThrow('The wallet must be connected to a provider to transfer tokens.')
    })

    test('should throw an assertion error once the key has been erased', async () => {
      const account = createAccount()

      account.dispose()

      await expect(account.transfer(TRANSFER)).rejects.toThrow(AssertionError)
    })
  })

  describe('toReadOnlyAccount', () => {
    test('should return a read-only copy of the account', async () => {
      const account = createAccount()

      const readOnlyAccount = await account.toReadOnlyAccount()

      expect(readOnlyAccount).toBeInstanceOf(WalletAccountReadOnlySui)
      expect(readOnlyAccount).not.toBeInstanceOf(WalletAccountSui)
      expect(await readOnlyAccount.getAddress()).toBe(ACCOUNT_0.address)
    })

    test('should hand the provider over to the copy', async () => {
      const account = createAccount()

      const readOnlyAccount = await account.toReadOnlyAccount()

      expect(readOnlyAccount._config).toBe(account._config)
      expect(readOnlyAccount._client).toBeDefined()
    })

    test('should return the same copy on every call', async () => {
      const account = createAccount()

      expect(await account.toReadOnlyAccount()).toBe(await account.toReadOnlyAccount())
    })

    test('should not carry the account key', async () => {
      const account = createAccount()

      const readOnlyAccount = await account.toReadOnlyAccount()

      expect(readOnlyAccount._rawPrivateKey).toBeUndefined()
      expect(readOnlyAccount.sign).toBeUndefined()
    })
  })

  describe('dispose', () => {
    test('should erase the private key from memory', () => {
      const account = createAccount()

      const key = account._rawPrivateKey

      expect(account.keyPair.privateKey).toHaveLength(32)

      account.dispose()

      expect(account.keyPair.privateKey).toBeNull()
      expect(hex(key)).toBe('00'.repeat(32))
    })

    test('should keep the account readable', () => {
      const account = createAccount()

      account.dispose()

      expect(account.address).toBe(ACCOUNT_0.address)
      expect(hex(account.keyPair.publicKey)).toBe(ACCOUNT_0.keyPair.publicKey)
      expect(account.path).toBe(ACCOUNT_0.fullPath)
      expect(account.index).toBe(ACCOUNT_0.index)
    })

    test('should be safe to call twice', () => {
      const account = createAccount()

      account.dispose()

      expect(() => account.dispose()).not.toThrow()
      expect(account.keyPair.privateKey).toBeNull()
    })
  })
})

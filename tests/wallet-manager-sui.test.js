import { describe, expect, jest, test } from '@jest/globals'

import WalletManagerSui from '../src/wallet-manager-sui.js'
import WalletAccountSui from '../src/wallet-account-sui.js'
import { ProviderError, ProviderErrorReason, ProviderRequiredError, ValueError } from '@tetherto/wdk-wallet'

const SEED_PHRASE = 'cook voyage document eight skate token alien guide drink uncle term abuse'

const DUMMY_REFERENCE_GAS_PRICE = 100n

// The accounts SEED_PHRASE derives at m/44'/784'/{index}'/0'/0'.
const ACCOUNT_0 = {
  index: 0,
  path: "m/44'/784'/0'/0'/0'",
  address: '0x566b21e6145532dcaf6d2fe07d0f3d9d886acc9b3c2f9b2bd1d2b55984172ff5'
}

const ACCOUNT_1 = {
  index: 1,
  path: "m/44'/784'/1'/0'/0'",
  address: '0x8050930b1ed0bb2e4283accfacf4f1c35cd47cc7f81b7b84cf0ca12543980465'
}

function createTransport (overrides = {}) {
  const handlers = {
    GetEpoch: () => ({ epoch: { referenceGasPrice: DUMMY_REFERENCE_GAS_PRICE } }),
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

function createWallet (overrides = {}) {
  return new WalletManagerSui(SEED_PHRASE, { transport: createTransport(overrides), network: 'mainnet' })
}

describe('WalletManagerSui', () => {
  describe('Constructor', () => {
    test('should create a wallet from a seed phrase', () => {
      const wallet = createWallet()

      expect(wallet).toBeInstanceOf(WalletManagerSui)
      expect(wallet.seed).toHaveLength(64)
    })

    test('should create a wallet from raw seed bytes', async () => {
      const wallet = createWallet()

      const fromBytes = new WalletManagerSui(wallet.seed)

      expect(await fromBytes.getAccount()).toMatchObject({ address: ACCOUNT_0.address })
    })

    test('should throw a value error for an invalid seed phrase', () => {
      expect(() => new WalletManagerSui('not a real seed phrase at all')).toThrow(ValueError)
    })

    test('should throw a value error when created from a signer', () => {
      const signer = { derive: () => {}, getAddress: () => {}, dispose: () => {} }

      expect(() => new WalletManagerSui(signer)).toThrow(ValueError)
      expect(() => new WalletManagerSui(signer)).toThrow('The wallet manager must be created from a seed.')
    })

    test('should not connect to a provider without a configuration', () => {
      const wallet = new WalletManagerSui(SEED_PHRASE)

      expect(wallet._client).toBeUndefined()
    })
  })

  describe('getAccount', () => {
    test('should return the first account by default', async () => {
      const account = await createWallet().getAccount()

      expect(account).toBeInstanceOf(WalletAccountSui)
      expect(account.address).toBe(ACCOUNT_0.address)
      expect(account.path).toBe(ACCOUNT_0.path)
      expect(account.index).toBe(ACCOUNT_0.index)
    })

    test('should return the account at the given index', async () => {
      const account = await createWallet().getAccount(ACCOUNT_1.index)

      expect(account.address).toBe(ACCOUNT_1.address)
      expect(account.path).toBe(ACCOUNT_1.path)
      expect(account.index).toBe(ACCOUNT_1.index)
    })

    test('should hand the configuration over to the account', async () => {
      const wallet = createWallet()

      const account = await wallet.getAccount()

      expect(account._config).toBe(wallet._config)
      expect(account._client).toBeDefined()
    })

    test('should return the same account on every call', async () => {
      const wallet = createWallet()

      expect(await wallet.getAccount(1)).toBe(await wallet.getAccount(1))
    })

    test.each([
      ['a negative index', -1],
      ['a fractional index', 1.5],
      ['a non-numeric index', '0']
    ])('should throw a value error for %s', async (_, index) => {
      await expect(createWallet().getAccount(index)).rejects.toThrow(ValueError)
    })
  })

  describe('getAccountByPath', () => {
    test('should return the account at the given path', async () => {
      const account = await createWallet().getAccountByPath("1'/2'/3'")

      expect(account).toBeInstanceOf(WalletAccountSui)
      expect(account.path).toBe("m/44'/784'/1'/2'/3'")
    })

    test('should return the same account on every call', async () => {
      const wallet = createWallet()

      expect(await wallet.getAccountByPath("0'/0'/0'")).toBe(await wallet.getAccountByPath("0'/0'/0'"))
    })

    test('should return the account getAccount returns for the same path', async () => {
      const wallet = createWallet()

      expect(await wallet.getAccountByPath("0'/0'/0'")).toBe(await wallet.getAccount())
    })

    test('should throw a value error for a malformed path', async () => {
      await expect(createWallet().getAccountByPath("0'/0'")).rejects.toThrow(ValueError)
    })
  })

  describe('getFeeRates', () => {
    test('should return the reference gas price and a bid above it', async () => {
      const rates = await createWallet().getFeeRates()

      expect(rates).toEqual({
        normal: DUMMY_REFERENCE_GAS_PRICE,
        fast: DUMMY_REFERENCE_GAS_PRICE * 2n
      })
    })

    test('should read the reference gas price of the current epoch', async () => {
      const transport = createTransport()
      const wallet = new WalletManagerSui(SEED_PHRASE, { transport })

      await wallet.getFeeRates()

      expect(transport.unary).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'GetEpoch' }),
        expect.objectContaining({ readMask: { paths: ['reference_gas_price'] } }),
        expect.anything()
      )
    })

    test('should throw if the wallet is not connected to a provider', async () => {
      const wallet = new WalletManagerSui(SEED_PHRASE)

      const promise = wallet.getFeeRates()

      await expect(promise).rejects.toThrow(ProviderRequiredError)
      await expect(promise).rejects.toThrow('The wallet must be connected to a provider to get fee rates.')
    })

    test('should throw a provider error when the node fails to answer', async () => {
      const wallet = createWallet({
        GetEpoch: () => {
          throw Object.assign(new Error('node is down'), { code: 'UNAVAILABLE' })
        }
      })

      const promise = wallet.getFeeRates()

      await expect(promise).rejects.toThrow(ProviderError)
      await expect(promise).rejects.toMatchObject({ reason: ProviderErrorReason.NETWORK_ERROR })
    })
  })

  describe('dispose', () => {
    test('should dispose the accounts it handed out', async () => {
      const wallet = createWallet()

      const account = await wallet.getAccount()

      account.dispose = jest.fn()

      wallet.dispose()

      expect(account.dispose).toHaveBeenCalled()
    })
  })
})

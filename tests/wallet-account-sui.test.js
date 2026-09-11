import { describe, expect, test } from '@jest/globals'

import { Ed25519Keypair, Ed25519PublicKey } from '@mysten/sui/keypairs/ed25519'
import * as bip39 from 'bip39'

import WalletAccountSui from '../src/wallet-account-sui.js'
import WalletAccountReadOnlySui from '../src/wallet-account-read-only-sui.js'
import { AssertionError, NotImplementedError, ValueError } from '@tetherto/wdk-wallet'

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

      // Stands in for dispose(), which is not implemented yet.
      account._rawPrivateKey = undefined

      await expect(account.sign(MESSAGE)).rejects.toThrow(AssertionError)
      await expect(account.sign(MESSAGE)).rejects.toThrow('The wallet account has been disposed.')
    })
  })

  describe('Not implemented yet', () => {
    const account = new WalletAccountSui(SEED_PHRASE, PATH)

    test.each([
      ['dispose', () => account.dispose()]
    ])('%s should throw a not implemented error', (_, call) => {
      expect(call).toThrow(NotImplementedError)
    })

    test.each([
      ['signTransaction', () => account.signTransaction({})],
      ['sendTransaction', () => account.sendTransaction({})],
      ['transfer', () => account.transfer({})],
      ['toReadOnlyAccount', () => account.toReadOnlyAccount()]
    ])('%s should reject with a not implemented error', async (_, call) => {
      await expect(call()).rejects.toThrow(NotImplementedError)
    })
  })
})

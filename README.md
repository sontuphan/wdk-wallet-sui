# @tetherto/wdk-wallet-sui

**Note**: This package is currently in beta. Please test thoroughly in development environments before using in production.

A simple and secure package to manage SLIP-0010 wallets for the Sui blockchain. This package provides a clean API for creating, managing, and interacting with Sui wallets using BIP-39 seed phrases and Sui's ed25519 derivation paths.

## 🔍 About WDK

This module is part of the [**WDK (Wallet Development Kit)**](https://wallet.tether.io/) project, which empowers developers to build secure, non-custodial wallets with unified blockchain access, stateless architecture, and complete user control. 

For detailed documentation about the complete WDK ecosystem, visit [docs.wallet.tether.io](https://docs.wallet.tether.io).

## 🌟 Features

- **BIP-39 Seed Phrase Support**: Generate and validate BIP-39 mnemonic seed phrases
- **Sui Derivation Paths**: Support for SLIP-0010 ed25519 derivation paths for Sui (m/44'/784')
- **Multi-Account Management**: Create and manage multiple accounts from a single seed phrase
- **Transaction Management**: Send transactions, sign them for later, and get fee estimates
- **Coin Support**: Query the sui balance and the balance of any coin type
- **Finality Reporting**: Read normalized receipts and wait for a transaction to be checkpointed
- **Provider Failover**: Serve several rpc endpoints behind one client, retrying on the next when one fails

## ⬇️ Installation

To install the `@tetherto/wdk-wallet-sui` package, follow these instructions:

You can install it using npm:

```bash
npm install @tetherto/wdk-wallet-sui
```

## 🚀 Quick Start

### Importing from `@tetherto/wdk-wallet-sui`

### Creating a New Wallet

```javascript
import WalletManagerSui, { WalletAccountSui, WalletAccountReadOnlySui } from '@tetherto/wdk-wallet-sui'

// Use a BIP-39 seed phrase (replace with your own secure phrase)
const seedPhrase = 'test only example nut use this real life secret phrase must random'

// Create wallet manager with provider config
const wallet = new WalletManagerSui(seedPhrase, {
  // Option 1: Using a single RPC URL
  rpcUrl: 'https://fullnode.mainnet.sui.io:443', // or any Sui fullnode endpoint
  network: 'mainnet', // Optional: defaults to "mainnet"
  transferMaxFee: 10000000 // Optional: Maximum fee in mists
})

// OR

// Option 2: Using several RPC URLs, which enables failover
const wallet2 = new WalletManagerSui(seedPhrase, {
  rpcUrl: [
    'https://fullnode.mainnet.sui.io:443',
    'https://sui-mainnet.example.com:443'
  ],
  retries: 3, // Optional: failover retry attempts (default: 3)
  transferMaxFee: 10000000 // Optional: Maximum fee in mists
})

// Get a full access account
const account = await wallet.getAccount(0)

// Convert to a read-only account
const readOnlyAccount = await account.toReadOnlyAccount()
```

### Managing Multiple Accounts

```javascript
import WalletManagerSui from '@tetherto/wdk-wallet-sui'

// Assume wallet is already created
// Get the first account (index 0)
const account = await wallet.getAccount(0)
const address = await account.getAddress()
console.log('Account 0 address:', address)

// Get the second account (index 1)
const account1 = await wallet.getAccount(1)
const address1 = await account1.getAddress()
console.log('Account 1 address:', address1)

// Get account by custom derivation path
// Full path will be m/44'/784'/0'/0'/5'
const customAccount = await wallet.getAccountByPath("0'/0'/5'")
const customAddress = await customAccount.getAddress()
console.log('Custom account address:', customAddress)

// Note: every segment of a Sui derivation path must be hardened
// All accounts inherit the provider configuration from the wallet manager
```

### Checking Balances

#### Owned Account

For accounts where you have the seed phrase and full access:

```javascript
import WalletManagerSui from '@tetherto/wdk-wallet-sui'

// Assume wallet and account are already created
// Get sui balance (in mists)
const balance = await account.getBalance()
console.log('Sui balance:', balance, 'mists') // 1 SUI = 1000000000 mists

// Get the balance of another coin type
const coinType = '0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT'
const tokenBalance = await account.getTokenBalance(coinType)
console.log('Token balance:', tokenBalance)

// Note: Provider is required for balance checks
// Make sure wallet was created with a provider configuration
```

#### Read-Only Account

For addresses where you don't have the seed phrase:

```javascript
import { WalletAccountReadOnlySui } from '@tetherto/wdk-wallet-sui'

// Create a read-only account
const readOnlyAccount = new WalletAccountReadOnlySui('0x...', { // Sui address
  rpcUrl: 'https://fullnode.mainnet.sui.io:443' // Required for balance checks
})

// Check sui balance
const balance = await readOnlyAccount.getBalance()
console.log('Sui balance:', balance, 'mists')

// Check the balance of another coin type
const tokenBalance = await readOnlyAccount.getTokenBalance('0x...::usdt::USDT')
console.log('Token balance:', tokenBalance)

// Note: a coin type is a fully qualified move type, not an address
// Make sure it names the package, the module and the struct
```

### Sending Transactions

Send sui and estimate fees using `WalletAccountSui`. A transaction is either a simple transfer or a transaction built with the Sui SDK.

```javascript
// Send sui
const result = await account.sendTransaction({
  to: '0x...', // Recipient address
  value: 1000000000n // 1 SUI in mists
})
console.log('Transaction digest:', result.hash)
console.log('Transaction fee:', result.fee, 'mists')

// OR build the transaction with the Sui SDK
import { Transaction } from '@mysten/sui/transactions'

const tx = new Transaction()
const [coin] = tx.splitCoins(tx.gas, [1000000000n])
tx.transferObjects([coin], '0x...')

const sdkResult = await account.sendTransaction(tx)

// Get transaction fee estimate
const quote = await account.quoteSendTransaction({
  to: '0x...',
  value: 1000000000n
})
console.log('Estimated fee:', quote.fee, 'mists')

// Sign now, send later: the signed transaction carries its bytes and signature
const signed = await account.signTransaction({ to: '0x...', value: 1000000000n })
const signedResult = await account.sendTransaction(signed)
```

### Token Transfers

Transfer any coin type and estimate fees using `WalletAccountSui`. The coins to send are selected and merged for you.

```javascript
// Transfer tokens
const transferResult = await account.transfer({
  token: '0x...::usdt::USDT', // Coin type
  recipient: '0x...',         // Recipient's address
  amount: 1000000n            // Amount in the coin's base units
})
console.log('Transfer digest:', transferResult.hash)
console.log('Transfer fee:', transferResult.fee, 'mists')

// Quote token transfer fee
const transferQuote = await account.quoteTransfer({
  token: '0x...::usdt::USDT', // Coin type
  recipient: '0x...',         // Recipient's address
  amount: 1000000n            // Amount in the coin's base units
})
console.log('Transfer fee estimate:', transferQuote.fee, 'mists')
```

### Message Signing and Verification

Sign messages using `WalletAccountSui` and verify signatures using `WalletAccountReadOnlySui`.

```javascript
// Sign a message
const message = 'Hello, Sui!'
const signature = await account.sign(message)
console.log('Signature:', signature)

// Verify a signature (can use read-only account)
const isValid = await readOnlyAccount.verify(message, signature)
console.log('Signature valid:', isValid)

// Verify a personal message signature, as produced by a wallet application.
// This is a different intent from `sign`, so a signature from one does not verify with the other.
const isPersonalValid = await readOnlyAccount.verifyPersonalMessage(message, walletSignature)
console.log('Personal message signature valid:', isPersonalValid)
```

### Fee Management

Retrieve current fee rates using `WalletManagerSui`. Sui prices gas in mists per gas unit, and the network sets a reference price every epoch.

```javascript
// Get current fee rates
const feeRates = await wallet.getFeeRates()
console.log('Normal fee rate:', feeRates.normal, 'mists per gas unit') // the reference gas price
console.log('Fast fee rate:', feeRates.fast, 'mists per gas unit')     // 2.0x the reference price
```

### Memory Management

Clear sensitive data from memory using `dispose` methods in `WalletAccountSui` and `WalletManagerSui`.

```javascript
// Dispose wallet accounts to clear private keys from memory
account.dispose()

// Dispose entire wallet manager
wallet.dispose()

// Note: the seed the wallet was created from is not erased, since it belongs to the caller
```

### Transaction Status and Finality

Read a normalized receipt for a transaction, or wait for it to reach the finality you need.

#### Reading a Receipt

```javascript
// Read a normalized receipt
const receipt = await readOnlyAccount.getTransaction(result.hash)
console.log('Finality:', receipt.finality)   // "confirmed" once executed, "final" once checkpointed
console.log('Succeeded:', receipt.success)
console.log('Checkpoint:', receipt.block)
console.log('Fee paid:', receipt.fee, 'mists')

// The native receipt is available too, on the `receipt` field
console.log('Gas used:', receipt.receipt.effects.gasUsed)

// For the whole native receipt, including balance changes, read it directly
const native = await readOnlyAccount.getTransactionReceipt(result.hash)
console.log('Balance changes:', native.balanceChanges)
```

#### Waiting for Finality

```javascript
// Wait for the transaction to be checkpointed
const finalReceipt = await readOnlyAccount.waitForTransaction(result.hash, {
  target: 'final', // Optional: "confirmed" (default) or "final"
  interval: 500,   // Optional: poll cadence in ms (default: 500)
  timeout: 30000   // Optional: time budget in ms (default: 30000)
})
console.log('Finality:', finalReceipt.finality)

// Note: Sui has no mempool, so a digest the node cannot resolve yet
// is reported as a missing transaction and the wait keeps polling
```

### Provider Failover

Serve several endpoints behind a single client. A call a node fails to answer is retried against the next one, which covers every request the module makes.

```javascript
import { WalletAccountReadOnlySui } from '@tetherto/wdk-wallet-sui'

const account = new WalletAccountReadOnlySui('0x...', {
  rpcUrl: [
    'https://fullnode.mainnet.sui.io:443',
    'https://sui-mainnet.example.com:443'
  ],
  retries: 3 // Optional: additional attempts after the first fails (default: 3)
})

// Fails over transparently: nothing changes at the call site
const balance = await account.getBalance()
```

## 📚 API Reference

### Table of Contents

| Class | Description | Methods |
|-------|-------------|---------|
| [WalletManagerSui](#walletmanagersui) | Main class for managing Sui wallets. Extends `WalletManager` from `@tetherto/wdk-wallet`. | [Constructor](#constructor), [Methods](#methods) |
| [WalletAccountSui](#walletaccountsui) | Individual Sui wallet account implementation. Extends `WalletAccountReadOnlySui` and implements `IWalletAccount` from `@tetherto/wdk-wallet`. | [Constructor](#constructor-1), [Methods](#methods-1), [Properties](#properties) |
| [WalletAccountReadOnlySui](#walletaccountreadonlysui) | Read-only Sui wallet account. Extends `WalletAccountReadOnly` from `@tetherto/wdk-wallet`. | [Constructor](#constructor-2), [Methods](#methods-2) |

### WalletManagerSui

The main class for managing Sui wallets.  
Extends `WalletManager` from `@tetherto/wdk-wallet`.

#### Constructor

```javascript
new WalletManagerSui(seed, config)
```

**Parameters:**
- `seed` (string | Uint8Array): BIP-39 mnemonic seed phrase or seed bytes
- `config` (object, optional): Configuration object
  - `rpcUrl` (string | string[], optional): Fullnode rpc url, or a list of them to enable failover
  - `network` (string, optional): Network name (default: `"mainnet"`)
  - `retries` (number, optional): Failover retry attempts when more than one provider is given (default: 3)
  - `transactionMaxFee` (number | bigint, optional): Maximum fee amount for sending transactions (in mists)
  - `transferMaxFee` (number | bigint, optional): Maximum fee amount for transfer operations (in mists)

**Example:**
```javascript
const wallet = new WalletManagerSui(seedPhrase, {
  rpcUrl: 'https://fullnode.mainnet.sui.io:443',
  transferMaxFee: 10000000 // Maximum fee in mists
})
```

#### Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `getAccount(index)` | Returns a wallet account at the specified index | `Promise<WalletAccountSui>` |
| `getAccountByPath(path)` | Returns a wallet account at the specified SLIP-0010 derivation path | `Promise<WalletAccountSui>` |
| `getFeeRates()` | Returns current fee rates, in mists per gas unit | `Promise<{normal: bigint, fast: bigint}>` |
| `dispose()` | Disposes all wallet accounts, clearing private keys from memory | `void` |

### WalletAccountSui

Represents an individual wallet account. Implements `IWalletAccount` from `@tetherto/wdk-wallet`.

#### Constructor

```javascript
new WalletAccountSui(seed, path, config)
```

**Parameters:**
- `seed` (string | Uint8Array): BIP-39 mnemonic seed phrase or seed bytes
- `path` (string): SLIP-0010 derivation path, three hardened segments (e.g., "0'/0'/0'")
- `config` (object, optional): Configuration object
  - `rpcUrl` (string | string[], optional): Fullnode rpc url, or a list of them to enable failover
  - `network` (string, optional): Network name (default: `"mainnet"`)
  - `retries` (number, optional): Failover retry attempts when more than one provider is given (default: 3)
  - `transactionMaxFee` (number | bigint, optional): Maximum fee amount for sending transactions (in mists)
  - `transferMaxFee` (number | bigint, optional): Maximum fee amount for transfer operations (in mists)

#### Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `getAddress()` | Returns the account's address | `Promise<string>` |
| `sign(message)` | Signs a message using the account's private key | `Promise<string>` |
| `signTransaction(tx)` | Signs a transaction, resolving it against the node first | `Promise<{bytes: string, signature: string}>` |
| `verify(message, signature)` | Verifies a message signature | `Promise<boolean>` |
| `verifyPersonalMessage(message, signature)` | Verifies a personal message signature | `Promise<boolean>` |
| `sendTransaction(tx)` | Sends a Sui transaction | `Promise<{hash: string, fee: bigint}>` |
| `quoteSendTransaction(tx)` | Estimates the fee for a Sui transaction | `Promise<{fee: bigint}>` |
| `transfer(options)` | Transfers a coin type to another address | `Promise<{hash: string, fee: bigint}>` |
| `quoteTransfer(options)` | Estimates the fee for a transfer | `Promise<{fee: bigint}>` |
| `getBalance()` | Returns the sui balance (in mists) | `Promise<bigint>` |
| `getTokenBalance(coinType)` | Returns the balance of a specific coin type | `Promise<bigint>` |
| `getTransaction(digest)` | Returns a normalized, finality-based receipt | `Promise<SuiTransactionReceipt>` |
| `getTransactionReceipt(digest)` | Returns the native receipt, or null if the transaction has not executed | `Promise<ExecutedTransaction \| null>` |
| `waitForTransaction(digest, options)` | Waits until a transaction reaches the requested finality | `Promise<SuiTransactionReceipt>` |
| `toReadOnlyAccount()` | Returns a read-only copy of the account | `Promise<WalletAccountReadOnlySui>` |
| `dispose()` | Disposes the wallet account, clearing the private key from memory | `void` |

##### `sendTransaction(tx)`
Sends a Sui transaction.

**Parameters:**
- `tx` (object): The transaction, in one of three forms
  - A simple transfer:
    - `to` (string): Recipient address
    - `value` (number | bigint): Amount in mists
  - A `Transaction` built with `@mysten/sui/transactions`
  - A signed transaction, as returned by `signTransaction`:
    - `bytes` (string): The base64 transaction bytes
    - `signature` (string): The base64 signature

**Returns:** `Promise<{hash: string, fee: bigint}>` - Object containing the transaction digest and the fee the node charged (in mists)

> The transaction is signed if it is not already, quoted against `transactionMaxFee`, and only then executed. The returned fee is read back from the execution rather than from the quote.

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `address` | `string` | The account's address |
| `index` | `number` | The derivation path's index of this account |
| `path` | `string` | The full derivation path of this account |
| `keyPair` | `object` | The account's key pair (⚠️ Contains sensitive data) |

⚠️ **Security Note**: The `keyPair` property contains sensitive cryptographic material. Never log, display, or expose the private key.

### WalletAccountReadOnlySui

Represents a read-only wallet account.

#### Constructor

```javascript
new WalletAccountReadOnlySui(address, config)
```

**Parameters:**
- `address` (string): The account's address
- `config` (object, optional): Configuration object
  - `rpcUrl` (string | string[], optional): Fullnode rpc url, or a list of them to enable failover
  - `network` (string, optional): Network name (default: `"mainnet"`)
  - `retries` (number, optional): Failover retry attempts when more than one provider is given (default: 3)
  - `transactionMaxFee` (number | bigint, optional): Maximum fee amount for sending transactions (in mists)

#### Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `getAddress()` | Returns the account's address | `Promise<string>` |
| `getBalance()` | Returns the sui balance (in mists) | `Promise<bigint>` |
| `getTokenBalance(coinType)` | Returns the balance of a specific coin type | `Promise<bigint>` |
| `quoteSendTransaction(tx)` | Estimates the fee for a Sui transaction | `Promise<{fee: bigint}>` |
| `quoteTransfer(options)` | Estimates the fee for a transfer | `Promise<{fee: bigint}>` |
| `getTransaction(digest)` | Returns a normalized, finality-based receipt | `Promise<SuiTransactionReceipt>` |
| `getTransactionReceipt(digest)` | Returns the native receipt, or null if the transaction has not executed | `Promise<ExecutedTransaction \| null>` |
| `waitForTransaction(digest, options)` | Waits until a transaction reaches the requested finality | `Promise<SuiTransactionReceipt>` |
| `verify(message, signature)` | Verifies a message signature | `Promise<boolean>` |
| `verifyPersonalMessage(message, signature)` | Verifies a personal message signature | `Promise<boolean>` |

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `address` | `string` | The account's address |
| `defaultWaitInterval` | `number` | The poll cadence of `waitForTransaction`, in milliseconds |
| `defaultWaitTimeout` | `number` | The time budget of `waitForTransaction`, in milliseconds |

## 🌐 Supported Networks

This package works with any Sui network, selected with the `network` option:

- **Sui Mainnet** (`mainnet`)
- **Sui Testnet** (`testnet`)
- **Sui Devnet** (`devnet`)
- **Sui Localnet** (`localnet`)

## 🔒 Security Considerations

- **Seed Phrase Security**: Always store your seed phrase securely and never share it
- **Private Key Management**: The package handles private keys internally with memory safety features
- **Provider Security**: Use trusted rpc endpoints and consider running your own fullnode for production
- **Transaction Validation**: Always validate transaction details before signing
- **Memory Cleanup**: Use the `dispose()` method to clear private keys from memory when done, and erase the seed on your own side
- **Fee Limits**: Set `transactionMaxFee` and `transferMaxFee` in config to prevent excessive fees
- **Coin Types**: Verify the coin type and its decimals before transfers, since a coin type names a package that anyone can publish
- **Finality**: Wait for `final` before treating a transfer as settled, rather than for the digest alone

## 🛠️ Development

### Building

```bash
# Install dependencies
npm install

# Build TypeScript definitions
npm run build:types

# Lint code
npm run lint

# Fix linting issues
npm run lint:fix
```

### Testing

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Run integration tests against a fullnode
npm run test:integration
```

## 📜 License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 🆘 Support

For support, please open an issue on the GitHub repository.

---

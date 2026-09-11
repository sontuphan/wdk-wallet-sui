/**
 * A sui wallet account. The read-only members are inherited from
 * {@link WalletAccountReadOnlySui}, this class adds the ones that need the
 * account's key.
 *
 * @implements {IWalletAccount}
 */
export default class WalletAccountSui extends WalletAccountReadOnlySui implements IWalletAccount {
    /**
     * Creates a new sui wallet account from a BIP-39 seed, deriving the account's
     * key at the given derivation path.
     *
     * @param {string | Uint8Array} seed - The BIP-39 seed phrase or raw seed bytes.
     * @param {string} path - The derivation path (e.g. "0'/0'/0'").
     * @param {SuiWalletConfig} [config] - The configuration object.
     * @throws {ValueError} If the seed or the path is not valid.
     */
    constructor(seed: string | Uint8Array, path: string, config?: SuiWalletConfig);
    /** @private */
    private _path;
    /**
     * The raw ed25519 private key (32 bytes), or undefined once the account has
     * been disposed. The signing keypair is rebuilt from it on demand, so the
     * account owns a single copy of the key material.
     *
     * @private
     * @type {Uint8Array | undefined}
     */
    private _rawPrivateKey;
    /**
     * The raw ed25519 public key (32 bytes).
     *
     * @private
     * @type {Uint8Array}
     */
    private _rawPublicKey;
    /**
     * The read-only copy of this account, created on the first call to
     * {@link toReadOnlyAccount}.
     *
     * @private
     * @type {WalletAccountReadOnlySui | undefined}
     */
    private _suiReadOnlyAccount;
    /**
     * The derivation path's index of this account.
     *
     * @type {number}
     */
    get index(): number;
    /**
     * The derivation path of this account (see [SLIP-0010](https://github.com/satoshilabs/slips/blob/master/slip-0010.md)).
     *
     * @type {string}
     */
    get path(): string;
    /**
     * The account's key pair.
     *
     * The uint8 arrays are bound to the wallet account, so any external change will reflect to the internal representation. For this reason,
     * it's strongly recommended to treat the key pair as a read-only view of the keys. While it's still technically possible to alter their
     * content, client code should never do so.
     *
     * @type {KeyPair}
     */
    get keyPair(): KeyPair;
    /**
     * Signs a message.
     *
     * The signature is serialized the way sui expects it, as the base64 of
     * `flag || signature || public key`, so it carries the key it is verified
     * against.
     *
     * @param {string} message - The message to sign.
     * @returns {Promise<string>} The message's signature.
     * @throws {AssertionError} If the account has been disposed.
     */
    sign(message: string): Promise<string>;
    /**
     * Signs a transaction.
     *
     * The transaction is resolved against the node first, so that what gets
     * signed is the transaction the node will execute, gas payment included.
     *
     * @param {SuiTransaction} tx - The transaction to sign.
     * @returns {Promise<SignatureWithBytes>} The signed transaction.
     * @throws {AssertionError} If the account has been disposed.
     */
    signTransaction(tx: SuiTransaction): Promise<SignatureWithBytes>;
    /**
     * Quotes the costs of a send transaction operation.
     *
     * @param {SuiTransaction | SignatureWithBytes} tx - The transaction, signed or not.
     * @returns {Promise<Omit<TransactionResult, 'hash'>>} The transaction's quotes.
     */
    quoteSendTransaction(tx: SuiTransaction | SignatureWithBytes): Promise<Omit<TransactionResult, "hash">>;
    /**
     * Sends a transaction.
     *
     * The transaction is signed if it isn't already, quoted, and only then
     * executed. The returned fee is the one the node charged, which the quote
     * doesn't know exactly.
     *
     * @param {SuiTransaction | SignatureWithBytes} tx - The transaction.
     * @returns {Promise<TransactionResult>} The transaction's result.
     * @throws {AssertionError} If the account has been disposed.
     * @throws {ProviderRequiredError} If the account is not connected to a provider.
     * @throws {ProviderError} If the provider fails to perform the transaction.
     * @throws {TransactionError} If the transaction fails to execute.
     * @throws {MaximumFeeExceededError} If the costs of the transaction exceed the transaction max. fee option.
     */
    sendTransaction(tx: SuiTransaction | SignatureWithBytes): Promise<TransactionResult>;
    /**
     * Transfers a token to another address.
     *
     * The transfer is signed once, so the transaction that is quoted against the
     * transfer's maximum fee is the one that executes.
     *
     * @param {SuiTransferOptions} options - The transfer's options.
     * @returns {Promise<TransferResult>} The transfer's result.
     * @throws {AssertionError} If the account has been disposed.
     * @throws {ProviderRequiredError} If the account is not connected to a provider.
     * @throws {TransferError} If the transfer fails to execute.
     * @throws {MaximumFeeExceededError} If the costs of the transfer exceed the transfer max. fee option.
     */
    transfer(options: SuiTransferOptions): Promise<TransferResult>;
    /**
     * Returns a read-only copy of the account.
     *
     * The copy is created once and reused, so that the account doesn't open a
     * connection to the provider on every call.
     *
     * @returns {Promise<WalletAccountReadOnlySui>} The read-only account.
     */
    toReadOnlyAccount(): Promise<WalletAccountReadOnlySui>;
    /**
     * Disposes the wallet account, erasing the private key from the memory.
     */
    dispose(): void;
}
export type IWalletAccount = import("@tetherto/wdk-wallet").IWalletAccount;
export type KeyPair = import("@tetherto/wdk-wallet").KeyPair;
export type TransactionResult = import("@tetherto/wdk-wallet").TransactionResult;
export type TransferResult = import("@tetherto/wdk-wallet").TransferResult;
export type SignatureWithBytes = import("@mysten/sui/cryptography").SignatureWithBytes;
export type SuiTransaction = import("./wallet-account-read-only-sui.js").SuiTransaction;
export type SuiTransferOptions = import("./wallet-account-read-only-sui.js").SuiTransferOptions;
export type SuiWalletConfig = import("./wallet-account-read-only-sui.js").SuiWalletConfig;
import WalletAccountReadOnlySui from './wallet-account-read-only-sui.js';

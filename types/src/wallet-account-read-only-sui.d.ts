/**
 * Turns an error raised while resolving, simulating or executing a transaction
 * into the matching wallet development kit error.
 *
 * @param {*} error - The error thrown by the sdk.
 * @returns {ValueError | ProviderError | TransactionError} The wallet development kit error.
 */
export function toTransactionError(error: any): ValueError | ProviderError | TransactionError;
/**
 * Turns an error raised while quoting or performing a transfer into the
 * matching wallet development kit error. A transaction that cannot execute is
 * reported as the transfer it was carrying out.
 *
 * @param {*} error - The error raised by the transfer.
 * @returns {WdkError} The wallet development kit error.
 */
export function toTransferError(error: any): WdkError;
/**
 * Turns an error thrown by the grpc client into the matching wallet development
 * kit error. An invalid argument is rejected on the caller's behalf and never
 * reaches the ledger, so it is reported as a value error rather than as a
 * failure of the provider.
 *
 * @param {*} error - The error thrown by the grpc client.
 * @returns {ValueError | ProviderError} The wallet development kit error.
 */
export function toClientError(error: any): ValueError | ProviderError;
export default class WalletAccountReadOnlySui extends WalletAccountReadOnly {
    /**
     * Creates the client a wallet talks to a node through.
     *
     * @param {SuiWalletConfig} config - The configuration object.
     * @returns {SuiGrpcClient | undefined} The client, or undefined if the configuration names no provider.
     */
    static createClient(config: SuiWalletConfig): SuiGrpcClient | undefined;
    /**
     * Creates a new sui read-only wallet account.
     *
     * @param {string} address - The account's address.
     * @param {Omit<SuiWalletConfig, 'transferMaxFee'>} [config] - The configuration object.
     */
    constructor(address: string, config?: Omit<SuiWalletConfig, "transferMaxFee">);
    /**
     * The read-only wallet account configuration.
     *
     * @protected
     * @type {Omit<SuiWalletConfig, 'transferMaxFee'>}
     */
    protected _config: Omit<SuiWalletConfig, "transferMaxFee">;
    /**
     * A sui client to interact with a node of the blockchain.
     *
     * @protected
     * @type {SuiGrpcClient | undefined}
     */
    protected _client: SuiGrpcClient | undefined;
    /**
     * The account's address.
     *
     * @type {string}
     */
    get address(): string;
    /**
     * Quotes the costs of a send transaction operation.
     *
     * @param {SuiTransaction} tx - The transaction.
     * @returns {Promise<Omit<TransactionResult, 'hash'>>} The transaction's quotes.
     * @throws {ValueError} If the transaction is not valid.
     * @throws {ProviderRequiredError} If the account is not connected to a provider.
     * @throws {ProviderError} If the provider fails to estimate the costs of the transaction.
     * @throws {TransactionError} If the transaction fails to execute.
     */
    quoteSendTransaction(tx: SuiTransaction): Promise<Omit<TransactionResult, "hash">>;
    /**
     * Returns a transaction's receipt.
     *
     * @deprecated Use {@link getTransaction} instead, which returns a normalized, finality-based receipt. The native receipt stays available on the `receipt` field of its return value.
     * @param {string} hash - The transaction's digest.
     * @returns {Promise<ExecutedTransaction | null>} The receipt, or null if the transaction has not been executed yet.
     * @throws {ValueError} If the digest is not valid.
     * @throws {ProviderRequiredError} If the account is not connected to a provider.
     * @throws {ProviderError} If the provider fails to fetch the transaction's receipt.
     */
    getTransactionReceipt(hash: string): Promise<ExecutedTransaction | null>;
    /**
     * Returns a normalized, finality-based receipt for a transaction.
     *
     * A sui transaction is only observable once it has been executed, and it
     * cannot be reverted afterwards: it is reported as `confirmed` as soon as the
     * node returns its effects, and as `final` once it is part of a checkpoint.
     * Sui has no mempool, so `pending` and `dropped` are never reported: a digest
     * the node cannot resolve yet is reported as a missing transaction.
     *
     * @param {string} hash - The transaction's digest.
     * @returns {Promise<SuiTransactionReceipt>} The normalized receipt.
     * @throws {ValueError} If the digest is not valid.
     * @throws {NoSuchElementError} If no transaction has been found for the given digest.
     * @throws {ProviderRequiredError} If the account is not connected to a provider.
     * @throws {ProviderError} If the provider fails to fetch the transaction.
     */
    getTransaction(hash: string): Promise<SuiTransactionReceipt>;
    /**
     * Verifies a personal message's signature.
     *
     * @param {string} message - The personal message.
     * @param {string} signature - The signature to verify.
     * @returns {Promise<boolean>} True if the signature is valid.
     * @throws {ValueError} If the signature is not correctly encoded.
     */
    verifyPersonalMessage(message: string, signature: string): Promise<boolean>;
    /**
     * Builds the transaction a transfer is carried out with.
     *
     * @protected
     * @param {SuiTransferOptions} options - The transfer's options.
     * @returns {Promise<Transaction>} The transfer's transaction.
     * @throws {ValueError} If the transfer options are not valid.
     */
    protected _getTransferTransaction(options: SuiTransferOptions): Promise<Transaction>;
    /**
     * Resolves a transaction into the bytes that are simulated, signed and
     * executed.
     *
     * A {@link SimpleSuiTransaction} is first turned into the sui send it
     * describes, and a transaction that doesn't name its sender is sent from this
     * account, which sets the sender on the given transaction.
     *
     * Resolving is a round trip to the provider rather than a local encoding
     * step: the node runs the transaction to pick the gas coins and set the gas
     * price and budget, which is why a transaction that cannot execute is
     * reported here.
     *
     * @protected
     * @param {SuiTransaction} tx - The transaction.
     * @returns {Promise<Uint8Array>} The bcs-encoded transaction.
     * @throws {ValueError} If the transaction is not valid.
     * @throws {ProviderRequiredError} If the account is not connected to a provider.
     * @throws {ProviderError} If the provider fails to resolve the transaction.
     * @throws {TransactionError} If the transaction cannot execute.
     */
    protected _buildTransaction(tx: SuiTransaction): Promise<Uint8Array>;
}
export type TransactionReceipt = import("@tetherto/wdk-wallet").TransactionReceipt;
export type TransactionResult = import("@tetherto/wdk-wallet").TransactionResult;
export type TransferResult = import("@tetherto/wdk-wallet").TransferResult;
export type Network = import("@mysten/sui/client").SuiClientTypes.Network;
export type RpcTransport = import("@protobuf-ts/runtime-rpc").RpcTransport;
export type ExecutedTransaction = import("@mysten/sui/grpc").GrpcTypes.ExecutedTransaction;
export type SimpleSuiTransaction = {
    /**
     * - The transaction's recipient.
     */
    to: string;
    /**
     * - The amount of suis to send to the recipient (in mists).
     */
    value: number | bigint;
};
export type SuiTransaction = SimpleSuiTransaction | Transaction;
export type SuiTransferOptions = {
    /**
     * - The address of the token to transfer.
     */
    token: string;
    /**
     * - The address of the recipient.
     */
    recipient: string;
    /**
     * - The amount of tokens to transfer to the recipient (in base units).
     */
    amount: number | bigint;
};
export type SuiWalletConfig = {
    /**
     * - The provider's rpc url.
     */
    rpcUrl?: string;
    /**
     * - A grpc transport to talk to the provider through, used instead of the one built from `rpcUrl`.
     */
    transport?: RpcTransport;
    /**
     * - The name of the network to use (default: "mainnet").
     */
    network?: Network;
    /**
     * - The maximum fee amount for sending transactions.
     */
    transactionMaxFee?: number | bigint;
    /**
     * - The maximum fee amount for transfer operations.
     */
    transferMaxFee?: number | bigint;
};
/**
 * The sui fields added to a normalized transaction receipt.
 */
export type SuiReceiptFields = {
    /**
     * - The execution's result. Always known, since a sui transaction is only observable once executed.
     */
    success: boolean;
    /**
     * - The gas cost (in mists).
     */
    fee: bigint;
    /**
     * - The sequence number of the checkpoint including the transaction, as returned by the node.
     */
    checkpoint?: bigint;
    /**
     * - The unix timestamp of the checkpoint including the transaction (in milliseconds).
     */
    timestamp?: number;
    /**
     * - The native executed transaction.
     */
    receipt: ExecutedTransaction;
};
/**
 * A sui transaction receipt: the normalized, cross-chain fields plus sui's native ones.
 */
export type SuiTransactionReceipt = TransactionReceipt & SuiReceiptFields;
import { ValueError } from '@tetherto/wdk-wallet';
import { ProviderError } from '@tetherto/wdk-wallet';
import { TransactionError } from '@tetherto/wdk-wallet';
import { WdkError } from '@tetherto/wdk-wallet';
import { WalletAccountReadOnly } from '@tetherto/wdk-wallet';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';

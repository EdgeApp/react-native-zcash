use once_cell::sync::Lazy;
use tokio::runtime::Runtime;

use crate::wallet;

static RT: Lazy<Runtime> = Lazy::new(|| Runtime::new().expect("tokio runtime"));

#[derive(Debug, thiserror::Error)]
pub enum ZcashError {
    #[error("{message}")]
    Internal { message: String },
}

fn map<T>(value: wallet::WalletResult<T>) -> Result<T, ZcashError> {
    value.map_err(|message| ZcashError::Internal { message })
}

fn block_on<F: std::future::Future>(future: F) -> F::Output {
    RT.block_on(future)
}

pub fn set_document_directory(path: String) -> Result<(), ZcashError> {
    map(wallet::set_document_directory(path))
}

pub fn initialize(
    mnemonic_seed: String,
    birthday_height: u32,
    alias: String,
    network_name: String,
    default_host: String,
    default_port: u32,
    new_wallet: bool,
) -> Result<(), ZcashError> {
    map(block_on(wallet::initialize(
        mnemonic_seed,
        birthday_height,
        alias,
        network_name,
        default_host,
        default_port,
        new_wallet,
    )))
}

pub fn stop(alias: String) -> Result<String, ZcashError> {
    map(block_on(wallet::stop(alias)))
}

pub fn rescan(alias: String) -> Result<(), ZcashError> {
    map(block_on(wallet::rescan(alias)))
}

pub fn derive_unified_address(alias: String) -> Result<wallet::Addresses, ZcashError> {
    map(block_on(wallet::derive_unified_address(alias)))
}

pub fn get_latest_network_height(alias: String) -> Result<u32, ZcashError> {
    map(block_on(wallet::get_latest_network_height(alias)))
}

pub fn get_birthday_height(host: String, port: u32) -> Result<u32, ZcashError> {
    map(block_on(wallet::get_birthday_height(host, port)))
}

pub fn is_valid_address(address: String, network: String) -> bool {
    wallet::is_valid_address(address, network)
}

pub fn derive_viewing_key(mnemonic_seed: String, network: String) -> Result<String, ZcashError> {
    map(wallet::derive_viewing_key(mnemonic_seed, network))
}

pub fn ironwood_activation_height(network: String) -> Option<u32> {
    wallet::ironwood_activation_height(network)
}

pub fn poll(alias: String) -> Result<wallet::Poll, ZcashError> {
    map(block_on(wallet::poll(alias)))
}

pub fn propose_transfer(
    alias: String,
    zatoshi: String,
    to_address: String,
    memo: Option<String>,
) -> Result<String, ZcashError> {
    map(block_on(wallet::propose_transfer(
        alias, zatoshi, to_address, memo,
    )))
}

pub fn create_transfer(
    alias: String,
    proposal_base64: String,
    mnemonic_seed: String,
) -> Result<String, ZcashError> {
    map(block_on(wallet::create_transfer(
        alias,
        proposal_base64,
        mnemonic_seed,
    )))
}

pub fn broadcast_transfer(alias: String, txid: String) -> Result<String, ZcashError> {
    map(block_on(wallet::broadcast_transfer(alias, txid)))
}

pub fn shield_funds(
    alias: String,
    seed: String,
    memo: String,
    threshold: String,
) -> Result<String, ZcashError> {
    map(block_on(wallet::shield_funds(
        alias, seed, memo, threshold,
    )))
}

pub fn propose_orchard_to_ironwood_migration(alias: String) -> Result<String, ZcashError> {
    map(block_on(wallet::propose_orchard_to_ironwood_migration(
        alias,
    )))
}

pub fn propose_fulfilling_payment_uri(
    alias: String,
    payment_uri: String,
) -> Result<String, ZcashError> {
    map(block_on(wallet::propose_fulfilling_payment_uri(
        alias,
        payment_uri,
    )))
}

pub fn emit_existing_transactions(alias: String) -> Result<(), ZcashError> {
    map(block_on(wallet::emit_existing_transactions(alias)))
}

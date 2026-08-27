//! Headless sync control for real-device testing (temporary test tooling).
//!
//! Drives the exact library code paths the Tauri commands use —
//! `sync_crypto_state` (bootstrap/unlock/ladder), `blob_sync`, and the core
//! `SyncEngine` — against the real app data dir, the real iCloud container,
//! and the real keychain. No GUI, no event emission.
//!
//! Usage: cargo run --release --example syncctl -- <command> [args]

use chatshell_agent_core::sync::{SyncEngine, SyncOutcome};
use chatshell_desktop_lib::sync_crypto_state;

const APP_DATA: &str = "/Users/sean/Library/Application Support/app.chatshell.desktop";
const CONTAINER: &str = "/Users/sean/Library/Mobile Documents/iCloud~app~chatshell";

fn app_data() -> std::path::PathBuf {
    std::path::PathBuf::from(APP_DATA)
}

fn cloud() -> std::path::PathBuf {
    std::path::PathBuf::from(CONTAINER)
}

fn db_path() -> std::path::PathBuf {
    app_data().join("data.db")
}

fn cache_dir() -> std::path::PathBuf {
    let dir = std::path::PathBuf::from("/tmp/chatshell-syncctl-cache");
    std::fs::create_dir_all(&dir).ok();
    dir
}

fn settings() -> sync_crypto_state::SyncSettings {
    sync_crypto_state::load_settings(&app_data())
}

fn engine(crypto: chatshell_agent_core::sync_crypto::SyncCrypto) -> Result<SyncEngine, String> {
    SyncEngine::new(&db_path(), cloud(), cache_dir(), Some(crypto))
        .map_err(|e| format!("engine: {e:#}"))
}

fn outcome_line(tag: &str, out: &SyncOutcome) {
    println!(
        "{tag}: action={} rows_merged={} republished={}",
        out.action, out.rows_merged, out.republished
    );
}

fn enable_settings() {
    let mut s = settings();
    s.enabled = true;
    s.onboarded = true;
    s.needs_unlock = false;
    sync_crypto_state::save_settings(&app_data(), &s).unwrap();
}

fn chain() -> Option<chatshell_agent_core::sync_crypto::SyncCrypto> {
    std::fs::read(sync_crypto_state::chain_cache_path(&app_data()))
        .ok()
        .and_then(|b| chatshell_agent_core::sync_crypto::SyncCrypto::decode_state(&b).ok())
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cmd = args.first().map(String::as_str).unwrap_or("help");
    match cmd {
        "peek" => {
            let path = cloud().join("snapshot.db.enc");
            let artifact = std::fs::read(&path).expect("read artifact");
            let (h, payload) =
                chatshell_agent_core::sync_crypto::split_artifact(&artifact).unwrap();
            let state = chain().expect("chain");
            let zst = chatshell_agent_core::sync_crypto::decrypt_snapshot_payload(
                state.keys(), &h, payload,
            )
            .expect("decrypt");
            println!("zst len={}", zst.len());
            match zstd::stream::decode_all(&zst[..]) {
                Ok(plain) => println!(
                    "plain len={} head={:?}",
                    plain.len(),
                    String::from_utf8_lossy(&plain[..48.min(plain.len())])
                ),
                Err(e) => println!("zstd decode FAILED: {e}"),
            }
        }
        "initdb" => {
            // Create the schema exactly as the app does on first launch.
            let _db = chatshell_desktop_lib::db::Database::new(db_path().to_str().unwrap())
                .await
                .expect("db init");
            println!("db initialized at {}", db_path().display());
        }
        "bootstrap" => {
            // args: bootstrap <passphrase> — mirrors complete_sync_onboarding.
            let passphrase = args[1].clone();
            let crypto = sync_crypto_state::bootstrap_group(&app_data(), &passphrase)
                .map_err(|e| format!("bootstrap: {e:#}"))
                .unwrap();
            let mut eng = engine(crypto).unwrap();
            let out = eng.sync_now().expect("first pass");
            outcome_line("bootstrap publish", &out);
            enable_settings();
        }
        "join-silent" => {
            // The graded ladder without any passphrase (try_join_sync path).
            match sync_crypto_state::resolve_content_key(&app_data(), &cloud(), &settings()) {
                sync_crypto_state::CkResolution::Ready(crypto) => {
                    let mut eng = engine(crypto).unwrap();
                    let out = eng.sync_now().expect("join pass");
                    outcome_line("join-silent", &out);
                    enable_settings();
                }
                other => println!("join-silent: ladder said {other:?}"),
            }
        }
        "join-passphrase" => {
            // args: join-passphrase <passphrase> — mirrors unlock_sync.
            let passphrase = args[1].clone();
            let crypto =
                sync_crypto_state::unlock_with_passphrase(&app_data(), &cloud(), &passphrase)
                    .map_err(|e| format!("unlock: {e:#}"))
                    .unwrap();
            let mut eng = engine(crypto).unwrap();
            let out = eng.sync_now().expect("join pass");
            outcome_line("join-passphrase", &out);
            eng.publish().expect("post-join publish");
            enable_settings();
        }
        "pass" => {
            // One scheduler-tick-equivalent pass with the resolved ladder,
            // including the blob upload the tick performs first.
            match sync_crypto_state::resolve_content_key(&app_data(), &cloud(), &settings()) {
                sync_crypto_state::CkResolution::Ready(crypto) => {
                    if let Some(state) = chain() {
                        let keys = state.keys().clone();
                        let db = chatshell_desktop_lib::db::Database::new(
                            db_path().to_str().unwrap(),
                        )
                        .await
                        .expect("db");
                        let attach = app_data().join("attachments");
                        match chatshell_desktop_lib::blob_sync::ensure_referenced_blobs_uploaded(
                            &db,
                            &cloud(),
                            &attach,
                            &keys,
                        )
                        .await
                        {
                            Ok(n) => println!("blob upload: {n} new"),
                            Err(e) => println!("blob upload failed: {e:#}"),
                        }
                    }
                    let mut eng = engine(crypto).unwrap();
                    let out = eng.sync_now().expect("pass");
                    outcome_line("pass", &out);
                }
                other => println!("pass: ladder said {other:?}"),
            }
        }
        "rotate" => {
            // args: rotate <passphrase> — mirrors rotate_sync_key + republish.
            let passphrase = args[1].clone();
            let crypto = sync_crypto_state::rotate_content_key(&app_data(), &cloud(), &passphrase)
                .map_err(|e| format!("rotate: {e:#}"))
                .unwrap();
            println!("rotated to v{}", crypto.keys().current_version());
            let mut eng = engine(crypto).unwrap();
            eng.publish().expect("post-rotation publish");
            println!("republished under the rotated key");
        }
        "inspect" => {
            let path = cloud().join("snapshot.db.enc");
            let header =
                chatshell_agent_core::sync_crypto::read_artifact_header(&path).expect("header");
            println!(
                "artifact: sync_version={} schema={} key_version={} slots={} icloud_marker={} bytes={}",
                header.sync_version,
                header.schema_version,
                header.key_version,
                header.slots.len(),
                header.icloud_slot,
                std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0)
            );
            if let Some(state) = chain()
                && let Ok(artifact) = std::fs::read(&path)
                && let Ok((h, payload)) =
                    chatshell_agent_core::sync_crypto::split_artifact(&artifact)
            {
                match chatshell_agent_core::sync_crypto::decrypt_snapshot_payload(
                    state.keys(), &h, payload,
                ) {
                    Ok(zst) => {
                        let plain = zstd::stream::decode_all(&zst[..]).expect("zstd");
                        let dir = std::env::temp_dir().join("syncctl-inspect.db");
                        std::fs::write(&dir, plain).unwrap();
                        let conn = rusqlite::Connection::open_with_flags(
                            &dir,
                            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
                        )
                        .unwrap();
                        let q = |sql: &str| -> i64 {
                            conn.query_row(sql, [], |r| r.get(0)).unwrap_or(-1)
                        };
                        println!(
                            "snapshot content: conversations={} messages={} files={}",
                            q("SELECT COUNT(*) FROM conversations WHERE deleted_at IS NULL"),
                            q("SELECT COUNT(*) FROM messages WHERE deleted_at IS NULL"),
                            q("SELECT COUNT(*) FROM files WHERE deleted_at IS NULL AND content_hash IS NOT NULL"),
                        );
                    }
                    Err(e) => println!("decrypt failed: {e}"),
                }
            } else {
                println!("(no local chain cache — header only)");
            }
        }
        "dbstats" => {
            let conn = rusqlite::Connection::open_with_flags(
                db_path(),
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
            )
            .expect("db");
            let q = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap_or(-1) };
            println!(
                "local db: conversations={} messages={}",
                q("SELECT COUNT(*) FROM conversations WHERE deleted_at IS NULL"),
                q("SELECT COUNT(*) FROM messages WHERE deleted_at IS NULL"),
            );
        }
        "blobs" => {
            let dir = cloud().join("blobs");
            let n = std::fs::read_dir(&dir).map(|d| d.count()).unwrap_or(0);
            println!("container blobs: {n}");
        }
        "chain" => match chain() {
            Some(state) => println!("chain current v{} slots={}", state.keys().current_version(), state.slots_for_publish().len()),
            None => println!(
                "no chain cache at {}",
                sync_crypto_state::chain_cache_path(&app_data()).display()
            ),
        },
        _ => {
            println!(
                "commands: bootstrap <pw> | join-silent | join-passphrase <pw> | pass | \n\
                 rotate <pw> | inspect | dbstats | blobs | chain"
            );
        }
    }
}

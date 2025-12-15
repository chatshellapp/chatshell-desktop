use anyhow::Result;
use std::path::PathBuf;
use std::sync::Arc;
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::{
    EnvFilter, Registry,
    fmt::{self, format::FmtSpan},
    layer::SubscriberExt,
    reload,
    util::SubscriberInitExt,
};

// Global handle for runtime log level changes
type ReloadHandle = reload::Handle<EnvFilter, Registry>;

static LOG_HANDLE: once_cell::sync::OnceCell<Arc<ReloadHandle>> = once_cell::sync::OnceCell::new();

pub fn init_logger(log_dir: PathBuf) -> Result<()> {
    std::fs::create_dir_all(&log_dir)?;

    let file_appender =
        RollingFileAppender::new(Rotation::DAILY, log_dir.clone(), "chatshell-backend");

    let console_layer = fmt::layer()
        .with_target(true)
        .with_thread_ids(false)
        .with_thread_names(false)
        .with_span_events(FmtSpan::NONE)
        .with_writer(std::io::stdout);

    let file_layer = fmt::layer()
        .with_target(true)
        .with_thread_ids(true)
        .with_ansi(false)
        .with_span_events(FmtSpan::CLOSE)
        .with_writer(file_appender);

    // Create reloadable filter
    let env_filter = EnvFilter::try_from_default_env()
        .or_else(|_| EnvFilter::try_new("info"))
        .unwrap();

    let (filter, reload_handle) = reload::Layer::new(env_filter);

    // Store the reload handle globally
    LOG_HANDLE
        .set(Arc::new(reload_handle))
        .map_err(|_| anyhow::anyhow!("Logger already initialized"))?;

    tracing_subscriber::registry()
        .with(filter)
        .with(console_layer)
        .with(file_layer)
        .init();

    tracing::info!("Logger initialized successfully");
    tracing::info!("Log directory: {:?}", log_dir);

    Ok(())
}

/// Set log level at runtime
pub fn set_log_level(level: &str) -> Result<()> {
    let filter = match level {
        "trace" => EnvFilter::try_new("trace")?,
        "debug" => EnvFilter::try_new("debug")?,
        "info" => EnvFilter::try_new("info")?,
        "warn" => EnvFilter::try_new("warn")?,
        "error" => EnvFilter::try_new("error")?,
        _ => return Err(anyhow::anyhow!("Invalid log level: {}", level)),
    };

    if let Some(handle) = LOG_HANDLE.get() {
        handle.reload(filter)?;
        tracing::info!("Log level changed to: {}", level);
        Ok(())
    } else {
        Err(anyhow::anyhow!("Logger not initialized"))
    }
}

/// Get current log level from settings
pub async fn load_log_level_from_db(db: &crate::db::Database) -> Result<String> {
    let level = db
        .get_setting("log_level_rust")
        .await?
        .unwrap_or_else(|| "info".to_string());
    Ok(level)
}

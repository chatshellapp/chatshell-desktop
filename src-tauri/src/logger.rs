use anyhow::Result;
use chrono::Local;
use std::fs::{File, OpenOptions};
use std::io::Write as IoWrite;
use std::path::{Path, PathBuf};
use std::sync::Arc;
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

/// Daily file appender that rolls at LOCAL midnight.
///
/// tracing-appender's `Rotation::DAILY` names files by UTC date, so for
/// non-UTC users the file rotates at (UTC midnight + offset) and the file
/// name does not match the local day. This appender keeps the same
/// `prefix.YYYY-MM-DD` naming but computes the date in the local zone.
struct DailyLocalAppender {
    dir: PathBuf,
    prefix: &'static str,
    current_date: String,
    file: Option<File>,
}

impl DailyLocalAppender {
    fn new(dir: PathBuf, prefix: &'static str) -> Self {
        Self {
            dir,
            prefix,
            current_date: String::new(),
            file: None,
        }
    }

    fn file_for_today(&mut self) -> std::io::Result<&mut File> {
        let today = Local::now().format("%Y-%m-%d").to_string();
        if self.file.is_none() || self.current_date != today {
            let path = self.dir.join(format!("{}.{}", self.prefix, today));
            let mut file = OpenOptions::new().create(true).append(true).open(&path)?;
            // Mark the rotation inside the file itself. Never emit tracing
            // events from here: the writer runs on the subscriber's dispatch
            // path while holding this appender's mutex, so a re-entrant
            // event self-deadlocks.
            let _ = writeln!(file, "=== log file rotated: {} ===", today);
            self.current_date = today;
            self.file = Some(file);
        }
        Ok(self.file.as_mut().expect("file was just set"))
    }
}

impl IoWrite for DailyLocalAppender {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.file_for_today()?.write(buf)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        match &mut self.file {
            Some(file) => file.flush(),
            None => Ok(()),
        }
    }

    fn by_ref(&mut self) -> &mut Self {
        self
    }
}

/// Build the file-layer writer: a mutex-wrapped daily local appender.
/// `tracing_subscriber` implements `MakeWriter` for `Mutex<W: io::Write>`.
fn make_local_writer(log_dir: &Path) -> std::sync::Mutex<DailyLocalAppender> {
    std::sync::Mutex::new(DailyLocalAppender::new(
        log_dir.to_path_buf(),
        "chatshell-backend",
    ))
}

pub fn init_logger(log_dir: PathBuf) -> Result<()> {
    std::fs::create_dir_all(&log_dir)?;

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
        .with_writer(make_local_writer(&log_dir));

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

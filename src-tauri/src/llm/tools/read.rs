//! Read tool for LLM agents
//!
//! A general-purpose file reading tool. Supports text files with line numbers,
//! image files (PNG, JPEG, GIF, WebP) with metadata and base64 encoding,
//! and PDF files with text extraction.

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use rig::{completion::ToolDefinition, tool::Tool};
use serde::{Deserialize, Serialize};
use serde_json::json;

const DEFAULT_LINE_LIMIT: usize = 2000;
const MAX_LINE_LENGTH: usize = 2000;
const BINARY_CHECK_SIZE: usize = 8192;
const MAX_IMAGE_SIZE: u64 = 20 * 1024 * 1024; // 20 MB

#[derive(Debug, Clone, Deserialize)]
pub struct ReadArgs {
    /// Absolute path to the file to read
    pub path: String,
    /// Line number to start reading from. Positive values are 1-indexed from
    /// the start; negative values count backwards from the end (e.g. -10 reads
    /// the last 10 lines). Defaults to 1.
    #[serde(default)]
    pub offset: Option<i64>,
    /// Number of lines to read. Defaults to 2000.
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Debug, thiserror::Error)]
#[error("Read error: {0}")]
pub struct ReadError(String);

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ReadTool;

impl ReadTool {
    pub fn new() -> Self {
        Self
    }
}

// ---------------------------------------------------------------------------
// File-type detection helpers
// ---------------------------------------------------------------------------

fn is_image_extension(ext: &str) -> bool {
    matches!(
        ext,
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "ico" | "svg"
    )
}

fn is_pdf_extension(ext: &str) -> bool {
    ext == "pdf"
}

fn mime_from_extension(ext: &str) -> &str {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

/// Parse image dimensions from raw bytes without external dependencies.
fn parse_image_dimensions(bytes: &[u8], ext: &str) -> Option<(u32, u32)> {
    match ext {
        "png" => parse_png_dimensions(bytes),
        "jpg" | "jpeg" => parse_jpeg_dimensions(bytes),
        "gif" => parse_gif_dimensions(bytes),
        "webp" => parse_webp_dimensions(bytes),
        "bmp" => parse_bmp_dimensions(bytes),
        _ => None,
    }
}

fn parse_png_dimensions(b: &[u8]) -> Option<(u32, u32)> {
    // PNG: bytes 16..20 = width, 20..24 = height (big-endian u32 in IHDR)
    if b.len() >= 24 && &b[..8] == b"\x89PNG\r\n\x1a\n" {
        let w = u32::from_be_bytes([b[16], b[17], b[18], b[19]]);
        let h = u32::from_be_bytes([b[20], b[21], b[22], b[23]]);
        Some((w, h))
    } else {
        None
    }
}

fn parse_jpeg_dimensions(b: &[u8]) -> Option<(u32, u32)> {
    if b.len() < 2 || b[0] != 0xFF || b[1] != 0xD8 {
        return None;
    }
    let mut i = 2;
    while i + 4 < b.len() {
        if b[i] != 0xFF {
            i += 1;
            continue;
        }
        let marker = b[i + 1];
        if marker == 0xD9 {
            break;
        }
        // SOF markers: 0xC0..=0xCF except 0xC4 (DHT) and 0xCC (DAC)
        if (0xC0..=0xCF).contains(&marker) && marker != 0xC4 && marker != 0xCC
            && i + 9 < b.len() {
                let h = u16::from_be_bytes([b[i + 5], b[i + 6]]) as u32;
                let w = u16::from_be_bytes([b[i + 7], b[i + 8]]) as u32;
                return Some((w, h));
            }
        let seg_len = u16::from_be_bytes([b[i + 2], b[i + 3]]) as usize;
        i += 2 + seg_len;
    }
    None
}

fn parse_gif_dimensions(b: &[u8]) -> Option<(u32, u32)> {
    // GIF: bytes 6..8 = width, 8..10 = height (little-endian u16)
    if b.len() >= 10 && (&b[..6] == b"GIF87a" || &b[..6] == b"GIF89a") {
        let w = u16::from_le_bytes([b[6], b[7]]) as u32;
        let h = u16::from_le_bytes([b[8], b[9]]) as u32;
        Some((w, h))
    } else {
        None
    }
}

fn parse_webp_dimensions(b: &[u8]) -> Option<(u32, u32)> {
    if b.len() < 30 || &b[..4] != b"RIFF" || &b[8..12] != b"WEBP" {
        return None;
    }
    let chunk = &b[12..16];
    if chunk == b"VP8 " && b.len() >= 30 {
        // Lossy VP8: dimensions at offset 26..30
        let w = (u16::from_le_bytes([b[26], b[27]]) & 0x3FFF) as u32;
        let h = (u16::from_le_bytes([b[28], b[29]]) & 0x3FFF) as u32;
        Some((w, h))
    } else if chunk == b"VP8L" && b.len() >= 25 {
        // Lossless VP8L: packed bits at offset 21
        let bits = u32::from_le_bytes([b[21], b[22], b[23], b[24]]);
        let w = (bits & 0x3FFF) + 1;
        let h = ((bits >> 14) & 0x3FFF) + 1;
        Some((w, h))
    } else {
        None
    }
}

fn parse_bmp_dimensions(b: &[u8]) -> Option<(u32, u32)> {
    // BMP: bytes 18..22 = width, 22..26 = height (little-endian i32)
    if b.len() >= 26 && &b[..2] == b"BM" {
        let w = i32::from_le_bytes([b[18], b[19], b[20], b[21]]).unsigned_abs();
        let h = i32::from_le_bytes([b[22], b[23], b[24], b[25]]).unsigned_abs();
        Some((w, h))
    } else {
        None
    }
}

fn format_file_size(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{} B", bytes)
    } else if bytes < 1024 * 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    }
}

// ---------------------------------------------------------------------------
// Tool implementation
// ---------------------------------------------------------------------------

impl Tool for ReadTool {
    const NAME: &'static str = "read";

    type Error = ReadError;
    type Args = ReadArgs;
    type Output = String;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: "read".to_string(),
            description: "Read the contents of a file from the filesystem. \
                For text files, returns content with line numbers. \
                For image files (PNG, JPEG, GIF, WebP, BMP), returns metadata and base64-encoded data. \
                For PDF files, extracts and returns the text content. \
                Supports reading specific line ranges for large text files. \
                Use negative offset to read from the end of a file (e.g. -20 reads the last 20 lines)."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute path to the file to read"
                    },
                    "offset": {
                        "type": "number",
                        "description": "Line number to start reading from. Positive values are 1-indexed from the start. Negative values count from the end (e.g. -10 reads the last 10 lines). Defaults to 1. Only applies to text files."
                    },
                    "limit": {
                        "type": "number",
                        "description": "Maximum number of lines to read. Defaults to 2000. Only applies to text files."
                    }
                },
                "required": ["path"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        tracing::info!(
            "🔧 [tool-call] read: path=\"{}\" offset={:?} limit={:?}",
            args.path,
            args.offset,
            args.limit
        );

        let path = std::path::Path::new(&args.path);
        if !path.exists() {
            return Err(ReadError(format!("File not found: {}", args.path)));
        }
        if path.is_dir() {
            return Err(ReadError(format!(
                "Path is a directory, not a file: {}. \
                 Use the glob tool to list files or the bash tool with ls \
                 to explore directory contents.",
                args.path
            )));
        }
        if !path.is_file() {
            return Err(ReadError(format!("Not a regular file: {}", args.path)));
        }

        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        // Dispatch by file type
        if is_image_extension(&ext) {
            return read_image(path, &ext);
        }
        if is_pdf_extension(&ext) {
            return read_pdf(path);
        }

        read_text(path, &args)
    }
}

/// Read a text file with line numbers and offset/limit support.
fn read_text(path: &std::path::Path, args: &ReadArgs) -> Result<String, ReadError> {
    let raw_bytes =
        std::fs::read(path).map_err(|e| ReadError(format!("Failed to read file: {}", e)))?;

    let check_len = raw_bytes.len().min(BINARY_CHECK_SIZE);
    if raw_bytes[..check_len].contains(&0) {
        return Err(ReadError(format!(
            "Binary file detected, cannot read as text: {}",
            args.path
        )));
    }

    let content = String::from_utf8(raw_bytes)
        .map_err(|_| ReadError(format!("File is not valid UTF-8: {}", args.path)))?;

    let lines: Vec<&str> = content.lines().collect();
    let total_lines = lines.len();
    let limit = args.limit.unwrap_or(DEFAULT_LINE_LIMIT);

    // Resolve offset (supports negative values)
    let start_idx = match args.offset {
        Some(off) if off < 0 => {
            // Negative: count from end. -1 means last line, -10 means last 10 lines.
            let from_end = (-off) as usize;
            total_lines.saturating_sub(from_end)
        }
        Some(off) => {
            let off = off.max(1) as usize;
            (off - 1).min(total_lines)
        }
        None => 0,
    };

    let end_idx = (start_idx + limit).min(total_lines);
    let selected = &lines[start_idx..end_idx];

    let mut output = String::new();

    for (i, line) in selected.iter().enumerate() {
        let line_num = start_idx + i + 1;
        let display_line = if line.len() > MAX_LINE_LENGTH {
            format!("{}... (truncated)", &line[..MAX_LINE_LENGTH])
        } else {
            line.to_string()
        };
        output.push_str(&format!("{:>6}\t{}\n", line_num, display_line));
    }

    if end_idx < total_lines {
        output.push_str(&format!(
            "\n... ({} more lines, {} total)",
            total_lines - end_idx,
            total_lines
        ));
    }

    tracing::info!(
        "🔧 [tool-result] read: returned {} lines from \"{}\" (total: {})",
        selected.len(),
        args.path,
        total_lines
    );

    Ok(output)
}

/// Read an image file: return metadata and base64-encoded data.
fn read_image(path: &std::path::Path, ext: &str) -> Result<String, ReadError> {
    let metadata = path
        .metadata()
        .map_err(|e| ReadError(format!("Failed to read image metadata: {}", e)))?;

    let file_size = metadata.len();
    if file_size > MAX_IMAGE_SIZE {
        return Err(ReadError(format!(
            "Image too large ({}, max {})",
            format_file_size(file_size),
            format_file_size(MAX_IMAGE_SIZE)
        )));
    }

    let raw_bytes =
        std::fs::read(path).map_err(|e| ReadError(format!("Failed to read image: {}", e)))?;

    let mime = mime_from_extension(ext);

    let dims = parse_image_dimensions(&raw_bytes, ext);
    let dim_str = dims
        .map(|(w, h)| format!("{}x{}", w, h))
        .unwrap_or_else(|| "unknown".to_string());

    // SVG files are text-based; return content directly instead of base64
    if ext == "svg" {
        let svg_text = String::from_utf8_lossy(&raw_bytes);
        tracing::info!(
            "🔧 [tool-result] read: SVG image \"{}\" ({})",
            path.display(),
            format_file_size(file_size)
        );
        return Ok(format!(
            "[Image: SVG, {}]\n\n{}",
            format_file_size(file_size),
            svg_text
        ));
    }

    let b64 = BASE64.encode(&raw_bytes);

    tracing::info!(
        "🔧 [tool-result] read: image \"{}\" ({}, {}, {})",
        path.display(),
        ext.to_uppercase(),
        dim_str,
        format_file_size(file_size)
    );

    Ok(format!(
        "[Image: {}, {}, {}]\ndata:{};base64,{}",
        ext.to_uppercase(),
        dim_str,
        format_file_size(file_size),
        mime,
        b64
    ))
}

/// Read a PDF file by extracting its text content.
fn read_pdf(path: &std::path::Path) -> Result<String, ReadError> {
    let text = pdf_extract::extract_text(path)
        .map_err(|e| ReadError(format!("Failed to extract PDF text: {}", e)))?;

    if text.trim().is_empty() {
        return Ok("[PDF] No extractable text found (the PDF may contain only images).".into());
    }

    let line_count = text.lines().count();

    tracing::info!(
        "🔧 [tool-result] read: PDF \"{}\" ({} lines extracted)",
        path.display(),
        line_count
    );

    Ok(format!("[PDF: {} lines extracted]\n\n{}", line_count, text))
}

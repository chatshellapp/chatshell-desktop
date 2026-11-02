use crate::language_detect::{self, LanguageDetection};

/// Detects the dominant language of translation input. Runs locally; no
/// network or model involved.
#[tauri::command]
pub fn detect_language(text: String) -> LanguageDetection {
    language_detect::detect_language(&text)
}

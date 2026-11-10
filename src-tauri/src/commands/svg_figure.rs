//! Inline SVG figures: the Tauri surface over `chatshell_agent_core::svg_figure`.
//!
//! The frontend hands each ```svg fence body to [`prepare_svg_figure`] and
//! renders the result as an isolated `<img>`; the visual-output prompt
//! offers figures only while [`RENDER_SVG_FIGURES_SETTING`] is on.
//! Design: `internal-docs/features/svg-figures.md` and
//! `internal-docs/features/visual-output-formats.md`.

use crate::db::Database;
use chatshell_agent_core::svg_figure as core;
use serde::{Deserialize, Serialize};

/// Settings key: `"false"` turns figures off; anything else (or unset) is on.
pub const RENDER_SVG_FIGURES_SETTING: &str = "render_svg_figures";

/// Theme colors a figure's `var(--name)` tokens resolve to.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SvgPaletteInput {
    pub fg: String,
    pub muted: String,
    pub border: String,
    pub surface: String,
    pub accent: String,
    pub success: String,
    pub warning: String,
    pub error: String,
    pub is_dark: bool,
}

#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SvgPrepareOptionsInput {
    #[serde(default)]
    pub streaming: bool,
    #[serde(default)]
    pub strip_animation: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedSvgOutput {
    pub svg: String,
    pub width: f64,
    pub height: f64,
    pub animated: bool,
    pub removed: u32,
}

/// Failure the frontend can branch on: `incomplete` / `empty` while
/// streaming mean "keep waiting", anything else falls back to code.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SvgFigureErrorOutput {
    pub kind: &'static str,
    pub message: String,
}

impl From<core::SvgFigureError> for SvgFigureErrorOutput {
    fn from(error: core::SvgFigureError) -> Self {
        let kind = match &error {
            core::SvgFigureError::Incomplete => "incomplete",
            core::SvgFigureError::Parse(_) => "parse",
            core::SvgFigureError::NoRoot => "noRoot",
            core::SvgFigureError::TooLarge => "tooLarge",
            core::SvgFigureError::Empty => "empty",
        };
        Self {
            kind,
            message: error.to_string(),
        }
    }
}

/// Repair (when streaming), theme, sanitize and size a ```svg fence body.
#[tauri::command]
pub fn prepare_svg_figure(
    source: String,
    palette: SvgPaletteInput,
    options: SvgPrepareOptionsInput,
) -> Result<PreparedSvgOutput, SvgFigureErrorOutput> {
    let palette = core::SvgPalette {
        fg: palette.fg,
        muted: palette.muted,
        border: palette.border,
        surface: palette.surface,
        accent: palette.accent,
        success: palette.success,
        warning: palette.warning,
        error: palette.error,
        is_dark: palette.is_dark,
    };
    let options = core::PrepareOptions {
        streaming: options.streaming,
        strip_animation: options.strip_animation,
    };
    let prepared = core::prepare_svg_figure(&source, &palette, &options)?;
    Ok(PreparedSvgOutput {
        svg: prepared.svg,
        width: prepared.width,
        height: prepared.height,
        animated: prepared.animated,
        removed: prepared.removed,
    })
}

/// Whether the user leaves SVG figures on (default: on).
pub(crate) async fn svg_figures_enabled(db: &Database) -> bool {
    !matches!(
        db.get_setting(RENDER_SVG_FIGURES_SETTING).await,
        Ok(Some(value)) if value == "false"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn palette() -> SvgPaletteInput {
        SvgPaletteInput {
            fg: "#111111".into(),
            muted: "#777777".into(),
            border: "#dddddd".into(),
            surface: "#f4f4f4".into(),
            accent: "#2563eb".into(),
            success: "#16a34a".into(),
            warning: "#d97706".into(),
            error: "#dc2626".into(),
            is_dark: false,
        }
    }

    #[test]
    fn prepares_and_reports_error_kinds() {
        let ok = prepare_svg_figure(
            r#"<svg viewBox="0 0 20 10"><rect width="1" height="1" fill="var(--accent)"/></svg>"#
                .into(),
            palette(),
            SvgPrepareOptionsInput::default(),
        )
        .expect("prepares");
        assert_eq!((ok.width, ok.height), (20.0, 10.0));
        assert!(ok.svg.contains("#2563eb"));

        let streaming = prepare_svg_figure(
            "<svg viewBox=\"0 0".into(),
            palette(),
            SvgPrepareOptionsInput {
                streaming: true,
                strip_animation: false,
            },
        )
        .expect_err("incomplete");
        assert_eq!(streaming.kind, "incomplete");
    }
}

//! The visual-output system-prompt fragment for desktop: which formats the
//! model may use, built by `chatshell_agent_core::visual_output` from what
//! this client renders and what the user turned on.
//! Design: `internal-docs/features/visual-output-formats.md` and
//! `internal-docs/features/openui-blocks.md`.

use crate::db::Database;
use chatshell_agent_core::visual_output::{VisualCapabilities, visual_output_prompt};

use super::svg_figures_enabled;

/// Settings key: `"false"` turns OpenUI chart and KPI blocks off; anything
/// else (or unset) leaves them on. The library section adds about 600
/// prompt tokens to every request.
pub const RENDER_OPENUI_BLOCKS_SETTING: &str = "render_openui_blocks";

/// Whether the user leaves OpenUI blocks on (default: on).
pub(crate) async fn openui_blocks_enabled(db: &Database) -> bool {
    !matches!(
        db.get_setting(RENDER_OPENUI_BLOCKS_SETTING).await,
        Ok(Some(value)) if value == "false"
    )
}

/// The capabilities desktop offers. Mermaid and KaTeX math always render;
/// SVG figures and OpenUI blocks follow the user settings.
pub(crate) fn desktop_capabilities(svg_figures: bool, openui_blocks: bool) -> VisualCapabilities {
    VisualCapabilities {
        svg: svg_figures,
        mermaid: true,
        math: true,
        openui: openui_blocks,
    }
}

/// The visual-output fragment for the current settings.
pub(crate) async fn visual_output_instructions(db: &Database) -> String {
    let caps = desktop_capabilities(
        svg_figures_enabled(db).await,
        openui_blocks_enabled(db).await,
    );
    visual_output_prompt(&caps)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_always_offers_mermaid_and_math() {
        for svg in [false, true] {
            for openui in [false, true] {
                let prompt = visual_output_prompt(&desktop_capabilities(svg, openui));
                assert!(prompt.contains("```mermaid"));
                assert!(prompt.contains("$$...$$"));
                assert_eq!(prompt.contains("```svg"), svg);
                assert_eq!(prompt.contains("```openui-lang"), openui);
            }
        }
    }
}

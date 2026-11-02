//! On-device language detection for the translation page.
//!
//! Detection only suggests a translation direction, so it favors reporting
//! "uncertain" over guessing: callers fall back to the user's last choice.

use regex::Regex;
use serde::Serialize;
use std::sync::LazyLock;
use whatlang::{Lang, Script};

/// Only the first part of long inputs is inspected; it is enough to tell the
/// dominant language and keeps detection instant while typing.
const MAX_SAMPLE_CHARS: usize = 2000;
/// whatlang confidence below this is reported as uncertain. whatlang scores
/// clear one-sentence English around 0.3-0.5, while ambiguous 2-5 word inputs
/// score below 0.2; a wrong guess only changes the highlighted button.
const MIN_CONFIDENCE: f64 = 0.3;
/// Latin-script samples shorter than this many words are reported as uncertain.
const MIN_LATIN_WORDS: usize = 3;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LanguageDetection {
    /// Translation-language code (e.g. `ja`, `zh-Hant`, `pt`), or `None` when
    /// the language is unsupported or nothing could be detected.
    pub language: Option<String>,
    pub confidence: f64,
    /// Whether the result is trustworthy enough to drive the default button.
    pub reliable: bool,
}

impl LanguageDetection {
    fn unknown() -> Self {
        Self {
            language: None,
            confidence: 0.0,
            reliable: false,
        }
    }
}

static FENCED_CODE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)```.*?(```|$)|~~~.*?(~~~|$)").unwrap());
static INLINE_CODE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"`[^`\n]*`").unwrap());
static MARKDOWN_LINK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"!?\[([^\]]*)\]\([^)]*\)").unwrap());
static URL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(?:https?://|www\.)\S+|\S+@\S+\.\S+").unwrap());
static HTML_TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"</?[A-Za-z][^>]*>").unwrap());
static MARKDOWN_SYNTAX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)^\s{0,3}(?:#{1,6}|>|[-*+]|\d+[.)])\s+|[*_~|]+").unwrap());

/// Removes code, URLs and Markdown/HTML syntax so only prose is analyzed.
fn clean_text(text: &str) -> String {
    let sample: String = text.chars().take(MAX_SAMPLE_CHARS).collect();
    let text = FENCED_CODE.replace_all(&sample, " ");
    let text = INLINE_CODE.replace_all(&text, " ");
    let text = MARKDOWN_LINK.replace_all(&text, "$1");
    let text = URL.replace_all(&text, " ");
    let text = HTML_TAG.replace_all(&text, " ");
    MARKDOWN_SYNTAX.replace_all(&text, " ").into_owned()
}

/// Languages the translation page supports; detection is restricted to these
/// so near neighbors outside the list (e.g. Norwegian vs Danish) cannot win.
const SUPPORTED: &[Lang] = &[
    Lang::Ara,
    Lang::Cmn,
    Lang::Ces,
    Lang::Dan,
    Lang::Nld,
    Lang::Eng,
    Lang::Fin,
    Lang::Fra,
    Lang::Deu,
    Lang::Hin,
    Lang::Ind,
    Lang::Ita,
    Lang::Jpn,
    Lang::Kor,
    Lang::Pol,
    Lang::Por,
    Lang::Rus,
    Lang::Spa,
    Lang::Swe,
    Lang::Tha,
    Lang::Tur,
    Lang::Ukr,
    Lang::Vie,
];

static DETECTOR: LazyLock<whatlang::Detector> =
    LazyLock::new(|| whatlang::Detector::with_allowlist(SUPPORTED.to_vec()));

fn map_lang(lang: Lang) -> Option<&'static str> {
    Some(match lang {
        Lang::Ara => "ar",
        Lang::Cmn => "zh",
        Lang::Ces => "cs",
        Lang::Dan => "da",
        Lang::Nld => "nl",
        Lang::Eng => "en",
        Lang::Fin => "fi",
        Lang::Fra => "fr",
        Lang::Deu => "de",
        Lang::Hin => "hi",
        Lang::Ind => "id",
        Lang::Ita => "it",
        Lang::Jpn => "ja",
        Lang::Kor => "ko",
        Lang::Pol => "pl",
        // whatlang cannot tell regional variants apart; the frontend resolves
        // `pt` against the user's languages.
        Lang::Por => "pt",
        Lang::Rus => "ru",
        Lang::Spa => "es",
        Lang::Swe => "sv",
        Lang::Tha => "th",
        Lang::Tur => "tr",
        Lang::Ukr => "uk",
        Lang::Vie => "vi",
        _ => return None,
    })
}

const SIMPLIFIED_ONLY: &[u32] = &[
    0x4E07, 0x4E0E, 0x4E1A, 0x4E1C, 0x4E2A, 0x4E3A, 0x4E48, 0x4E66, 0x4E70, 0x4EA7, 0x4EEC, 0x4F1A,
    0x4F53, 0x5173, 0x5199, 0x51C6, 0x52A1, 0x52A8, 0x533A, 0x534E, 0x5355, 0x5356, 0x53D1, 0x5458,
    0x56FD, 0x573A, 0x5904, 0x5907, 0x5934, 0x5B66, 0x5B9E, 0x5BF9, 0x5E2E, 0x5E94, 0x5F00, 0x5F20,
    0x62A5, 0x636E, 0x6570, 0x65E0, 0x65F6, 0x663E, 0x673A, 0x6765, 0x6837, 0x6B22, 0x6C14, 0x70B9,
    0x7231, 0x73B0, 0x7535, 0x79CD, 0x7EA7, 0x7EBF, 0x7ECF, 0x7EDF, 0x7F51, 0x89C1, 0x89C8, 0x8BA1,
    0x8BA4, 0x8BA9, 0x8BB0, 0x8BBE, 0x8BC6, 0x8BDD, 0x8BE5, 0x8BED, 0x8BF4, 0x8BF7, 0x8C22, 0x8F66,
    0x8F6F, 0x8F93, 0x8FB9, 0x8FC7, 0x8FD8, 0x8FD9, 0x8FDB, 0x9009, 0x94B1, 0x94F6, 0x957F, 0x95E8,
    0x95EE, 0x96BE, 0x9875, 0x9884, 0x9898,
];

const TRADITIONAL_ONLY: &[u32] = &[
    0x4F86, 0x500B, 0x5011, 0x5099, 0x52D5, 0x52D9, 0x5340, 0x54E1, 0x554F, 0x55AE, 0x570B, 0x5831,
    0x5834, 0x5B78, 0x5BE6, 0x5BEB, 0x5C0D, 0x5E6B, 0x5F35, 0x611B, 0x61C9, 0x64DA, 0x6578, 0x6642,
    0x66F8, 0x6703, 0x6771, 0x696D, 0x6A23, 0x6A5F, 0x6B61, 0x6C23, 0x6E96, 0x70BA, 0x7121, 0x73FE,
    0x7522, 0x767C, 0x7A2E, 0x7D1A, 0x7D71, 0x7D93, 0x7DB2, 0x7DDA, 0x8207, 0x83EF, 0x842C, 0x8655,
    0x898B, 0x89BD, 0x8A08, 0x8A18, 0x8A2D, 0x8A71, 0x8A72, 0x8A8D, 0x8A9E, 0x8AAA, 0x8ACB, 0x8B1D,
    0x8B58, 0x8B93, 0x8CB7, 0x8CE3, 0x8ECA, 0x8EDF, 0x8F38, 0x9019, 0x9032, 0x904E, 0x9078, 0x9084,
    0x908A, 0x9280, 0x9322, 0x9577, 0x9580, 0x958B, 0x95DC, 0x96E3, 0x96FB, 0x9801, 0x9810, 0x982D,
    0x984C, 0x986F, 0x9AD4, 0x9EBC, 0x9EDE,
];

/// Picks the Chinese script by counting characters unique to each one.
fn chinese_variant(text: &str) -> &'static str {
    let (mut simplified, mut traditional) = (0usize, 0usize);
    for c in text.chars() {
        let code = c as u32;
        if SIMPLIFIED_ONLY.binary_search(&code).is_ok() {
            simplified += 1;
        } else if TRADITIONAL_ONLY.binary_search(&code).is_ok() {
            traditional += 1;
        }
    }
    if traditional > simplified {
        "zh-Hant"
    } else {
        "zh-Hans"
    }
}

fn latin_word_count(text: &str) -> usize {
    text.split(|c: char| !c.is_alphabetic())
        .filter(|w| !w.is_empty())
        .count()
}

/// Detects the dominant language of `text`.
pub fn detect_language(text: &str) -> LanguageDetection {
    let cleaned = clean_text(text);
    if cleaned.trim().is_empty() {
        return LanguageDetection::unknown();
    }
    let Some(info) = DETECTOR.detect(&cleaned) else {
        return LanguageDetection::unknown();
    };

    let confidence = info.confidence();
    let language = map_lang(info.lang()).map(|code| match code {
        "zh" => chinese_variant(&cleaned).to_string(),
        other => other.to_string(),
    });
    let enough_text =
        info.script() != Script::Latin || latin_word_count(&cleaned) >= MIN_LATIN_WORDS;
    let reliable =
        language.is_some() && enough_text && (info.is_reliable() || confidence >= MIN_CONFIDENCE);

    LanguageDetection {
        language,
        confidence,
        reliable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ZH_HANS: &str = "\u{6211}\u{4EEC}\u{8FD9}\u{4E2A}\u{95EE}\u{9898}\u{73B0}\u{5728}\u{8FD8}\u{6CA1}\u{6709}\u{89E3}\u{51B3}\u{FF0C}\u{8BF7}\u{5E2E}\u{6211}\u{770B}\u{4E00}\u{4E0B}\u{3002}";
    const ZH_HANT: &str = "\u{6211}\u{5011}\u{9019}\u{500B}\u{554F}\u{984C}\u{73FE}\u{5728}\u{9084}\u{6C92}\u{6709}\u{89E3}\u{6C7A}\u{FF0C}\u{8ACB}\u{5E6B}\u{6211}\u{770B}\u{4E00}\u{4E0B}\u{3002}";
    const JA: &str = "\u{3053}\u{306E}\u{554F}\u{984C}\u{306F}\u{307E}\u{3060}\u{89E3}\u{6C7A}\u{3057}\u{3066}\u{3044}\u{307E}\u{305B}\u{3093}\u{3002}\u{78BA}\u{8A8D}\u{3057}\u{3066}\u{304F}\u{3060}\u{3055}\u{3044}\u{3002}";
    const KO: &str = "\u{C774} \u{BB38}\u{C81C}\u{B294} \u{C544}\u{C9C1} \u{D574}\u{ACB0}\u{B418}\u{C9C0} \u{C54A}\u{C558}\u{C2B5}\u{B2C8}\u{B2E4}. \u{D655}\u{C778}\u{D574} \u{C8FC}\u{C138}\u{C694}.";

    fn detected(text: &str) -> (Option<String>, bool) {
        let result = detect_language(text);
        (result.language, result.reliable)
    }

    #[test]
    fn tables_are_sorted_and_disjoint() {
        assert!(SIMPLIFIED_ONLY.windows(2).all(|w| w[0] < w[1]));
        assert!(TRADITIONAL_ONLY.windows(2).all(|w| w[0] < w[1]));
        assert!(
            SIMPLIFIED_ONLY
                .iter()
                .all(|c| TRADITIONAL_ONLY.binary_search(c).is_err())
        );
    }

    #[test]
    fn detects_common_languages() {
        assert_eq!(
            detected("Could you send me the updated design spec before Friday?"),
            (Some("en".into()), true)
        );
        assert_eq!(
            detected("Pourriez-vous m'envoyer la version mise à jour avant vendredi ?"),
            (Some("fr".into()), true)
        );
        assert_eq!(
            detected("I think we should ship it tomorrow"),
            (Some("en".into()), true)
        );
        assert_eq!(
            detected("Gracias por tu ayuda con el proyecto."),
            (Some("es".into()), true)
        );
        assert_eq!(detected(JA), (Some("ja".into()), true));
        assert_eq!(detected(KO), (Some("ko".into()), true));
    }

    #[test]
    fn distinguishes_chinese_scripts() {
        assert_eq!(detected(ZH_HANS).0.as_deref(), Some("zh-Hans"));
        assert_eq!(detected(ZH_HANT).0.as_deref(), Some("zh-Hant"));
    }

    #[test]
    fn ignores_code_urls_and_markdown() {
        let text = format!(
            "## {ZH_HANS}\n\n```rust\nfn main() {{ println!(\"hello world from the code block\"); }}\n```\n\n- `npm install` https://example.com/docs/getting-started"
        );
        assert_eq!(detected(&text).0.as_deref(), Some("zh-Hans"));
    }

    #[test]
    fn reports_short_latin_text_as_uncertain() {
        for text in ["Hello there", "please review", "Thanks, that works for me."] {
            assert!(!detected(text).1, "{text} should be uncertain");
        }
    }

    #[test]
    fn reports_empty_and_code_only_input_as_unknown() {
        assert_eq!(detect_language("   ").language, None);
        assert_eq!(detect_language("```\nlet x = 1;\n```").language, None);
        assert_eq!(detect_language("https://example.com").language, None);
    }
}

use jieba_rs::Jieba;
use lazy_static::lazy_static;

lazy_static! {
    static ref JIEBA: Jieba = Jieba::new();
}

/// Tokenize text for indexing in FTS. Uses search mode for overlapping segments
/// (e.g. "机器学习" -> ["机器", "学习", "机器学习"]) for maximum recall.
pub fn tokenize_for_search(text: &str) -> String {
    JIEBA
        .cut_for_search(text, true)
        .into_iter()
        .filter(|s| !s.trim().is_empty())
        .collect::<Vec<&str>>()
        .join(" ")
}

/// Tokenize search query the same way so MATCH works against indexed content.
pub fn tokenize_query(query: &str) -> String {
    JIEBA
        .cut_for_search(query, true)
        .into_iter()
        .filter(|s| !s.trim().is_empty())
        .collect::<Vec<&str>>()
        .join(" ")
}

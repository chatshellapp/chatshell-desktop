//! Layer-4 vision read-back eval for snapcompact archives: prove that the
//! model the archive was built for can actually retrieve facts planted in
//! the imaged middle (never in the verbatim text edges).
//!
//! Test-only; excluded from normal runs. Run with:
//!
//! ```sh
//! CHATSHELL_EVAL_PROVIDER=custom_anthropic \
//! CHATSHELL_EVAL_MODEL=MiniMax-M3.1-Flash-Preview \
//! CHATSHELL_EVAL_API_KEY=... \
//! CHATSHELL_EVAL_BASE_URL=https://api.minimaxi.com/anthropic \
//! cargo test --lib snapcompact_vision_readback_eval -- --ignored --nocapture
//! ```
//!
//! Env contract:
//! - `CHATSHELL_EVAL_PROVIDER`  provider_type string (drives shape + billing family)
//! - `CHATSHELL_EVAL_MODEL`     model id
//! - `CHATSHELL_EVAL_API_KEY`   required (app DB keys are encrypted; not readable here)
//! - `CHATSHELL_EVAL_BASE_URL`  optional when the provider type hardcodes one
//! - `CHATSHELL_EVAL_API_STYLE` optional (e.g. `chat_completions`)
//! - `CHATSHELL_EVAL_PASS_FLOOR` optional; default 3 of 4 facts
//! - `CHATSHELL_EVAL_BASELINE=1` optional control arm: same questions over
//!   the plain-text transcript (no images) to separate model vision from
//!   question quality.
//! - `CHATSHELL_EVAL_SOFT=1` optional comparison arm: the same reader model
//!   first summarizes the transcript with the production soft-compaction
//!   prompts, then answers from the summary alone (frames vs soft A/B).

use anyhow::{Context, Result, anyhow};

use super::compaction;
use chatshell_agent_core::snapcompact::{
    self, FontKind, SnapcompactArchive, archive_token_estimate, billing_family,
};

struct EvalConfig {
    provider: String,
    model: String,
    api_key: String,
    base_url: Option<String>,
    api_style: Option<String>,
    pass_floor: usize,
    baseline: bool,
    soft_arm: bool,
}

impl EvalConfig {
    fn from_env() -> Result<Self> {
        let provider = std::env::var("CHATSHELL_EVAL_PROVIDER")
            .map_err(|_| anyhow!("CHATSHELL_EVAL_PROVIDER is required"))?;
        let model = std::env::var("CHATSHELL_EVAL_MODEL")
            .map_err(|_| anyhow!("CHATSHELL_EVAL_MODEL is required"))?;
        let api_key = std::env::var("CHATSHELL_EVAL_API_KEY")
            .map_err(|_| anyhow!("CHATSHELL_EVAL_API_KEY is required"))?;
        Ok(Self {
            provider,
            model,
            api_key,
            base_url: std::env::var("CHATSHELL_EVAL_BASE_URL").ok(),
            api_style: std::env::var("CHATSHELL_EVAL_API_STYLE").ok(),
            pass_floor: std::env::var("CHATSHELL_EVAL_PASS_FLOOR")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(3),
            baseline: std::env::var("CHATSHELL_EVAL_BASELINE").as_deref() == Ok("1"),
            soft_arm: std::env::var("CHATSHELL_EVAL_SOFT").as_deref() == Ok("1"),
        })
    }
}

struct Fact {
    /// Line context around the answer as planted in the transcript.
    line: String,
    /// The scored substring (compared case-insensitively).
    answer: &'static str,
    question: &'static str,
}

/// ~26 pages x 40 lines; facts planted on pages 3/9/15/21, well inside the
/// imaged middle for every shipped shape (text edges hold ~2 pages).
fn fixture_transcript() -> (String, Vec<Fact>) {
    let auth = "AUTH: handler auth-refresh failed with error code 0X0F42A19 (retryable)";
    let payment = "BILLING: charge settled, payment reference ZTR-0042-KK90";
    let manifest = "PACK: wrote manifest /tmp/sc-eval/manifest-7.json (7 frames)";
    let rollout = "FLAGS: rollout tag VX-K9-0042 recorded for inline-imaging";
    let facts = vec![
        Fact {
            line: auth.to_string(),
            answer: "0X0F42A19",
            question: "What error code did the auth handler report?",
        },
        Fact {
            line: payment.to_string(),
            answer: "ZTR-0042-KK90",
            question: "What payment reference appears in the billing result?",
        },
        Fact {
            line: manifest.to_string(),
            answer: "/tmp/sc-eval/manifest-7.json",
            question: "What manifest file path did the packaging step write under /tmp?",
        },
        Fact {
            line: rollout.to_string(),
            answer: "VX-K9-0042",
            question: "What rollout tag was recorded for the feature flag?",
        },
    ];
    let fact_pages = [3, 9, 15, 21];

    let mut lines: Vec<String> = Vec::new();
    for page in 0..26 {
        for line in 0..40 {
            if let Some(slot) = fact_pages.iter().position(|p| *p == page)
                && line == 20
            {
                lines.push(facts[slot].line.clone());
                continue;
            }
            // Mix dim-wrapped tool noise in so frames exercise dim ink.
            if page % 3 == 0 && line % 5 == 0 {
                lines.push(format!("\u{000e}tool noise p{page} l{line} cached\u{000f}"));
            } else if page % 2 == 0 {
                lines.push(format!(
                    "User: question about step {page}-{line} of the migration"
                ));
            } else {
                lines.push(format!(
                    "Assistant: step {page}-{line} verified, continuing"
                ));
            }
        }
    }
    (lines.join("\n"), facts)
}

fn questions_header(source_hint: &str) -> String {
    format!(
        "Using ONLY the archived conversation above ({source_hint}), answer these \
         questions. Reply with strictly valid JSON and nothing else, no markdown fences: \
         {{\"answers\": [\"...\", \"...\", \"...\", \"...\"]}} — one string per question, in order."
    )
}

fn judge_system_prompt() -> String {
    "You are an extraction engine over archived conversation transcripts. \
     You read bitmap image frames of pixel-font text verbatim and answer \
     strictly in the requested JSON format."
        .to_string()
}

async fn ask_model(
    config: &EvalConfig,
    system_prompt: String,
    user_content: String,
    images: Vec<crate::llm::ImageData>,
) -> Result<String> {
    let messages = vec![
        crate::llm::ChatMessage {
            role: "system".to_string(),
            content: system_prompt,
            images: vec![],
            files: vec![],
            tool_calls: vec![],
            tool_call_id: None,
            tool_result_call_id: None,
            reasoning_content: None,
        },
        crate::llm::ChatMessage {
            role: "user".to_string(),
            content: user_content,
            images,
            files: vec![],
            tool_calls: vec![],
            tool_call_id: None,
            tool_result_call_id: None,
            reasoning_content: None,
        },
    ];
    let response = crate::llm::call_provider(
        &config.provider,
        config.model.clone(),
        messages,
        Some(config.api_key.clone()),
        config.base_url.clone(),
        config.api_style.clone(),
    )
    .await
    .context("provider call failed")?;
    Ok(response.content)
}

/// Parse the model reply and score each fact by case-insensitive
/// containment. Falls back to scanning the raw reply when the model wraps
/// the JSON in prose or fences.
fn score_reply(reply: &str, facts: &[Fact]) -> Vec<bool> {
    let mut answers: Vec<String> = Vec::new();
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(reply.trim())
        && let Some(array) = value.get("answers").and_then(|v| v.as_array())
    {
        answers = array
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
    }
    facts
        .iter()
        .enumerate()
        .map(|(i, fact)| {
            let expected = fact.answer.to_lowercase();
            if let Some(answer) = answers.get(i)
                && answer.to_lowercase().contains(&expected)
            {
                return true;
            }
            // Fallback: scan the whole reply (models sometimes add prose).
            reply.to_lowercase().contains(&expected)
        })
        .collect()
}

fn print_scores(arm: &str, facts: &[Fact], scores: &[bool]) {
    println!("== {arm} ==");
    for (fact, passed) in facts.iter().zip(scores.iter()) {
        println!(
            "  [{}] {} -> expected {:?}",
            if *passed { "PASS" } else { "FAIL" },
            fact.question,
            fact.answer
        );
    }
    println!(
        "  score: {}/{} (floor applies to the frames arm)",
        scores.iter().filter(|p| **p).count(),
        scores.len()
    );
}

fn archive_summary_line(archive: &SnapcompactArchive, provider: &str) -> String {
    let family = billing_family(provider);
    format!(
        "shape={} frames={} billed-token estimate={} chars_dropped={}",
        archive.shape,
        archive.frames.len(),
        archive_token_estimate(archive, family),
        archive.chars_dropped
    )
}

async fn run_readback_eval() -> Result<()> {
    let config = EvalConfig::from_env()?;
    let (transcript, facts) = fixture_transcript();

    let archive = snapcompact::build_archive(&transcript, &config.provider)
        .map_err(|error| anyhow!("archive build failed: {error}"))?;

    // Fixture integrity: every fact must live in the imaged middle, never
    // in the verbatim text edges (otherwise the eval proves nothing).
    for fact in &facts {
        let edges = format!("{}{}", archive.head_text, archive.tail_text);
        anyhow::ensure!(
            !edges.to_lowercase().contains(&fact.answer.to_lowercase()),
            "fixture bug: fact {:?} leaked into a text edge",
            fact.answer
        );
    }

    println!("provider={}/{}", config.provider, config.model);
    println!("{}", archive_summary_line(&archive, &config.provider));

    let questions = format!(
        "{}\n1. {}\n2. {}\n3. {}\n4. {}",
        questions_header("bitmap frames and text slices"),
        facts[0].question,
        facts[1].question,
        facts[2].question,
        facts[3].question
    );

    // Frames arm: exactly what the LLM projection injects after compaction.
    let summary = format!(
        "Conversation history before this point was archived as {} bitmap frames \
         (snapcompact): the frames are a verbatim visual archive of the earlier \
         transcript. Text slices from the archive's chronological edges follow; \
         {} characters of the middle were dropped by the frame budget.",
        archive.frames.len(),
        archive.chars_dropped
    );
    let content = format!(
        "{}\n\n{}",
        compaction::summary_message_text(&summary, Some(&archive)),
        questions
    );
    let reply = ask_model(
        &config,
        judge_system_prompt(),
        content,
        compaction::archive_images(&archive),
    )
    .await?;
    let scores = score_reply(&reply, &facts);
    print_scores("frames (snapcompact)", &facts, &scores);

    if config.baseline {
        let content = format!(
            "Archived conversation transcript (plain text):\n{}\n\n{}",
            transcript, questions
        );
        let reply = ask_model(&config, judge_system_prompt(), content, vec![]).await?;
        let scores = score_reply(&reply, &facts);
        print_scores("plain text (control)", &facts, &scores);
    }

    let passed = scores.iter().filter(|p| **p).count();
    anyhow::ensure!(
        passed >= config.pass_floor,
        "read-back below floor: {}/{} correct (floor {})",
        passed,
        facts.len(),
        config.pass_floor
    );
    Ok(())
}

#[tokio::test]
#[ignore = "network eval: requires CHATSHELL_EVAL_* env vars (see module docs)"]
async fn snapcompact_vision_readback_eval() {
    run_readback_eval()
        .await
        .expect("snapcompact vision read-back eval failed");
}

// ---------------------------------------------------------------------------
// Real-history mode: build the archive from actual local chat records
// (read-only; nothing is written back to any database) and probe the model
// with transcription questions over lines auto-picked from the imaged
// middle. Env additions:
// - `CHATSHELL_EVAL_DB`            app DB path (default: the live data.db)
// - `CHATSHELL_EVAL_CONVERSATION`  optional conversation id override
// ---------------------------------------------------------------------------

use chatshell_agent_core::compaction::{
    HistoryItem, HistoryRole, SerializeBudgets, build_transcript, render_transcript,
};
use chatshell_agent_core::snapcompact::normalize::{normalize, wrap};
use sqlx::Row;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

fn default_db_path() -> std::path::PathBuf {
    std::env::var("CHATSHELL_EVAL_DB")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| {
            let home = std::env::var("HOME").expect("HOME is set");
            std::path::Path::new(&home)
                .join("Library/Application Support/app.chatshell.desktop/data.db")
        })
}

/// Mirror of `commands::chat::compaction::load_history_items` against a
/// read-only pool (that function needs the full AppState).
async fn load_real_history() -> Result<(String, Vec<HistoryItem>)> {
    let options = SqliteConnectOptions::new()
        .filename(default_db_path())
        .read_only(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .context("opening app DB read-only failed")?;

    let conversation_id = match std::env::var("CHATSHELL_EVAL_CONVERSATION") {
        Ok(id) => id,
        Err(_) => {
            let row = sqlx::query(
                "SELECT m.conversation_id AS id, c.title AS title, \
                        SUM(LENGTH(m.content)) AS chars, COUNT(*) AS n
                 FROM messages m
                 JOIN conversations c ON c.id = m.conversation_id
                 WHERE m.deleted_at IS NULL AND c.deleted_at IS NULL
                 GROUP BY m.conversation_id
                 ORDER BY chars DESC LIMIT 8",
            )
            .fetch_one(&pool)
            .await?;
            println!(
                "picked conversation {:?} ({} messages, {} chars)",
                row.try_get::<String, _>("title").unwrap_or_default(),
                row.try_get::<i64, _>("n").unwrap_or(0),
                row.try_get::<i64, _>("chars").unwrap_or(0)
            );
            row.try_get::<String, _>("id")?
        }
    };

    let messages = sqlx::query(
        "SELECT id, sender_type, content FROM messages \
         WHERE conversation_id = ? AND deleted_at IS NULL ORDER BY created_at ASC",
    )
    .bind(&conversation_id)
    .fetch_all(&pool)
    .await?;

    let mut items: Vec<HistoryItem> = Vec::new();
    for message in &messages {
        let id: String = message.try_get("id")?;
        let sender: String = message.try_get("sender_type")?;
        let content: String = message.try_get("content")?;
        match sender.as_str() {
            "user" => items.push(HistoryItem {
                id: id.clone(),
                role: HistoryRole::User,
                text: content,
                tool_name: None,
            }),
            "model" | "assistant" => {
                let calls = sqlx::query(
                    "SELECT tool_name, tool_input, tool_output FROM tool_calls \
                     WHERE message_id = ? ORDER BY display_order, created_at",
                )
                .bind(&id)
                .fetch_all(&pool)
                .await?;
                for call in &calls {
                    let tool_name: String = call.try_get("tool_name")?;
                    let tool_input: Option<String> = call.try_get("tool_input")?;
                    let tool_output: Option<String> = call.try_get("tool_output")?;
                    items.push(HistoryItem {
                        id: id.clone(),
                        role: HistoryRole::ToolCall,
                        text: tool_input.unwrap_or_default(),
                        tool_name: Some(tool_name.clone()),
                    });
                    if let Some(output) = tool_output {
                        items.push(HistoryItem {
                            id: id.clone(),
                            role: HistoryRole::ToolResult,
                            text: output,
                            tool_name: Some(tool_name),
                        });
                    }
                }
                if !content.trim().is_empty() {
                    items.push(HistoryItem {
                        id: id.clone(),
                        role: HistoryRole::Assistant,
                        text: content,
                        tool_name: None,
                    });
                }
            }
            _ => continue,
        }
    }
    let title = sqlx::query("SELECT title FROM conversations WHERE id = ?")
        .bind(&conversation_id)
        .fetch_optional(&pool)
        .await?
        .and_then(|row| row.try_get::<String, _>("title").ok())
        .unwrap_or_default();
    pool.close().await;
    Ok((title, items))
}

/// One transcription probe: a real transcript line from the imaged middle.
/// The question names a rare token from the line (the handle); the scored
/// answer is the REST of the line, token-recall style.
struct LineProbe {
    key_token: String,
    answer_tokens: Vec<String>,
    line: String,
}

/// Debug aid: write the built frames + transcript when
/// `CHATSHELL_EVAL_DUMP=<dir>` is set (test-only path).
fn dump_archive(archive: &SnapcompactArchive, transcript: &str) {
    let Some(dir) = std::env::var("CHATSHELL_EVAL_DUMP").ok() else {
        return;
    };
    let dir = std::path::Path::new(&dir);
    std::fs::create_dir_all(dir).unwrap();
    for (i, frame) in archive.frames.iter().enumerate() {
        let bytes = chatshell_agent_core::snapcompact::render::png_base64_decode(&frame.png_base64);
        std::fs::write(dir.join(format!("frame-{i}.png")), bytes).unwrap();
    }
    std::fs::write(dir.join("transcript.txt"), transcript).unwrap();
    println!("archive dumped to {}", dir.display());
}

fn tokenize_lower(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.len() >= 3)
        .map(|t| t.to_lowercase())
        .collect()
}

/// Pick up to `want` probe lines from the imaged middle of the archive:
/// early-middle lines always land inside the kept frames and never inside
/// the dropped overflow slice.
fn build_probes(
    transcript: &str,
    archive: &SnapcompactArchive,
    provider: &str,
    want: usize,
) -> Vec<LineProbe> {
    let geometry = snapcompact::resolve_shape(provider, transcript);
    let cols = geometry.frame_size / geometry.cell_width.max(1);
    let rows = geometry.frame_size / geometry.cell_height.max(1);
    let lines = wrap(
        &normalize(transcript, |_| true),
        cols,
        geometry.font != FontKind::Silver,
    );
    let edges = format!("{}{}", archive.head_text, archive.tail_text).to_lowercase();

    let mut frequency: std::collections::HashMap<String, usize> = Default::default();
    for token in tokenize_lower(&lines.join("\n")) {
        *frequency.entry(token).or_insert(0) += 1;
    }
    let middle_len = lines.len().saturating_sub(rows * 2);
    let kept_rows = middle_len.min(snapcompact::MAX_FRAMES * rows);
    let probe_window_end = (rows + kept_rows).min(lines.len());

    let mut probes = Vec::new();
    // Inside the kept frames (never the dropped overflow slice), after the
    // head text edge.
    for line in lines.iter().take(probe_window_end).skip(rows) {
        if probes.len() >= want {
            break;
        }
        let trimmed = line.trim();
        if trimmed.len() < 30 || trimmed.len() > 140 {
            continue;
        }
        // (CJK lines are fair game: they draw through the per-character
        // Silver fallback inside bitmap frames.)
        if edges.contains(&trimmed.to_lowercase()) {
            continue; // leaked into a text edge; useless as a frame probe
        }
        let tokens = tokenize_lower(trimmed);
        if tokens.len() < 5 {
            continue;
        }
        // Handle: rarest alphanumeric token, unique in the transcript.
        let key = tokens
            .iter()
            .filter(|t| t.len() >= 5 && frequency.get(*t).copied().unwrap_or(0) == 1)
            .min_by_key(|t| t.len())
            .cloned();
        let Some(key_token) = key else { continue };
        if key_token.chars().all(|c| c.is_ascii_digit()) {
            continue; // pure numbers read back unreliably as handles
        }
        let answer_tokens: Vec<String> = {
            let mut rest: Vec<String> = tokens.into_iter().filter(|t| t != &key_token).collect();
            rest.sort();
            rest.dedup();
            rest
        };
        if answer_tokens.len() < 4 {
            continue;
        }
        probes.push(LineProbe {
            key_token,
            answer_tokens,
            line: trimmed.to_string(),
        });
    }
    probes
}

fn score_probe(reply: &str, probe: &LineProbe) -> f64 {
    let reply_tokens: std::collections::HashSet<_> = tokenize_lower(reply).into_iter().collect();
    let hit = probe
        .answer_tokens
        .iter()
        .filter(|t| reply_tokens.contains(*t))
        .count();
    hit as f64 / probe.answer_tokens.len() as f64
}

/// Score one eval arm: inject `body` (+ images) with the shared question
/// list, parse the JSON answers, report per-probe token recall, and return
/// the pass count.
async fn run_probe_arm(
    config: &EvalConfig,
    probes: &[LineProbe],
    arm: &str,
    source_hint: &str,
    body: String,
    questions: &str,
    images: Vec<crate::llm::ImageData>,
) -> Result<usize> {
    let content = format!("{}\n\n{}\n{questions}", body, questions_header(source_hint));
    let reply = ask_model(config, judge_system_prompt(), content, images).await?;
    println!("--- {arm} reply ---\n{reply}\n--------------------");
    let mut answers: Vec<String> = Vec::new();
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(reply.trim())
        && let Some(array) = value.get("answers").and_then(|v| v.as_array())
    {
        answers = array
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
    }
    let mut passed = 0;
    for (i, probe) in probes.iter().enumerate() {
        let target = answers.get(i).map(String::as_str).unwrap_or(reply.as_str());
        let recall = score_probe(target, probe);
        let ok = recall >= 0.7;
        if ok {
            passed += 1;
        }
        println!(
            "  [{arm}] probe {i} key={:?}: token recall {:.2} ({})",
            probe.key_token,
            recall,
            if ok { "PASS" } else { "FAIL" }
        );
    }
    println!("== {arm}: {passed}/{} probes passed ==", probes.len());
    Ok(passed)
}

async fn run_real_history_eval(model_call: bool) -> Result<()> {
    let config = if model_call {
        Some(EvalConfig::from_env()?)
    } else {
        None
    };
    let (title, items) = load_real_history().await?;
    println!(
        "conversation {:?}: {} history items (user/assistant/tool calls+results)",
        title,
        items.len()
    );

    // Production compaction pipeline: transcript with tool-noise dimming.
    let transcript = render_transcript(
        &build_transcript(&items, &SerializeBudgets::default()),
        true,
    );
    let provider = config
        .as_ref()
        .map(|c| c.provider.clone())
        .unwrap_or_else(|| "custom_anthropic".to_string());
    let archive = snapcompact::build_archive(&transcript, &provider)
        .map_err(|error| anyhow!("archive build failed: {error} (history too short?)"))?;
    println!(
        "transcript chars={} {}",
        transcript.chars().count(),
        archive_summary_line(&archive, &provider)
    );
    dump_archive(&archive, &transcript);

    let probes = build_probes(&transcript, &archive, &provider, 4);
    anyhow::ensure!(
        probes.len() == 4,
        "only {} usable probe lines found; pick a longer conversation",
        probes.len()
    );
    for (i, probe) in probes.iter().enumerate() {
        println!("probe {i}: key={:?} line={:?}", probe.key_token, probe.line);
    }

    let Some(config) = config else {
        println!("dry run: skipping the model call");
        return Ok(());
    };

    let questions = probes
        .iter()
        .enumerate()
        .map(|(i, probe)| {
            format!(
                "{}. Find the line in the archived conversation that contains the token \
                 \"{}\" and transcribe that complete line verbatim.",
                i + 1,
                probe.key_token
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let summary = format!(
        "Conversation history before this point was archived as {} bitmap frames \
         (snapcompact): the frames are a verbatim visual archive of the earlier \
         transcript. Text slices from the archive's chronological edges follow; \
         {} characters of the middle were dropped by the frame budget.",
        archive.frames.len(),
        archive.chars_dropped
    );

    // Arm 1 — snapcompact frames: exactly what the projection injects.
    let frames_content = compaction::summary_message_text(&summary, Some(&archive));
    let frames_passed = run_probe_arm(
        &config,
        &probes,
        "frames (snapcompact)",
        "bitmap frames and text slices",
        frames_content,
        &questions,
        compaction::archive_images(&archive),
    )
    .await?;

    // Arm 2 — soft: the same reader model summarizes the same transcript
    // with the production prompts, then answers from the summary alone.
    let soft_passed = if config.soft_arm {
        let summarizer_prompt =
            chatshell_agent_core::compaction::build_summary_user_prompt(&transcript, None);
        let summary_reply = ask_model(
            &config,
            chatshell_agent_core::compaction::SUMMARIZATION_SYSTEM_PROMPT.to_string(),
            summarizer_prompt,
            vec![],
        )
        .await
        .context("soft summarization call failed")?;
        let soft_summary = chatshell_agent_core::compaction::clamp_summary(summary_reply.trim());
        println!(
            "--- soft summary ({} carry tokens) ---\n{}\n--------------------",
            chatshell_agent_core::context_pruning::estimate_tokens(&soft_summary),
            soft_summary
        );
        let soft_content = compaction::summary_message_text(&soft_summary, None);
        Some(
            run_probe_arm(
                &config,
                &probes,
                "soft (summary)",
                "a structured summary",
                soft_content,
                &questions,
                vec![],
            )
            .await?,
        )
    } else {
        None
    };

    anyhow::ensure!(
        frames_passed >= 3,
        "real-history read-back below floor: {}/{} probes at recall >= 0.7",
        frames_passed,
        probes.len()
    );
    if let Some(soft) = soft_passed {
        println!(
            "comparison: frames {frames_passed}/{} vs soft {soft}/{} (same reader, same questions)",
            probes.len(),
            probes.len()
        );
    }
    Ok(())
}

#[tokio::test]
#[ignore = "reads the local app DB (read-only); offline dry run, no API key needed"]
async fn snapcompact_real_history_dry_run() {
    run_real_history_eval(false)
        .await
        .expect("real-history dry run failed");
}

#[tokio::test]
#[ignore = "reads the local app DB (read-only) + network: requires CHATSHELL_EVAL_* env vars"]
async fn snapcompact_real_history_eval() {
    run_real_history_eval(true)
        .await
        .expect("snapcompact real-history eval failed");
}

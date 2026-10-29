//! Feedback Kevin picks up in conversation: how an intro went, why a match
//! is or isn't right, and what the user does or doesn't want. Kevin saves it
//! with the record_feedback tool, sees what's already saved in his context,
//! and (web chat only) gets a short list of intros to ask about.

use serde_json::{json, Value};
use uuid::Uuid;

use crate::state::AppState;

const OUTCOMES: &[&str] = &[
    "met", "not_met_yet", "no_meeting", "good_match", "poor_match",
    "follow_up", "investing", "passed", "declined",
];
const REASONS: &[&str] = &[
    "too_early", "too_late", "sector", "ticket_size", "traction",
    "team", "geography", "not_now", "other",
];
/// Outcomes that close an intro: Kevin stops asking about it.
const FINAL_OUTCOMES: &[&str] = &["no_meeting", "poor_match", "investing", "passed", "declined"];
/// Marks the follow-ups section in the system prompt (see run_kevin_with_tools).
pub(crate) const FOLLOW_UP_HEADING: &str = "## Intro follow-ups";

const DESCRIPTION: &str = "Save what the user tells you about how an intro or meeting went, why a match is or isn't right for them, or what they do or don't want (sectors, stages, ticket size, geography, kind of investor or startup). Call it as soon as they say it, without asking permission. If they'd rather not say how an intro went, save that too, with no outcome (detail: \"Didn't want to say\").";

fn properties() -> Value {
    json!({
        "kind": {
            "type": "string",
            "enum": ["intro_outcome", "preference"],
            "description": "intro_outcome: about a specific match or intro. preference: what the user wants in general."
        },
        "about_user_id": {
            "type": "string",
            "description": "UUID of the match or intro it's about (from lookup_match or the intro follow-ups list). Required for intro_outcome."
        },
        "outcome": {
            "type": "string",
            "enum": OUTCOMES,
            "description": "For intro_outcome: what happened."
        },
        "reason": {
            "type": "string",
            "enum": REASONS,
            "description": "Why it wasn't a fit, if they said."
        },
        "detail": {
            "type": "string",
            "description": "One sentence with the user's point, in their words where possible."
        }
    })
}

pub(crate) fn tool_for_anthropic() -> Value {
    json!({
        "name": "record_feedback",
        "description": DESCRIPTION,
        "input_schema": {
            "type": "object",
            "properties": properties(),
            "required": ["kind", "detail"]
        }
    })
}

pub(crate) fn tool_for_gemini() -> Value {
    json!({
        "name": "record_feedback",
        "description": DESCRIPTION,
        "parameters": {
            "type": "object",
            "properties": properties(),
            "required": ["kind", "detail"]
        }
    })
}

fn optional_enum(input: &Value, field: &str, allowed: &[&str]) -> Result<Option<String>, String> {
    match input[field].as_str().map(str::trim).filter(|s| !s.is_empty()) {
        None => Ok(None),
        Some(v) if allowed.contains(&v) => Ok(Some(v.to_string())),
        Some(v) => Err(format!("Not saved: '{v}' isn't a valid {field}. Use one of: {}.", allowed.join(", "))),
    }
}

pub(crate) async fn record(state: &AppState, user_id: Uuid, input: &Value) -> String {
    let kind = input["kind"].as_str().unwrap_or("");
    if kind != "intro_outcome" && kind != "preference" {
        return "Not saved: kind must be intro_outcome or preference.".to_string();
    }
    let detail = input["detail"].as_str().unwrap_or("").trim();
    if detail.is_empty() {
        return "Not saved: detail is empty.".to_string();
    }
    let outcome = match optional_enum(input, "outcome", OUTCOMES) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let reason = match optional_enum(input, "reason", REASONS) {
        Ok(v) => v,
        Err(e) => return e,
    };

    let about = match input["about_user_id"].as_str().map(str::trim).filter(|s| !s.is_empty()) {
        None => None,
        Some(s) => match s.parse::<Uuid>() {
            Ok(id) => Some(id),
            Err(_) => return "Not saved: about_user_id isn't a valid ID.".to_string(),
        },
    };
    if kind == "intro_outcome" && about.is_none() {
        return "Not saved: intro_outcome needs about_user_id. Call lookup_match to find it.".to_string();
    }
    if let Some(other) = about {
        let related: bool = sqlx::query_scalar(
            r#"SELECT EXISTS(SELECT 1 FROM kevin_matches
                             WHERE (for_user_id = $1 AND matched_user_id = $2)
                                OR (for_user_id = $2 AND matched_user_id = $1))
                   OR EXISTS(SELECT 1 FROM introductions
                             WHERE (investor_user_id = $1 AND startup_user_id = $2)
                                OR (investor_user_id = $2 AND startup_user_id = $1))"#,
        )
        .bind(user_id)
        .bind(other)
        .fetch_one(&state.db)
        .await
        .unwrap_or(false);
        if !related {
            return "Not saved: that person isn't one of this user's matches or intros.".to_string();
        }
    }

    let saved = sqlx::query(
        r#"INSERT INTO kevin_feedback (user_id, about_user_id, kind, outcome, reason, detail)
           VALUES ($1, $2, $3, $4, $5, $6)"#,
    )
    .bind(user_id)
    .bind(about)
    .bind(kind)
    .bind(&outcome)
    .bind(&reason)
    .bind(detail)
    .execute(&state.db)
    .await;

    match saved {
        Ok(_) => "Saved.".to_string(),
        Err(e) => {
            tracing::error!("record_feedback insert failed: {e}");
            "Not saved: database error.".to_string()
        }
    }
}

const NAME_SQL: &str = "COALESCE(NULLIF(TRIM(p.company_name), ''), NULLIF(TRIM(ip.firm_name), ''), 'a contact')";

/// The user's saved feedback, newest first, for every channel's context.
pub(crate) async fn saved_section(state: &AppState, user_id: Uuid) -> String {
    let rows: Vec<(String, Option<String>, String, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(&format!(
        r#"SELECT f.kind,
                  CASE WHEN f.about_user_id IS NULL THEN NULL ELSE {NAME_SQL} END,
                  f.detail, f.created_at
           FROM kevin_feedback f
           LEFT JOIN profiles p ON p.user_id = f.about_user_id
           LEFT JOIN investor_profiles ip ON ip.user_id = f.about_user_id
           WHERE f.user_id = $1
           ORDER BY f.created_at DESC
           LIMIT 15"#
    ))
    .bind(user_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    if rows.is_empty() {
        return String::new();
    }
    let lines: Vec<String> = rows
        .into_iter()
        .map(|(kind, about, detail, at)| {
            let date = at.format("%Y-%m-%d");
            match (kind.as_str(), about) {
                ("intro_outcome", Some(name)) => format!("- {date}, about {name}: {detail}"),
                _ => format!("- {date}: {detail}"),
            }
        })
        .collect();
    format!(
        "\nWhat this user has told you (saved feedback, newest first; don't ask for it again):\n{}",
        lines.join("\n")
    )
}

/// Intros worth asking about: accepted a week or more ago, or passed on by
/// this user recently, with no answer saved yet. Web chat only, because
/// WhatsApp and Telegram can't save the answer. Also returns a one-line
/// instruction for the opening "Hi" of a conversation (the models follow it
/// far more reliably than the general rule in the section) and the question
/// it asks, so the reply to that question can be made to call record_feedback.
pub(crate) async fn follow_up_section(state: &AppState, user_id: Uuid) -> (String, Option<(String, String)>) {
    let rows: Vec<(Uuid, String, String, i32)> = sqlx::query_as(&format!(
        r#"WITH events AS (
               SELECT matched_user_id AS other_id, intro_accepted_at AS at, 'accepted' AS what
                 FROM kevin_matches
                WHERE for_user_id = $1 AND intro_accepted_at IS NOT NULL AND matched_user_id IS NOT NULL
               UNION ALL
               SELECT for_user_id, intro_accepted_at, 'accepted'
                 FROM kevin_matches
                WHERE matched_user_id = $1 AND intro_accepted_at IS NOT NULL
               UNION ALL
               SELECT for_user_id, intro_passed_at, 'passed'
                 FROM kevin_matches
                WHERE matched_user_id = $1 AND intro_passed_at IS NOT NULL
               UNION ALL
               SELECT CASE WHEN investor_user_id = $1 THEN startup_user_id ELSE investor_user_id END,
                      created_at, 'accepted'
                 FROM introductions
                WHERE LOWER(status) = 'accepted' AND (investor_user_id = $1 OR startup_user_id = $1)
               UNION ALL
               SELECT startup_user_id, created_at, 'passed'
                 FROM introductions
                WHERE LOWER(status) = 'declined' AND investor_user_id = $1
           ),
           latest AS (
               SELECT DISTINCT ON (other_id) other_id, at, what
                 FROM events
                ORDER BY other_id, at DESC
           )
           SELECT l.other_id, {NAME_SQL}, l.what,
                  EXTRACT(DAY FROM now() - l.at)::int
             FROM latest l
             LEFT JOIN profiles p ON p.user_id = l.other_id
             LEFT JOIN investor_profiles ip ON ip.user_id = l.other_id
            WHERE ((l.what = 'accepted' AND l.at BETWEEN now() - interval '120 days' AND now() - interval '7 days')
                OR (l.what = 'passed' AND l.at > now() - interval '30 days'))
              AND NOT EXISTS (
                  SELECT 1 FROM kevin_feedback f
                   WHERE f.user_id = $1 AND f.about_user_id = l.other_id
                     AND (f.outcome = ANY($2) OR f.created_at > now() - interval '14 days'
                          OR l.what = 'passed'))
            ORDER BY l.at DESC
            LIMIT 3"#
    ))
    .bind(user_id)
    .bind(FINAL_OUTCOMES.iter().map(|s| s.to_string()).collect::<Vec<String>>())
    .fetch_all(&state.db)
    .await
    .unwrap_or_else(|e| {
        tracing::warn!("kevin_feedback follow-ups query failed: {e}");
        Vec::new()
    });

    if rows.is_empty() {
        return (String::new(), None);
    }
    let (_, first_name, first_what, _) = &rows[0];
    let question = if first_what == "passed" {
        format!("You passed on {first_name}. What was missing?")
    } else {
        format!("How did it go with {first_name}?")
    };
    let opening = format!("Right now the user has just opened the chat. Reply in one short line and end with: \"{question}\"");
    let lines: Vec<String> = rows
        .into_iter()
        .map(|(id, name, what, days)| {
            if what == "passed" {
                format!("- {name} (about_user_id {id}): this user passed on the intro {days} days ago. Ask what was missing.")
            } else {
                format!("- {name} (about_user_id {id}): intro accepted {days} days ago. Ask whether they met and how it went.")
            }
        })
        .collect();
    let section = format!(
        "\n\n{FOLLOW_UP_HEADING}\nAsking: if the user's message is a greeting or small talk, or they've just got what they came for, your reply must end with this exact question about the first intro below: \"How did it go with <name>?\" Ask about only one intro per conversation, never a second one (a general question about fundraising doesn't count). Don't interrupt a task to ask. If they'd rather not say, drop it.\n\nThese intros have no outcome saved yet:\n{}\n\nSaving: this list is the truth; anything about these in your memory notes is NOT saved. Whenever the user says how one of these went, including a short reply to your question like \"yes, it went well\", call record_feedback with its about_user_id before you reply. Only say \"Noted\" after it returns \"Saved.\".",
        lines.join("\n")
    );
    (section, Some((opening, question)))
}

/// What the user has told Kevin, for the match-ranking prompt: their stated
/// preferences and how past intros went. Empty when nothing is saved.
pub(crate) async fn matching_section(state: &AppState, user_id: Uuid) -> String {
    let rows: Vec<(String, Option<String>, Option<String>, Option<String>, String)> = sqlx::query_as(&format!(
        r#"SELECT f.kind,
                  CASE WHEN f.about_user_id IS NULL THEN NULL ELSE {NAME_SQL} END,
                  f.outcome, f.reason, f.detail
           FROM kevin_feedback f
           LEFT JOIN profiles p ON p.user_id = f.about_user_id
           LEFT JOIN investor_profiles ip ON ip.user_id = f.about_user_id
           WHERE f.user_id = $1
           ORDER BY f.created_at DESC
           LIMIT 20"#
    ))
    .bind(user_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let mut prefs = Vec::new();
    let mut intros = Vec::new();
    for (kind, about, outcome, reason, detail) in rows {
        if kind == "preference" {
            prefs.push(format!("- {detail}"));
        } else if let Some(name) = about {
            let tags: Vec<String> = [outcome, reason].into_iter().flatten().collect();
            let tags = if tags.is_empty() { String::new() } else { format!(" ({})", tags.join(", ")) };
            intros.push(format!("- {name}{tags}: {detail}"));
        }
    }

    let mut out = String::new();
    if !prefs.is_empty() {
        out.push_str(&format!(
            "\n\nWhat this user has told Kevin they want (newest first; this overrides their profile). Score any candidate that clearly clashes with one of these 20 or lower:\n{}",
            prefs.join("\n")
        ));
    }
    if !intros.is_empty() {
        out.push_str(&format!(
            "\n\nHow this user's past intros went (newest first). Score candidates like the ones that went well higher, and like the ones that didn't lower:\n{}",
            intros.join("\n")
        ));
    }
    out
}

/// True when the user has saved a preference since their matches were last
/// generated, so cached matches should be regenerated with it.
pub(crate) async fn preference_since_last_matches(state: &AppState, user_id: Uuid) -> bool {
    sqlx::query_scalar(
        r#"SELECT EXISTS(
               SELECT 1 FROM kevin_feedback
                WHERE user_id = $1 AND kind = 'preference'
                  AND created_at > COALESCE(
                      (SELECT MAX(generated_at) FROM kevin_matches WHERE for_user_id = $1),
                      '-infinity'::timestamptz))"#,
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .unwrap_or(false)
}

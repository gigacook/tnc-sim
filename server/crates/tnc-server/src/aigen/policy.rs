//! The AI generation policy: every fixed decision of the generation job, in one place.
//!
//! Nothing here is a model property. Prices, context lengths and provider output limits always come
//! from OpenRouter's catalog at run time (`catalog.rs`); these are the application's own choices.

use std::time::Duration;

/// Reasoning effort asked for when the model documents the `reasoning` parameter.
pub const REASONING_EFFORT: &str = "medium";
/// Output tokens asked for. A request, not a guarantee: see `effective_output_cap`.
pub const REQUESTED_OUTPUT_CEILING: u64 = 131_072;
/// A program that fails validation is sent back for repair without asking.
pub const AUTO_REPAIR: bool = true;
/// Refinement rounds after the first generation (so at most 1 + 5 model answers per job).
pub const MAX_REFINEMENT_ROUNDS: u32 = 5;
/// A client measurement with a score at or above this (0-100) passes, unless it says `pass` itself.
pub const MEASURE_GOAL: f64 = 95.0;
/// How long the reduced model catalog is served from memory.
pub const CATALOG_TTL: Duration = Duration::from_secs(600);
/// Retries of one upstream request that failed before any answer was committed (connection refused,
/// HTTP 429 / 5xx). Each one is announced with a `status` event first. Never applied mid-stream.
pub const MAX_TRANSIENT_RETRIES: u32 = 1;

/// Prompt size estimate: no tokenizer runs here, so characters / 3 (over-counts for English and NC
/// text, which is the safe direction for a clamp).
pub const CHARS_PER_TOKEN: u64 = 3;
/// Tokens kept free on top of the estimate (message framing, estimate error).
pub const CONTEXT_MARGIN: u64 = 512;
/// Below this effective cap a program cannot be written: the job stops with `prompt_too_long`.
pub const MIN_OUTPUT_TOKENS: u64 = 1024;

pub const MAX_PROMPT_CHARS: usize = 20_000;
pub const MAX_SYSTEM_CHARS: usize = 100_000;
pub const MAX_MEASURE_TEXT_CHARS: usize = 8_000;
pub const MAX_SPEC_BYTES: usize = 64 * 1024;

pub fn estimate_tokens(chars: usize) -> u64 {
    chars as u64 / CHARS_PER_TOKEN + 1
}

/// What is left of the context window for the answer, or None when the catalog gives no context length.
pub fn available_context(context_length: Option<u64>, prompt_chars: usize) -> Option<u64> {
    context_length.map(|c| c.saturating_sub(estimate_tokens(prompt_chars) + CONTEXT_MARGIN))
}

/// min(requested, the provider's output cap for the model, the context left after the prompt).
/// An unknown limit (None) does not constrain.
pub fn effective_output_cap(requested: u64, provider_cap: Option<u64>, available_context: Option<u64>) -> u64 {
    requested.min(provider_cap.unwrap_or(u64::MAX)).min(available_context.unwrap_or(u64::MAX))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamp_fixture() {
        // owner fixture: requested 131072, provider cap 32768, available context 50000 -> 32768
        assert_eq!(effective_output_cap(131_072, Some(32_768), Some(50_000)), 32_768);
    }

    #[test]
    fn clamp_takes_the_smallest_known_limit() {
        assert_eq!(effective_output_cap(131_072, Some(32_768), Some(20_000)), 20_000);
        assert_eq!(effective_output_cap(131_072, None, Some(50_000)), 50_000);
        assert_eq!(effective_output_cap(131_072, Some(200_000), None), 131_072);
        assert_eq!(effective_output_cap(131_072, None, None), 131_072);
        assert_eq!(effective_output_cap(131_072, Some(32_768), Some(0)), 0);
    }

    #[test]
    fn available_context_subtracts_the_prompt_estimate() {
        assert_eq!(available_context(None, 3000), None);
        assert_eq!(available_context(Some(10_000), 3000), Some(10_000 - 1001 - CONTEXT_MARGIN));
        assert_eq!(available_context(Some(100), 3000), Some(0));
    }

    #[test]
    fn policy_values() {
        assert_eq!(REASONING_EFFORT, "medium");
        assert_eq!(REQUESTED_OUTPUT_CEILING, 131_072);
        assert_eq!(MAX_REFINEMENT_ROUNDS, 5);
        const { assert!(AUTO_REPAIR) };
    }
}

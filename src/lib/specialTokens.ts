/**
 * Neutralize model control tokens that appear literally in user text.
 *
 * Some inference servers (Ollama, llama.cpp, vLLM, LM Studio) tokenize text
 * such as `<|im_end|>` or `</s>` as real control tokens, so a translation of
 * text containing them ends early, or a literal `<think>` flips the model into
 * reasoning mode. Inserting a zero-width space after the opening bracket keeps
 * the text visually identical while preventing the tokenizer from matching;
 * {@link restoreSpecialTokens} removes exactly those inserted characters.
 */

const ZWSP = '​'

// Bodies following `<`: ChatML-style `<|...|>`, DeepSeek full-width
// `<｜...｜>`, and named tokens used by Llama, Gemma, Qwen and DeepSeek.
const ANGLE_BODY = String.raw`(?:\|[^\s<>|]{0,64}\|>|｜[^\s<>｜]{0,64}｜>|\/?(?:s|eos|bos|pad|unk|start_of_turn|end_of_turn|think|thinking|reasoning)>)`
// Bodies following `[`: Mistral instruction markers.
const BRACKET_BODY = String.raw`(?:\/?INST\])`

const PROTECT = new RegExp(`<(?=${ANGLE_BODY})|\\[(?=${BRACKET_BODY})`, 'gi')
const RESTORE = new RegExp(`<${ZWSP}(?=${ANGLE_BODY})|\\[${ZWSP}(?=${BRACKET_BODY})`, 'gi')

export function protectSpecialTokens(text: string): string {
  return text.replace(PROTECT, (bracket) => bracket + ZWSP)
}

export function restoreSpecialTokens(text: string): string {
  return text.replace(RESTORE, (match) => match[0])
}

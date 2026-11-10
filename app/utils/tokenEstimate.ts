// Approximate model tokens for conversation text, from its character mix:
// four word characters, 1.6 symbols, twenty spaces or one non-ASCII character
// per token. Calibrated against cl100k_base on shell output, paths, JSON,
// source, English prose and Chinese; a flat four characters per token undershot
// structured output (paths, diffs, commands) by a third. Another tokenizer
// moves the number, so callers show it as an estimate.
export function estimateTokens(text: string): number {
  let word = 0, symbol = 0, space = 0, wide = 0
  for (const ch of text) {
    const c = ch.codePointAt(0)!
    if (c >= 0x80) wide++
    else if ((c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x5f) word++
    else if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === '\f' || ch === '\v') space++
    else symbol++
  }
  return Math.ceil(word / 4 + symbol / 1.6 + space / 20 + wide)
}

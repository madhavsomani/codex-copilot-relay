// Observed CAPI field limit. This is independent of the selected model's token
// window and the HTTP envelope. UTF-16 length is conservative for non-BMP text.
export const MAX_INSTRUCTIONS_CHARS = 1_048_576;

export function assertInstructionsWithinLimit(content) {
  const chars = String(content ?? '').length;
  if (chars <= MAX_INSTRUCTIONS_CHARS) return;
  throw Object.assign(new Error(
    `Relay instructions field still contains ${chars.toLocaleString('en-US')} characters after exact-duplicate skill catalog reduction; `
    + `Copilot accepts at most ${MAX_INSTRUCTIONS_CHARS.toLocaleString('en-US')}. `
    + 'Start a fresh task from saved files or reduce the developer/skill instructions. '
    + 'No unique instruction was truncated or moved into user text.'), {
    code: 'instructions_too_long', statusCode: 400, param: 'instructions',
    instructionChars: chars, instructionLimitChars: MAX_INSTRUCTIONS_CHARS,
  });
}

function isStandaloneSkillCatalog(text) {
  // Narrowly recognize complete harness inventory snapshots. Do not match a
  // quoted example, partial block, nested block, or a block with sibling rules.
  if (!/^<skills_instructions>\r?\n## Skills\r?\n/.test(text)
    || !text.endsWith('</skills_instructions>')
    || text.split('<skills_instructions>').length !== 2
    || text.split('</skills_instructions>').length !== 2) return false;
  const roots = text.search(/\n### Skill roots\r?\n/);
  const skills = text.search(/\n### Available skills\r?\n/);
  return roots >= 0 && skills > roots && /^- .+\(file: .+\/SKILL\.md\)\r?$/m.test(text.slice(skills));
}

export function buildBoundedInstructions(bridgeInstructions, instructions, roles = []) {
  const format = values => [bridgeInstructions, ...values.map((text, index) =>
    `\n--- Outer developer instruction ${index + 1} ---\n${text}`)].join('\n');
  const original = format(instructions);
  let systemContent = original, deduplicatedSkillCatalogs = 0;
  if (original.length > MAX_INSTRUCTIONS_CHARS) {
    const latest = new Map();
    const key = (text, index) => `${roles[index] ?? 'developer'}\0${text}`;
    instructions.forEach((text, index) => {
      if (isStandaloneSkillCatalog(text)) latest.set(key(text,index),index);
    });
    systemContent = format(instructions.map((text, index) => {
      const last = latest.get(key(text,index));
      if (last === undefined || last === index) return text;
      deduplicatedSkillCatalogs++;
      return `[Relay omitted only an exact duplicate of the complete skills catalog retained in outer developer instruction ${last + 1}. `
        + 'The later occurrence is unchanged; no differing instructions were removed.]';
    }));
  }
  assertInstructionsWithinLimit(systemContent);
  return {systemContent, stats: {
    originalSystemChars: original.length,
    deduplicatedSkillCatalogs,
    deduplicatedInstructionChars: original.length - systemContent.length,
    maxInstructionsChars: MAX_INSTRUCTIONS_CHARS,
  }};
}

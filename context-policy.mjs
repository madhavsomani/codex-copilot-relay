export const STANDARD_CONTEXT_WINDOW_TOKENS = 400_000;
export const SDK_BACKGROUND_COMPACTION_RATIO = 0.8;
export const TOOL_DEFER_THRESHOLD = 30;
const EAGER_TOOL_NAMES = new Set(['exec', 'exec_command', 'write_stdin', 'apply_patch', 'view_image', 'update_plan', 'request_user_input', 'tool_search']);

export function isNativeImageTool(metadata) {
  return metadata?.namespace === 'image_gen' && metadata?.name === 'imagegen';
}

export function prepareContextTools(declarations) {
  const tools = declarations.sdkTools;
  if (tools.length <= TOOL_DEFER_THRESHOLD) return tools;
  const metadataByName = declarations.byInternalName;
  return tools.map(tool => {
    const metadata = metadataByName.get(tool.name);
    const eager = metadata?.discovered || metadata?.kind === 'tool_search' || isNativeImageTool(metadata)
      || ((!metadata?.namespace || metadata.namespace === 'functions') && EAGER_TOOL_NAMES.has(metadata?.name));
    return eager ? {...tool, defer: 'never'} : {...tool, defer: 'auto'};
  });
}

export function serializeContextTools(tools = []) {
  return JSON.stringify(tools.map(tool => tool.defer === 'auto'
    ? {name: tool.name, description: String(tool.description ?? ''), defer: 'auto'}
    : tool));
}

export function contextEventFields(event) {
  if (!['session.usage_info', 'session.compaction_start', 'session.compaction_complete'].includes(event.type)) return null;
  const data = event.data ?? {};
  const fields = {};
  if (typeof data.success === 'boolean') fields.success = data.success;
  for (const key of ['currentTokens', 'tokenLimit', 'systemTokens', 'conversationTokens', 'toolDefinitionsTokens',
    'messagesLength', 'preCompactionTokens', 'postCompactionTokens', 'messagesRemoved', 'tokensRemoved', 'statusCode']) {
    if (Number.isFinite(data[key])) fields[key] = data[key];
  }
  return fields;
}

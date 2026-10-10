import fs from 'node:fs';
import {createHash} from 'node:crypto';

const fail=message=>Object.assign(new Error(message),{publicMessage:message});
const efforts=new Set(['none','low','medium','high','xhigh','max']);
const positive=value=>Number.isSafeInteger(value)&&value>0;
const promptUrl=new URL('./stock-client-0.147.0/prompt.md',import.meta.url);
const promptHash='ac8ae107a0d72fe3476b430afb161ea4e67da2e446d778aefc44828160559807';

export function validateCatalogClientVersion(version){
  if(!/^codex-cli 0\.147\.0\s*$/.test(version))
    throw fail('The isolated model catalog is reviewed for stock Codex 0.147.0. Use the pinned client or review the new stock schema/prompt before upgrading.');
}

export function selectSdkGptModelDetails(models){
  if(!Array.isArray(models)||models.length>128)throw fail('SDK model metadata is missing or exceeds its model-count bound.');
  const result=[],seen=new Set();
  for(const model of models){
    if(!/^gpt-[a-z0-9.-]+$/.test(model?.id??'')||model.policy?.state==='disabled')continue;
    if(seen.has(model.id))throw fail('SDK GPT discovery contains duplicate model IDs.');
    seen.add(model.id);
    const supports=model.capabilities?.supports,limits=model.capabilities?.limits;
    const supported=model.supportedReasoningEfforts??[],defaultEffort=model.defaultReasoningEffort??null;
    if(typeof model.name!=='string'||!model.name.trim()||model.name.length>160||/[\x00-\x1f\x7f]/.test(model.name)
      ||typeof supports?.vision!=='boolean'||typeof supports?.reasoningEffort!=='boolean'
      ||!positive(limits?.max_context_window_tokens)
      ||limits.max_prompt_tokens!==undefined&&(!positive(limits.max_prompt_tokens)||limits.max_prompt_tokens>limits.max_context_window_tokens)
      ||!Array.isArray(supported)||supported.length>efforts.size||new Set(supported).size!==supported.length
      ||supported.some(value=>!efforts.has(value))||defaultEffort!==null&&!supported.includes(defaultEffort)
      ||supports.reasoningEffort===false&&supported.length>0)
      throw fail('SDK GPT model metadata is incomplete or inconsistent; no fallback capabilities were invented.');
    result.push({id:model.id,name:model.name,capabilities:{supports:{vision:supports.vision,reasoningEffort:supports.reasoningEffort},
      limits:{max_context_window_tokens:limits.max_context_window_tokens,
        ...(limits.max_prompt_tokens===undefined?{}:{max_prompt_tokens:limits.max_prompt_tokens})}},
      supportedReasoningEfforts:[...supported],defaultReasoningEffort:defaultEffort});
  }
  return result;
}

export function buildCodexModelCatalog({modelDetails,modelCapabilities,selectedModel}){
  const details=selectSdkGptModelDetails(modelDetails),models=[];
  const prompt=fs.readFileSync(promptUrl,'utf8');
  if(createHash('sha256').update(prompt).digest('hex')!==promptHash)
    throw fail('The reviewed stock generic prompt changed; model catalog generation stopped.');
  for(const detail of details){
    const capability=modelCapabilities?.[detail.id];if(!capability)continue;
    const window=capability.maxContextWindowTokens,promptLimit=capability.maxPromptTokens??window;
    const supported=capability.supportedReasoningEfforts,defaultEffort=capability.defaultReasoningEffort??null;
    if(!positive(window)||window>detail.capabilities.limits.max_context_window_tokens||!positive(promptLimit)
      ||promptLimit>window||promptLimit>(detail.capabilities.limits.max_prompt_tokens??window)
      ||!Array.isArray(supported)||new Set(supported).size!==supported.length
      ||supported.some(value=>!detail.supportedReasoningEfforts.includes(value))
      ||defaultEffort!==null&&!supported.includes(defaultEffort)
      ||!Number.isSafeInteger(capability.maxImageAttachments)||capability.maxImageAttachments<0)
      throw fail('Owned relay and authenticated SDK model capabilities disagree; no stock client was started.');
    const effectivePercent=Math.min(95,Math.floor(100*promptLimit/window));
    if(effectivePercent<1)throw fail('The effective input allowance cannot be represented safely by this stock catalog schema.');
    models.push({slug:detail.id,display_name:detail.name,description:'Authenticated GitHub Copilot model through the isolated relay.',
      default_reasoning_level:defaultEffort,supported_reasoning_levels:supported.map(effort=>({effort,description:`Copilot-advertised ${effort} reasoning effort`})),
      shell_type:'default',visibility:'list',supported_in_api:true,priority:detail.id===selectedModel?0:models.length+1,
      additional_speed_tiers:[],service_tiers:[],default_service_tier:null,availability_nux:null,upgrade:null,
      model_messages:{instructions_template:prompt,instructions_variables:null,approvals:null,collaboration_modes:null,auto_review:null,permissions:null},
      include_skills_usage_instructions:false,include_plugin_usage_instructions:false,include_apps_usage_instructions:false,
      supports_reasoning_summary_parameter:false,default_reasoning_summary:'none',support_verbosity:false,default_verbosity:null,
      apply_patch_tool_type:null,web_search_tool_type:'text',truncation_policy:{mode:'bytes',limit:10000},
      supports_parallel_tool_calls:true,supports_image_detail_original:false,context_window:window,max_context_window:window,
      auto_compact_token_limit:Math.min(Math.floor(window*.9),Math.floor(promptLimit*.9)),effective_context_window_percent:effectivePercent,
      experimental_supported_tools:[],input_modalities:detail.capabilities.supports.vision&&capability.maxImageAttachments>0?['text','image']:['text'],
      supports_search_tool:false,use_responses_lite:false,auto_review_model_override:null,tool_mode:null,multi_agent_version:null});
  }
  if(!models.some(model=>model.slug===selectedModel))throw fail('The selected model has no authenticated, relay-compatible startup metadata.');
  const catalog={models};if(Buffer.byteLength(JSON.stringify(catalog))>2*1024*1024)throw fail('Generated model catalog exceeded its 2 MiB bound.');
  return catalog;
}

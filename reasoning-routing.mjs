import {normalizeReasoningEffort, RequestCompatibilityError} from './bridge-core.mjs';
const order=['none','low','medium','high','xhigh','max'];
export function defaultEffort(model, preferred = null) {
  const supported=model?.supportedReasoningEfforts ?? [];
  if (preferred && supported.includes(preferred)) return preferred;
  return ['low','none','medium','high','xhigh','max'].find(level=>supported.includes(level)) ?? 'low';
}
export function routeEffort(requested, model, preferredDefault = null) {
  const supported=model?.supportedReasoningEfforts ?? [];
  const raw=requested == null ? null : String(requested).toLowerCase();
  if(raw != null && ![...order,'ultra','minimal','minimal_reasoning'].includes(raw))
    throw new RequestCompatibilityError('reasoning.effort','Unknown reasoning effort: '+raw);
  let effort=raw == null ? defaultEffort(model, preferredDefault) : normalizeReasoningEffort(raw);
  let capped=false;
  if(effort === 'max' && supported.length && !supported.includes('max')) {
    effort=order.filter(x=>supported.includes(x)).at(-1); capped=true;
  }
  if(supported.length && !supported.includes(effort))
    throw new RequestCompatibilityError('reasoning.effort',model.id+' supports '+supported.join(', ')+'; requested '+effort+'.');
  return {effort,capped};
}

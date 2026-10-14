// Fixed categories only: no tool arguments, page contents, URLs or private names.
export const browserTool=name=>typeof name==='string'&&/^mcp__relay_browser__browser_[a-z_]+$/.test(name);
export function observeBrowserCatalog(row,tools){if((tools??[]).some(tool=>browserTool(tool.name)))row.browserOffered=true;}
export function observeBrowserSignal(row,type,{name,isError=false}={}){
  if(!browserTool(name))return;
  if(type==='tool_requested')row.browserRequests=(row.browserRequests??0)+1;
  if(type==='tool_resolved')row[isError?'browserErrors':'browserResults']=(row[isError?'browserErrors':'browserResults']??0)+1;
}
export function browserTelemetry(rows=[]){
  const view={offered:false,requests:0,results:0,errors:0,lastObservedAt:null,source:'Client-reported tool results; not independent GUI/browser attestation'};
  for(const row of rows){
    view.offered ||= row.browserOffered===true;
    for(const [key,field] of [['requests','browserRequests'],['results','browserResults'],['errors','browserErrors']])
      if(Number.isSafeInteger(row[field])&&row[field]>0)view[key]+=row[field];
    if(row.browserOffered&&Number.isFinite(Date.parse(row.at))&&(!view.lastObservedAt||row.at>view.lastObservedAt))view.lastObservedAt=row.at;
  }
  return view;
}

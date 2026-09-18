import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {DASHBOARD_HTML} from './dashboard.mjs';
import {callTokenUsage, sdkCredits} from './dashboard-data.mjs';
import {callReasoning} from './call-reasoning.mjs';

function renderHistory(records) {
  const element = tag => ({tag,children:[],style:{},dataset:{},className:'',textContent:'',
    replaceChildren(){this.children=[];},appendChild(child){this.children.push(child);},
    setAttribute(name,value){this[name]=value;}});
  const roots = {rows:element('tbody'),empty:element('div'),'show-more':element('button')};
  const selected = [];
  const context = {document:{createElement:element},state:{records,visible:200,selected:records[0]?.id},
    $:id=>roots[id],callTokenUsage,callReasoning,number:value=>new Intl.NumberFormat('en-US').format(value),
    time:value=>value,duration:value=>String(value),bytes:value=>value+' B',routeLines:()=> 'Selected: gpt-6-astra',
    creditsText:usage=>sdkCredits(usage)===null?'not reported':String(sdkCredits(usage)),selectRecord:id=>selected.push(id)};
  const renderer = DASHBOARD_HTML.slice(DASHBOARD_HTML.indexOf('    function renderRows()'),DASHBOARD_HTML.indexOf('    const providerName'));
  vm.runInNewContext(renderer+'\nrenderRows();',context);
  return {roots,selected};
}

test('history renders exact token columns before model metadata and splits request/response bytes', () => {
  const record = {id:'sample',receivedAt:'2026-09-16T01:24:48Z',completedAt:'2026-09-16T01:25:00Z',status:'completed',detailTier:'lightweight',
    requestedReasoningEffort:'low',selectedReasoningEffort:'high',reasoningSource:'continuation',
    inputBytes:1027773,outputBytes:120683,usage:{metered:true,inputTokens:166078,outputTokens:346,cacheReadTokens:162517,
      sdkApiCalls:1,totalNanoAiu:22432200000,creditMeteredApiCalls:1,apiEquivalentUsd:999}};
  const {roots,selected} = renderHistory([record]);
  const row = roots.rows.children[0], cells = row.children;
  assert.equal(cells.length,13);
  assert.equal(cells[1].textContent,'high\nRequested: low');
  assert.match(cells[1].title,/existing SDK session/);
  assert.equal(cells[2].textContent,'166,424\n1 SDK call');
  assert.equal(cells[3].textContent,'166,078\nCached: 162,517\nNon-cached: 3,561');
  assert.equal(cells[4].textContent,'346');
  assert.equal(cells[5].textContent,'22.4322');
  assert.equal(cells[8].textContent,'Request: 1027773 B\nResponse: 120683 B');
  assert.match(cells[8].title,/not model tokens/);
  assert.equal(cells[12].children[0].textContent,'light');
  assert.equal(row.className,'selected');
  assert.equal(row.dataset.recordId,'sample');
  assert.equal(row['aria-controls'],'selected-call');
  assert.equal(row['aria-pressed'],'true');
  row.onclick();
  row.onkeydown({key:'Enter',preventDefault(){}});
  assert.deepEqual(selected,['sample','sample']);
});

test('routing starts collapsed, charts are promoted, and history and selected call share the full-width stack', () => {
  assert.match(DASHBOARD_HTML,/<details class="panel provider-panel" id="provider-routing" aria-label="Provider routing and usage">/);
  assert.match(DASHBOARD_HTML,/<summary class="provider-summary"><strong>Where calls actually go/);
  const routing = DASHBOARD_HTML.indexOf('id="provider-routing"');
  const trends = DASHBOARD_HTML.indexOf('id="usage-trends"');
  const kpis = DASHBOARD_HTML.indexOf('id="observability-kpis"');
  const history = DASHBOARD_HTML.indexOf('id="history"');
  const detail = DASHBOARD_HTML.indexOf('id="selected-call"');
  assert.ok(routing < trends && trends < kpis && kpis < history && history < detail);
  assert.equal(DASHBOARD_HTML.split('id="usage-trends"').length,2);
  assert.match(DASHBOARD_HTML,/\.workspace \{ display: grid; grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(DASHBOARD_HTML,/\.detail \{ min-height: 0;/);
  assert.match(DASHBOARD_HTML,/Back to call history/);
  for (const range of ['24h','5d','30d']) assert.ok(DASHBOARD_HTML.includes('<option value="'+range+'"'));
  for (const provider of ['copilot','native','platform']) assert.ok(DASHBOARD_HTML.includes('id="provider-'+provider+'-in"'));
});

test('selecting cached, light, or fetched calls reveals details below without fetching unavailable bodies', async () => {
  const renderings = [], navigation = [], requests = [];
  const records = [{id:'light',detailAvailable:false},{id:'cached',detailAvailable:true},{id:'fetch',detailAvailable:true}];
  const panel = {focus:()=>navigation.push('focus'),scrollIntoView:()=>navigation.push('scroll')};
  const context = {state:{records,details:new Map([['cached',{id:'cached',output:'retained'}]])},
    renderRows(){},renderDetail:(record,loading)=>renderings.push({id:record?.id,loading}),$:()=>panel,
    fetch:async url=>{requests.push(url);return {ok:true,json:async()=>({record:{id:'fetch',output:'loaded'}})};}};
  const selector = DASHBOARD_HTML.slice(DASHBOARD_HTML.indexOf('    async function selectRecord('),DASHBOARD_HTML.indexOf('    async function refresh('));
  vm.runInNewContext(selector,context);
  for (const record of records) await context.selectRecord(record.id);
  assert.deepEqual(navigation,['focus','scroll','focus','scroll','focus','scroll']);
  assert.deepEqual(requests,['/dashboard/api/records/fetch']);
  assert.equal(renderings.at(-1).id,'fetch');
  assert.equal(context.state.details.get('fetch').output,'loaded');
  const refresh = DASHBOARD_HTML.slice(DASHBOARD_HTML.indexOf('    async function refresh('));
  assert.doesNotMatch(refresh,/scrollIntoView|selected-call.*focus/);
});

test('history keeps missing measurements unknown and identifies in-progress multi-call usage', () => {
  const {roots} = renderHistory([{id:'missing',completedAt:'2026-09-16',status:'failed'},
    {id:'live',status:'streaming',usage:{metered:true,inputTokens:0,outputTokens:0,cacheReadTokens:0,sdkApiCalls:2,totalNanoAiu:0,creditMeteredApiCalls:2}}]);
  const missing = roots.rows.children[0].children, live = roots.rows.children[1].children;
  assert.equal(missing[1].textContent,'not recorded\nRequested: default / unrecorded');
  assert.equal(missing[2].textContent,'not reported\nSDK calls not reported');
  assert.equal(missing[4].textContent,'not reported');
  assert.equal(missing[5].textContent,'not reported');
  assert.equal(live[2].textContent,'0\n2 SDK calls · partial');
  assert.equal(live[3].textContent,'0\nCached: 0\nNon-cached: 0');
  assert.equal(live[5].textContent,'0');
  assert.equal(renderHistory([]).roots.empty.style.display,'block');
});

test('history retains labeled keyboard scrolling and explains token and byte scopes', () => {
  assert.match(DASHBOARD_HTML,/<th>Total tokens<\/th><th>Input tokens<\/th><th>Output tokens<\/th><th>AI credits · SDK<\/th>/);
  assert.match(DASHBOARD_HTML,/history-scroll" role="region" tabindex="0" aria-labelledby="history-heading"/);
  assert.match(DASHBOARD_HTML,/Total = input \+ output; cached input is included once/);
  assert.match(DASHBOARD_HTML,/Token and byte breakdown/);
  assert.match(DASHBOARD_HTML,/Intelligence · effort/);
  assert.match(DASHBOARD_HTML,/Direct Codex image_gen runs outside this ledger/);
  assert.match(DASHBOARD_HTML,/@media \(max-width: 650px\) \{ #history \{ scroll-margin-top: 325px;/);
});

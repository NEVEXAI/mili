const $=id=>document.getElementById(id);
const map=L.map('map').setView([45.53,-73.63],10);
const cluster=L.markerClusterGroup({chunkedLoading:true,maxClusterRadius:45});
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
map.addLayer(cluster);

let schema,fields,defs,idx,rows=[],matches=[],filters={},markers=new Map();
let currentPage=1;const PAGE_SIZE=250;
let saved=JSON.parse(localStorage.getItem('mili_v22_saved')||localStorage.getItem('mili_v21_saved')||'{}');
let searchIndex=[],vocabulary=new Set(),searchTimer,filterTimer,currentSuggestion=-1;
const SEARCH_FIELDS=['address','MATRICULE83','municipality_name','LIBELLE_UTILISATION','use_group','housing_area','street_names','site_id'];
const get=(r,f)=>r[idx[f]];
const fmt=v=>v===null||v===undefined||v===''?'Not available':typeof v==='number'?v.toLocaleString('en-CA',{maximumFractionDigits:2}):String(v);
const esc=v=>String(v??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
const clr=s=>s>=75?'#226b4d':s>=55?'#ad7e2b':s>=35?'#a95731':'#7e8985';
const busy=v=>$('busy').hidden=!v;

function normalizeSearch(v){return String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b(street|st\.?|rue|avenue|ave\.?|av\.?|boulevard|blvd\.?|chemin|ch\.?|road|rd\.?)\b/g,' ').replace(/\b(montreal|montréal|quebec|québec|qc|canada)\b/g,' ').replace(/\b[a-z]\d[a-z]\s?\d[a-z]\d\b/gi,' ').replace(/[^a-z0-9]+/g,' ').trim()}
function tokens(v){return normalizeSearch(v).split(/\s+/).filter(Boolean)}
function boundedDistance(a,b,max=2){if(Math.abs(a.length-b.length)>max)return max+1;let prev=Array.from({length:b.length+1},(_,i)=>i),cur=new Array(b.length+1);for(let i=1;i<=a.length;i++){cur[0]=i;let rowMin=cur[0];for(let j=1;j<=b.length;j++){cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));rowMin=Math.min(rowMin,cur[j])}if(rowMin>max)return max+1;[prev,cur]=[cur,prev]}return prev[b.length]}
function correctToken(t){if(t.length<4||/^\d+$/.test(t)||vocabulary.has(t))return t;let best=t,bestD=t.length>=8?2:1;for(const w of vocabulary){if(Math.abs(w.length-t.length)>bestD||w[0]!==t[0])continue;let d=boundedDistance(t,w,bestD);if(d<bestD||(d===bestD&&w.length>best.length)){best=w;bestD=d;if(d===1)break}}return best}
function prepareSearch(){searchIndex=rows.map(r=>{const address=normalizeSearch(get(r,'address'));const blob=normalizeSearch(SEARCH_FIELDS.map(f=>get(r,f)).join(' '));return{address,blob}});const counts=new Map();rows.forEach(r=>tokens([get(r,'address'),get(r,'municipality_name'),get(r,'street_names')].join(' ')).forEach(w=>{if(w.length>=4&&!/^\d+$/.test(w))counts.set(w,(counts.get(w)||0)+1)}));vocabulary=new Set([...counts].filter(([,n])=>n>=2).map(([w])=>w))}
function queryPlan(q){const raw=tokens(q),corrected=raw.map(correctToken);return{raw,corrected,norm:corrected.join(' ')}}
function searchScore(r,i,plan){if(!plan.corrected.length)return 0;const s=searchIndex[i],a=s.address,b=s.blob,q=plan.norm;if(a===q)return 1000;if(a.startsWith(q))return 950;if(a.includes(q))return 900;if(plan.corrected.every(t=>a.includes(t)))return 850;if(plan.corrected.every(t=>b.includes(t)))return 700;return -1}

const GROUPS=[
  ['Location & identity',['MATRICULE83','MUNICIPALITE','municipality_name','NO_ARROND_ILE_CUM','housing_area']],
  ['Property use',['use_group','CODE_UTILISATION','LIBELLE_UTILISATION','CATEGORIE_UEF','assessment_record_count','matricule_count','is_condo_aggregate']],
  ['Building & site',['NOMBRE_LOGEMENT','ANNEE_CONSTRUCTION','ETAGE_HORS_SOL','lot_area_sqft','assessment_building_area_sqft','assessment_coverage_pct','assessment_open_site_pct']],
  ['Planning',['planning_supportive','intensification','density_target','pum_land_use','opportunity_sector','opportunity_status','opportunity_scale']],
  ['Transit',['nearest_metro','metro_distance_m','near_metro_800m','future_transit_distance_m','near_future_transit_800m']],
  ['Permits',['permit_count_5y','permit_count_10y','latest_permit_date','recent_permit_5y']],
  ['Street configuration',['street_name_count','street_segment_count','corner_lot_candidate','double_frontage_candidate']],
  ['Heritage & environment',['heritage_pum','heritage_legal','heritage_value_sector','heritage_interest_statement','wetland_flood_constraint']],
  ['Scores & confidence',['opportunity_score','constraint_risk','data_confidence']]
];
function groupFor(name){for(const [g,list] of GROUPS)if(list.includes(name))return g;return'Other'}

async function load(){
  schema=await fetch('data/schema.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('schema '+r.status);return r.json()});
  fields=schema.fields;defs=schema.field_definitions;idx=Object.fromEntries(fields.map((f,i)=>[f,i]));
  buildFilters();
  let q=[...schema.chunks],done=0;
  async function worker(){while(q.length){const c=q.shift(),part=await fetch(c.file,{cache:'no-store'}).then(r=>{if(!r.ok)throw Error(c.file+' '+r.status);return r.json()});rows.push(...part);$('status').textContent=`Loading ${++done}/${schema.chunks.length}…`}}
  await Promise.all([worker(),worker(),worker(),worker()]);
  $('status').textContent='Building search index…';
  prepareSearch();
  $('loadedCount').textContent=rows.length.toLocaleString();
  persist();
  apply();
}

function controlFor(d){
  if(d.type==='number')return`<div class="range"><input type="number" data-field="${d.name}" data-kind="min" placeholder="Min"><input type="number" data-field="${d.name}" data-kind="max" placeholder="Max"></div>`;
  if(d.type==='boolean')return`<div class="bool"><label><input type="radio" name="${d.name}" data-field="${d.name}" value="any" checked><span>Any</span></label><label><input type="radio" name="${d.name}" data-field="${d.name}" value="true"><span>Yes</span></label><label><input type="radio" name="${d.name}" data-field="${d.name}" value="false"><span>No</span></label></div>`;
  if(d.type==='category')return`<select data-field="${d.name}"><option value="">Any</option>${(d.values||[]).map(v=>`<option>${esc(v)}</option>`).join('')}</select>`;
  return`<input type="search" data-field="${d.name}" placeholder="Contains text">`;
}
function buildFilters(){
  const wrap=$('dynamicFilters');wrap.innerHTML='';
  const grouped=new Map();
  defs.filter(d=>d.filterable!==false).forEach(d=>{const g=groupFor(d.name);if(!grouped.has(g))grouped.set(g,[]);grouped.get(g).push(d)});
  for(const [group,groupDefs] of grouped){
    const details=document.createElement('details');details.className='filter-group';details.dataset.group=group;details.open=['Location & identity','Property use','Building & site'].includes(group);
    details.innerHTML=`<summary><span>${esc(group)}</span><span class="group-count" hidden>0</span></summary><div class="filter-group-body"></div>`;
    const body=details.querySelector('.filter-group-body');
    groupDefs.forEach(d=>{const card=document.createElement('div');card.className='filter-card';card.dataset.label=(d.label+' '+d.name).toLowerCase();card.innerHTML=`<label class="filter-label"><span>${esc(d.label)}</span><span class="type">${d.type}</span></label>${controlFor(d)}`;body.appendChild(card)});
    wrap.appendChild(details);
  }
  $('filterSearch').oninput=e=>{
    const q=e.target.value.toLowerCase();
    document.querySelectorAll('.filter-group').forEach(group=>{
      let visible=0;group.querySelectorAll('.filter-card').forEach(card=>{const show=card.dataset.label.includes(q);card.classList.toggle('hidden',!show);if(show)visible++});
      group.classList.toggle('hidden',visible===0);if(q&&visible)group.open=true;
    });
  };
  document.querySelectorAll('[data-field]').forEach(el=>el.addEventListener(el.type==='number'||el.type==='search'?'input':'change',scheduleApply));
}
function scheduleApply(){clearTimeout(filterTimer);$('status').textContent='Filter changes pending…';filterTimer=setTimeout(apply,450)}
function collect(){
  filters={};
  document.querySelectorAll('[data-field]').forEach(el=>{
    const f=el.dataset.field;
    if(el.type==='radio'){if(el.checked&&el.value!=='any')filters[f]={type:'boolean',value:el.value==='true'};return}
    if(el.value==='')return;
    if(el.dataset.kind){filters[f]??={type:'number'};filters[f][el.dataset.kind]=Number(el.value)}
    else{const d=defs.find(x=>x.name===f);filters[f]={type:d?.type||'text',value:el.value}}
  });
  $('activeCount').textContent=Object.keys(filters).length+($('globalSearch').value.trim()?1:0);
  updateGroupCounts();renderChips();
}
function updateGroupCounts(){
  document.querySelectorAll('.filter-group').forEach(g=>{
    let n=0;g.querySelectorAll('[data-field]').forEach(el=>{const f=el.dataset.field;if(filters[f])n++});
    const count=g.querySelector('.group-count');count.textContent=n;count.hidden=!n;
  });
}
function filterLabel(f,a){const d=defs.find(x=>x.name===f),label=d?.label||f;if(a.type==='number'){if(a.min!==undefined&&a.max!==undefined)return`${label}: ${a.min}–${a.max}`;if(a.min!==undefined)return`${label} ≥ ${a.min}`;return`${label} ≤ ${a.max}`}if(a.type==='boolean')return`${label}: ${a.value?'Yes':'No'}`;return`${label}: ${a.value}`}
function renderChips(){
  const box=$('activeChips'),q=$('globalSearch').value.trim();let chips=[];
  if(q)chips.push(`<button class="chip search-chip" data-remove="__search">Search: ${esc(q)} <b>×</b></button>`);
  for(const [f,a] of Object.entries(filters))chips.push(`<button class="chip" data-remove="${esc(f)}">${esc(filterLabel(f,a))} <b>×</b></button>`);
  box.innerHTML=chips.join('');$('activeBar').hidden=!chips.length;
  box.querySelectorAll('.chip').forEach(c=>c.onclick=()=>removeFilter(c.dataset.remove));
}
function removeFilter(f){
  if(f==='__search'){$('globalSearch').value='';hideSuggestions()}
  else document.querySelectorAll(`[data-field="${CSS.escape(f)}"]`).forEach(el=>el.type==='radio'?el.checked=el.value==='any':el.value='');
  apply();
}
function filterOK(r){for(const[f,a]of Object.entries(filters)){const v=get(r,f);if(a.type==='number'){const n=Number(v);if(!Number.isFinite(n)||(a.min!==undefined&&n<a.min)||(a.max!==undefined&&n>a.max))return false}else if(a.type==='boolean'){if(Boolean(v)!==a.value)return false}else if(a.type==='category'){if(String(v)!==a.value)return false}else if(!normalizeSearch(v).includes(normalizeSearch(a.value)))return false}return true}
function sortRows(searching=false){if(searching){matches.sort((a,b)=>b.score-a.score||Number(get(b.row,'opportunity_score')||0)-Number(get(a.row,'opportunity_score')||0));return}const f=$('sortField').value;matches.sort((a,b)=>{const av=Number(get(a.row,f)),bv=Number(get(b.row,f));return f==='metro_distance_m'||f==='constraint_risk'?(Number.isFinite(av)?av:Infinity)-(Number.isFinite(bv)?bv:Infinity):(Number.isFinite(bv)?bv:-Infinity)-(Number.isFinite(av)?av:-Infinity)})}
function apply(){
  busy(true);clearTimeout(filterTimer);currentPage=1;
  requestAnimationFrame(()=>setTimeout(()=>{
    collect();const q=$('globalSearch').value.trim(),plan=queryPlan(q);matches=[];
    for(let i=0;i<rows.length;i++){const r=rows[i];if(!filterOK(r))continue;const score=q?searchScore(r,i,plan):0;if(!q||score>=0)matches.push({row:r,score})}
    sortRows(Boolean(q));render();busy(false);
  },10));
}
function render(){
  $('resultCount').textContent=matches.length.toLocaleString();
  $('avgOpportunity').textContent=matches.length?Math.round(matches.reduce((s,x)=>s+(Number(get(x.row,'opportunity_score'))||0),0)/matches.length):'—';
  cluster.clearLayers();markers.clear();
  matches.slice(0,3000).forEach(x=>{
    const r=x.row,lat=get(r,'latitude'),lng=get(r,'longitude'),score=get(r,'opportunity_score');if(!Number.isFinite(lat)||!Number.isFinite(lng))return;
    const m=L.circleMarker([lat,lng],{radius:5,color:'#fff',weight:1,fillColor:clr(score),fillOpacity:.88});
    m.bindPopup(`<b>${esc(get(r,'address'))}</b><br>${esc(get(r,'municipality_name'))} · ${esc(get(r,'use_group'))}<br>${fmt(get(r,'lot_area_sqft'))} ft² · Opportunity ${score}/100`);
    m.on('click',()=>detail(r));cluster.addLayer(m);markers.set(get(r,'site_id'),m);
  });
  renderPage();
  $('status').textContent=`${matches.length.toLocaleString()} matches across the Montréal agglomeration.`;
  $('renderNote').textContent=`Map shows ${Math.min(matches.length,3000).toLocaleString()} of ${matches.length.toLocaleString()} matches.`;
  setTimeout(()=>map.invalidateSize(),60);
}
function renderPage(){
  const totalPages=Math.max(1,Math.ceil(matches.length/PAGE_SIZE));
  currentPage=Math.min(Math.max(1,currentPage),totalPages);
  const start=(currentPage-1)*PAGE_SIZE;
  const end=Math.min(start+PAGE_SIZE,matches.length);
  $('cards').innerHTML=matches.slice(start,end).map(x=>card(x.row,x.score)).join('');
  document.querySelectorAll('.card').forEach(c=>c.onclick=()=>{const x=matches.find(y=>get(y.row,'site_id')===c.dataset.id);if(!x)return;detail(x.row);const m=markers.get(c.dataset.id);if(m){map.setView(m.getLatLng(),16);m.openPopup()}});
  const firstShown=matches.length?start+1:0;
  $('pageStatus').textContent=matches.length?`Showing ${firstShown.toLocaleString()}–${end.toLocaleString()} of ${matches.length.toLocaleString()}`:'No matching properties';
  $('pageNumber').textContent=`Page ${currentPage.toLocaleString()} of ${totalPages.toLocaleString()}`;
  $('prevPage').disabled=currentPage<=1;
  $('nextPage').disabled=currentPage>=totalPages;
  $('pageJump').max=totalPages;
  $('pageJump').value=currentPage;
}
function changePage(page){
  const totalPages=Math.max(1,Math.ceil(matches.length/PAGE_SIZE));
  currentPage=Math.min(Math.max(1,Number(page)||1),totalPages);
  renderPage();
  document.querySelector('.results')?.scrollTo({top:0,behavior:'smooth'});
}
function missingCount(r){return['NOMBRE_LOGEMENT','lot_area_sqft','assessment_building_area_sqft','ANNEE_CONSTRUCTION','metro_distance_m','pum_land_use'].filter(f=>get(r,f)===null||get(r,f)===undefined||get(r,f)==='').length}
function card(r,relevance=0){
  const tags=[];if(get(r,'planning_supportive'))tags.push('Planning supportive');if(get(r,'opportunity_sector'))tags.push('Opportunity area');if(get(r,'corner_lot_candidate'))tags.push('Corner');if(get(r,'heritage_legal'))tags.push('Legal heritage');if(get(r,'wetland_flood_constraint'))tags.push('Wetland/flood');
  const missing=missingCount(r);
  return`<article class="card" data-id="${get(r,'site_id')}"><div class="cardTop"><div><h3>${esc(get(r,'address'))}</h3><div class="sub">${esc(get(r,'municipality_name'))} · ${esc(get(r,'use_group'))} · ${esc(get(r,'MATRICULE83'))}</div></div><span class="score">${get(r,'opportunity_score')}</span></div>${relevance?`<div class="relevance">Search relevance ${relevance}</div>`:''}<div class="score-row"><div class="score-mini"><b>${fmt(get(r,'opportunity_score'))}</b><span>opportunity</span></div><div class="score-mini"><b>${fmt(get(r,'constraint_risk'))}</b><span>risk</span></div><div class="score-mini"><b>${fmt(get(r,'data_confidence'))}</b><span>confidence</span></div></div><div class="metrics"><div><strong>${Math.round(get(r,'lot_area_sqft')||0).toLocaleString()}</strong><span>lot ft²</span></div><div><strong>${fmt(get(r,'NOMBRE_LOGEMENT'))}</strong><span>dwellings</span></div><div><strong>${Number.isFinite(Number(get(r,'metro_distance_m')))?Math.round(get(r,'metro_distance_m')):'—'}</strong><span>metro m</span></div></div><div class="tags">${tags.map(x=>`<span class="tag ${x.includes('heritage')||x.includes('Wetland')?'warn':''}">${x}</span>`).join('')}</div>${missing?`<div class="missing">${missing} key field${missing>1?'s':''} unavailable</div>`:''}</article>`;
}
function scoreBreakdown(r){
  const lines=[
    ['Planning supportive',get(r,'planning_supportive')?'+15':'0'],
    ['PUM intensification',get(r,'intensification')||'Not available'],
    ['Opportunity sector',get(r,'opportunity_sector')?'+10':'0'],
    ['Lot size',`${Math.round(get(r,'lot_area_sqft')||0).toLocaleString()} ft²`],
    ['Open-site proxy',`${fmt(get(r,'assessment_open_site_pct'))}%`],
    ['Metro distance',`${fmt(get(r,'metro_distance_m'))} m`],
    ['Corner candidate',get(r,'corner_lot_candidate')?'+5':'0'],
    ['Recent permit activity',get(r,'recent_permit_5y')?'Yes':'No']
  ];
  return lines.map(([a,b])=>`<div class="score-line"><span>${esc(a)}</span><strong>${esc(b)}</strong></div>`).join('');
}
function fieldStatus(f,v){if(v===null||v===undefined||v==='')return'<span class="status-pill unknown">Not available</span>';const calculated=['assessment_coverage_pct','assessment_open_site_pct','metro_distance_m','future_transit_distance_m','corner_lot_candidate','double_frontage_candidate','opportunity_score','constraint_risk','data_confidence'];return calculated.includes(f)?'<span class="status-pill calculated">Calculated</span>':'<span class="status-pill confirmed">Source data</span>'}
function detail(r){
  const id=get(r,'site_id'),rec=saved[id]||{},dm=Object.fromEntries(defs.map(d=>[d.name,d.label]));
  const primary=['address','municipality_name','MATRICULE83','use_group','LIBELLE_UTILISATION','NOMBRE_LOGEMENT','lot_area_sqft','assessment_building_area_sqft','assessment_coverage_pct','assessment_open_site_pct','ANNEE_CONSTRUCTION','ETAGE_HORS_SOL','intensification','pum_land_use','metro_distance_m','nearest_metro','permit_count_5y','opportunity_score','constraint_risk','data_confidence'];
  $('detail').innerHTML=`<h2>${esc(get(r,'address'))}</h2><p class="sub">${esc(get(r,'municipality_name'))} · ${esc(get(r,'MATRICULE83'))} · ${esc(get(r,'housing_area'))}</p><div class="detail-tabs"><button class="detail-tab active" data-panel="overview">Overview</button><button class="detail-tab" data-panel="scores">Score explanation</button><button class="detail-tab" data-panel="all">All fields</button><button class="detail-tab" data-panel="notes">Notes</button></div><div id="panel-overview" class="detail-panel"><div class="detailGrid">${primary.map(f=>`<div class="box"><small>${esc(dm[f]||f)}</small><strong>${esc(fmt(get(r,f)))}</strong>${fieldStatus(f,get(r,f))}</div>`).join('')}</div></div><div id="panel-scores" class="detail-panel" hidden><h3>Opportunity score inputs</h3><div class="score-breakdown">${scoreBreakdown(r)}</div><p class="help">The opportunity score is a screening indicator, not a legal development-capacity determination.</p></div><div id="panel-all" class="detail-panel" hidden><table class="raw">${fields.filter(f=>!['longitude','latitude'].includes(f)).map(f=>`<tr><td>${esc(dm[f]||f)}</td><td>${esc(fmt(get(r,f)))}</td><td>${fieldStatus(f,get(r,f))}</td></tr>`).join('')}</table></div><div id="panel-notes" class="detail-panel" hidden><label>Notes<textarea id="notes" rows="5" style="width:100%">${esc(rec.notes||'')}</textarea></label><p><button id="saveOne">${rec.notes!==undefined?'Update saved':'Save property'}</button> ${rec.notes!==undefined?'<button id="removeOne" class="secondary">Remove</button>':''}</p></div><p><button id="propertyPdf" class="secondary">Export this property to PDF</button></p><p class="help">Screening only. Confirm legal zoning, ownership, title and development rights manually.</p>`;
  $('detailDialog').showModal();
  document.querySelectorAll('.detail-tab').forEach(b=>b.onclick=()=>{document.querySelectorAll('.detail-tab').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.detail-panel').forEach(x=>x.hidden=x.id!==`panel-${b.dataset.panel}`)});
  if($('saveOne'))$('saveOne').onclick=()=>{saved[id]={address:get(r,'address'),score:get(r,'opportunity_score'),notes:$('notes').value};persist();$('detailDialog').close()};
  if($('removeOne'))$('removeOne').onclick=()=>{delete saved[id];persist();$('detailDialog').close()};
  $('propertyPdf').onclick=()=>exportPropertyPdf(r);
}
function persist(){localStorage.setItem('mili_v22_saved',JSON.stringify(saved));$('savedCount').textContent=Object.keys(saved).length}
function clear(noApply=false){document.querySelectorAll('[data-field]').forEach(el=>el.type==='radio'?el.checked=el.value==='any':el.value='');$('globalSearch').value='';hideSuggestions();if(!noApply)apply()}
function setNum(f,k,v){const e=document.querySelector(`[data-field="${f}"][data-kind="${k}"]`);if(e)e.value=v}
function setCat(f,v){const e=document.querySelector(`[data-field="${f}"]`);if(e)e.value=v}
function setBool(f,v){const e=document.querySelector(`[data-field="${f}"][value="${v}"]`);if(e)e.checked=true}
function preset(n){clear(true);if(n==='residential'){setCat('use_group','Residential');setNum('NOMBRE_LOGEMENT','max',2)}if(n==='v1'){setCat('use_group','Residential');setNum('NOMBRE_LOGEMENT','max',2);setNum('lot_area_sqft','min',5000);setNum('metro_distance_m','max',800);setNum('opportunity_score','min',40);setBool('planning_supportive','true');setBool('wetland_flood_constraint','false')}if(n==='premium'){setCat('use_group','Residential');setNum('NOMBRE_LOGEMENT','max',2);setNum('lot_area_sqft','min',7500);setNum('assessment_coverage_pct','max',40);setNum('assessment_open_site_pct','min',60);setNum('metro_distance_m','max',800);setNum('opportunity_score','min',60);setBool('planning_supportive','true');setBool('opportunity_sector','true');setBool('heritage_legal','false');setBool('heritage_pum','false');setBool('heritage_value_sector','false');setBool('wetland_flood_constraint','false')}apply()}

function suggestionCandidates(q){const plan=queryPlan(q);if(!plan.corrected.length)return[];const found=[];for(let i=0;i<rows.length;i++){const score=searchScore(rows[i],i,plan);if(score<0)continue;found.push({row:rows[i],score});if(found.length>500&&score<850)break}found.sort((a,b)=>b.score-a.score||Number(get(b.row,'opportunity_score')||0)-Number(get(a.row,'opportunity_score')||0));const seen=new Set(),out=[];for(const x of found){const key=normalizeSearch(get(x.row,'address'))+'|'+get(x.row,'municipality_name');if(seen.has(key))continue;seen.add(key);out.push(x);if(out.length===10)break}return out}
function showSuggestions(){
  const q=$('globalSearch').value.trim(),box=$('searchSuggestions');currentSuggestion=-1;
  if(q.length<2){hideSuggestions();return}
  const list=suggestionCandidates(q);
  if(!list.length){box.innerHTML='<div class="suggest-empty">No close address or property matches.</div>';box.hidden=false;return}
  box.innerHTML=list.map(x=>`<button type="button" class="suggestion" data-id="${esc(get(x.row,'site_id'))}"><strong>${esc(get(x.row,'address'))}</strong><span>${esc(get(x.row,'municipality_name'))} · ${esc(get(x.row,'use_group'))} · Opportunity ${get(x.row,'opportunity_score')}</span></button>`).join('');
  box.hidden=false;
  box.querySelectorAll('.suggestion').forEach(b=>b.onclick=()=>selectSuggestion(b.dataset.id,list));
}
function selectSuggestion(id,list=suggestionCandidates($('globalSearch').value.trim())){const x=list.find(y=>get(y.row,'site_id')===id);if(!x)return;$('globalSearch').value=get(x.row,'address');hideSuggestions();apply();setTimeout(()=>{const m=markers.get(id);if(m){map.setView(m.getLatLng(),17);m.openPopup()}detail(x.row)},120)}
function moveSuggestion(dir){const box=$('searchSuggestions'),buttons=[...box.querySelectorAll('.suggestion')];if(!buttons.length)return;currentSuggestion=(currentSuggestion+dir+buttons.length)%buttons.length;buttons.forEach((b,i)=>b.classList.toggle('active',i===currentSuggestion));buttons[currentSuggestion].scrollIntoView({block:'nearest'})}
function hideSuggestions(){const box=$('searchSuggestions');box.hidden=true;box.innerHTML='';currentSuggestion=-1}

function filterSummary(){const out=[];const q=$('globalSearch').value.trim();if(q)out.push(`Search: ${q}`);for(const[f,a]of Object.entries(filters))out.push(filterLabel(f,a));return out}
function exportExcel(){
  if(!window.XLSX){alert('Excel library failed to load. Check your internet connection.');return}
  const exportFields=fields.filter(f=>!['longitude','latitude'].includes(f));
  const labels=Object.fromEntries(defs.map(d=>[d.name,d.label]));
  const data=matches.map(x=>Object.fromEntries(exportFields.map(f=>[labels[f]||f,get(x.row,f)])));
  const wb=XLSX.utils.book_new();
  const ws=XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb,ws,'Matches');
  const summary=XLSX.utils.aoa_to_sheet([['MILI Explorer 2.2 – Montréal Agglomeration'],['Export date',new Date().toLocaleString()],['Total matches',matches.length],[],['Active criteria'],...filterSummary().map(x=>[x])]);
  XLSX.utils.book_append_sheet(wb,summary,'Search Summary');
  XLSX.writeFile(wb,'MILI_Montreal_Agglomeration_matches.xlsx');
  $('exportDialog').close();
}
function pdfBase(title){
  const {jsPDF}=window.jspdf;const doc=new jsPDF({orientation:'landscape'});
  doc.setFontSize(16);doc.text(title,14,14);doc.setFontSize(9);doc.text(`Generated ${new Date().toLocaleString()}`,14,21);return doc;
}
function exportPdf(){
  if(!window.jspdf){alert('PDF library failed to load. Check your internet connection.');return}
  const doc=pdfBase('MILI Explorer 2.2 – Filtered Property Report');
  doc.setFontSize(10);doc.text(`Matching properties: ${matches.length.toLocaleString()}`,14,28);
  const criteria=filterSummary();let y=34;
  doc.setFontSize(8);doc.text(criteria.length?criteria.map(x=>'• '+x):['• No filters applied'],14,y,{maxWidth:260});y+=Math.max(12,criteria.length*4);
  const top=matches.slice(0,250).map(x=>{const r=x.row;return[get(r,'address'),get(r,'municipality_name'),get(r,'use_group'),Math.round(get(r,'lot_area_sqft')||0).toLocaleString(),fmt(get(r,'NOMBRE_LOGEMENT')),fmt(get(r,'metro_distance_m')),fmt(get(r,'opportunity_score')),fmt(get(r,'constraint_risk')),fmt(get(r,'data_confidence'))]});
  doc.autoTable({startY:y,head:[['Address','Municipality','Use','Lot ft²','Units','Metro m','Opp.','Risk','Confidence']],body:top,styles:{fontSize:6,cellPadding:1.5},headStyles:{fillColor:[30,91,80]}});
  if(matches.length>250){doc.setFontSize(8);doc.text(`PDF lists the top 250 of ${matches.length.toLocaleString()} matches. Excel contains the complete result set.`,14,doc.internal.pageSize.height-8)}
  doc.save('MILI_Montreal_Agglomeration_report.pdf');$('exportDialog').close();
}
function exportPropertyPdf(r){
  if(!window.jspdf){alert('PDF library failed to load.');return}
  const doc=pdfBase(`MILI Property Report – ${get(r,'address')}`);
  const labels=Object.fromEntries(defs.map(d=>[d.name,d.label]));
  const reportFields=['municipality_name','MATRICULE83','use_group','LIBELLE_UTILISATION','NOMBRE_LOGEMENT','lot_area_sqft','assessment_building_area_sqft','assessment_coverage_pct','assessment_open_site_pct','ANNEE_CONSTRUCTION','ETAGE_HORS_SOL','intensification','pum_land_use','opportunity_sector','nearest_metro','metro_distance_m','permit_count_5y','permit_count_10y','corner_lot_candidate','double_frontage_candidate','heritage_legal','heritage_pum','wetland_flood_constraint','opportunity_score','constraint_risk','data_confidence'];
  doc.autoTable({startY:28,head:[['Field','Value','Status']],body:reportFields.map(f=>[labels[f]||f,fmt(get(r,f)),(get(r,f)===null||get(r,f)===undefined||get(r,f)==='')?'Not available':['assessment_coverage_pct','assessment_open_site_pct','metro_distance_m','corner_lot_candidate','double_frontage_candidate','opportunity_score','constraint_risk','data_confidence'].includes(f)?'Calculated':'Source data']),styles:{fontSize:8},headStyles:{fillColor:[30,91,80]}});
  doc.setFontSize(8);doc.text('Screening only. Confirm legal zoning, ownership, title and development rights manually.',14,doc.internal.pageSize.height-8);
  doc.save(`MILI_${String(get(r,'address')).replace(/[^a-z0-9]+/gi,'_')}.pdf`);
}

$('applyBtn').onclick=apply;
$('clearBtn').onclick=()=>clear();
$('clearAllTop').onclick=()=>clear();
$('clearSearch').onclick=()=>{$('globalSearch').value='';hideSuggestions();apply()};
$('exportBtn').onclick=()=>$('exportDialog').showModal();
$('exportExcel').onclick=exportExcel;
$('exportPdf').onclick=exportPdf;
$('sortField').onchange=()=>{currentPage=1;sortRows(Boolean($('globalSearch').value.trim()));render()};
$('globalSearch').oninput=()=>{clearTimeout(searchTimer);showSuggestions();searchTimer=setTimeout(apply,350)};
$('globalSearch').onfocus=()=>{if($('globalSearch').value.trim().length>=2)showSuggestions()};
$('globalSearch').onkeydown=e=>{
  if(e.key==='ArrowDown'){e.preventDefault();moveSuggestion(1)}
  if(e.key==='ArrowUp'){e.preventDefault();moveSuggestion(-1)}
  if(e.key==='Enter'){clearTimeout(searchTimer);const active=$('searchSuggestions').querySelector('.suggestion.active');if(active){e.preventDefault();active.click()}else apply()}
  if(e.key==='Escape')hideSuggestions();
};
document.addEventListener('click',e=>{if(!e.target.closest('.search-wrap'))hideSuggestions()});
document.querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>preset(b.dataset.preset));
document.querySelectorAll('dialog .close').forEach(b=>b.onclick=()=>b.closest('dialog').close());
$('savedBtn').onclick=()=>{$('savedList').innerHTML=Object.values(saved).length?Object.values(saved).map(x=>`<article class="card"><b>${esc(x.address)}</b><div>Score ${x.score}</div><p>${esc(x.notes||'')}</p></article>`).join(''):'<p>No saved properties.</p>';$('savedDialog').showModal()};
$('expandAll').onclick=()=>document.querySelectorAll('.filter-group').forEach(x=>x.open=true);
$('collapseAll').onclick=()=>document.querySelectorAll('.filter-group').forEach(x=>x.open=false);
$('fitResults').onclick=()=>{const ms=[...markers.values()];if(ms.length)map.fitBounds(L.featureGroup(ms).getBounds().pad(.05))};
$('prevPage').onclick=()=>changePage(currentPage-1);
$('nextPage').onclick=()=>changePage(currentPage+1);
$('pageJump').onchange=e=>changePage(e.target.value);
window.addEventListener('resize',()=>setTimeout(()=>map.invalidateSize(),80));


load().catch(e=>{$('status').textContent='Load error: '+e.message;console.error(e);busy(false)});
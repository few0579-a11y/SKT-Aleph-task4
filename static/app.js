'use strict';
const $ = s => document.querySelector(s);
const esc = x => String(x ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const intensityLabel = x => ({10:'1',20:'2',30:'3',40:'4',45:'5약 / 5弱',50:'5강 / 5強',55:'6약 / 6弱',60:'6강 / 6強',70:'7'})[x] ?? (x == null ? '미수집' : '확인 필요');
const fmt = x => x ? String(x).replace('T',' ').replace(/\.\d+(?=\+|$)/,'').replace('+09:00',' KST') : '—';
const val = (id,value) => {const el=document.getElementById(id);if(el)el.textContent=value??'—';};
let recentFeed={events:[],note:"최근 지진 목록 조회 중..."};
let map=null,epicenterMarker=null,recentLayer=null;
let state={status:'LOADING',latest:null,records:[],comparison:null,error_code:null};
const GEO={minLon:122,maxLon:148,minLat:24,maxLat:46};
function redraw(){
 const x=state.latest;val('magnitude',x?.magnitude!=null?'M '+x.magnitude:'M --');val('location',x?.location||'표시할 지진 정보 없음');
 val('headlineDate',x?.event_time?.split(' ')[0]||'—');val('headlineTime',x?.event_time?.split(' ')[1]?x.event_time.split(' ')[1]+' JST':'—');val('intensity', x?.max_intensity != null ? intensityLabel(x.max_intensity) : '원천에 관측값 없음');val('depth',x?.depth!=null?x.depth+' km':'원천에 정보 없음');val('eventTime',x?.event_time?x.event_time+' JST':'—');val('issuedTime',x?.issued_time?x.issued_time+' JST':'—');val('fetchedTime',fmt(x?.fetched_at));
 const s=state.status==='FRESH'?'FRESH · 정상 조회':state.status==='STALE'?'STALE · 이전 정상값':'조회 중';
 for(const el of [$('#badge'),$('#systemState')]){if(!el)continue;el.className='state state-'+(state.status==='FRESH'?'fresh':state.status==='STALE'?'stale':'loading');el.textContent='● '+s;}
 const alert=$('#staleAlert');alert.classList.toggle('hidden',state.status!=='STALE');alert.textContent='데이터 조회 실패 ('+(state.error_code||'UNKNOWN')+'). 마지막 정상 조회 기록을 표시하고 있습니다. 최신 데이터가 아닐 수 있습니다.';
 val('connectionText',state.status==='FRESH'?'● API 조회 성공':state.status==='STALE'?'● API 조회 실패 / STALE':'● API 연결 중');val('checkedAt',fmt(state.checked_at));
 updateEpicenter(x);updateMapsLink();

 const records=[...(state.records||[])].sort((a,b)=>String(a.date).localeCompare(String(b.date)));
 val('countTag', '총 '+records.length+'건 / 合計 '+records.length+'件 (실제 조회 기록)');
 $('#recordsBody').innerHTML=records.length?records.slice(-5).reverse().map((r,i)=>`<tr><td>${i+1}</td><td>${esc(r.event_time||r.date)}<small class="date-sub">조회 ${esc(r.date)}</small></td><td>${esc(r.location)}</td><td><b class="m-col">${esc(r.magnitude)}</b></td><td>${esc(intensityLabel(r.max_intensity))}</td><td>${esc(r.depth??'미수집')}</td></tr>`).join(''):'<tr><td colspan="6">아직 저장된 기록이 없습니다.</td></tr>';
 renderRecentCharts();
 const c=state.comparison;
 renderHistogram();
 $('#comparison').innerHTML=`<div class="comparison-cards"><div class="comparison-item"><div class="comparison-label"><i class="today-dot"></i><span><b>오늘 / 今日</b><small>${esc(c?.current?.date||'실제 기록 대기')}</small></span></div><strong>${c?'M '+esc(c.current.magnitude):'—'}</strong><p>조회한 지진 규모 <small>取得した地震の規模</small></p><div class="stat-small"><span>지진 횟수 <small>地震の回数</small></span><b>미수집</b></div></div><div class="comparison-item"><div class="comparison-label"><i class="yesterday-dot"></i><span><b>이전 조회 / 前回取得</b><small>${esc(c?.previous?.date||'실제 기록 대기')}</small></span></div><strong>${c?'M '+esc(c.previous.magnitude):'—'}</strong><p>조회한 지진 규모 <small>取得した地震の規模</small></p><div class="stat-small"><span>지진 횟수 <small>地震の回数</small></span><b>미수집</b></div></div></div><p class="comparison-warning">${c?'규모 차이 '+(c.difference>0?'+':'')+esc(c.difference)+' · 실제 저장된 두 날짜 기준':'서로 다른 실제 KST 날짜 2건을 수집하면 규모 차이를 표시합니다.'}</p>`;
}
async function refresh(){val('connectionText','● API 다시 조회 중...');try{const res=await fetch('/api/live',{cache:'no-store'});if(!res.ok)throw Error('HTTP '+res.status);state=await res.json();}catch(error){state.status='STALE';state.error_code='LOCAL_SERVER_ERROR';}redraw();}
function modal(title,html){val('modalTitle',title);$('#modalBody').innerHTML=html;$('#modalBackdrop').classList.remove('hidden');$('#modalBackdrop').setAttribute('aria-hidden','false');$('#closeModal').focus();}
function closeModal(){$('#modalBackdrop').classList.add('hidden');$('#modalBackdrop').setAttribute('aria-hidden','true');}
function showModal(type){
 if(type==='history'){const rows=[...(state.records||[])].reverse();modal('날짜별 실제 조회 기록 / 日別取得履歴',`<p>Asia/Seoul 날짜 기준 하루 1건. 실제로 저장된 스냅샷만 표시합니다.</p><div class="table-scroller"><table><thead><tr><th>조회 날짜</th><th>규모</th><th>지역</th><th>발생 시각 (JST)</th><th>실제 수집 시각 (KST)</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.date)}</td><td>M${esc(r.magnitude)}</td><td>${esc(r.location)}</td><td>${esc(r.event_time)}</td><td>${esc(fmt(r.fetched_at))}</td></tr>`).join('')||'<tr><td colspan="5">조회 기록 없음</td></tr>'}</tbody></table></div>`);return;}
 if(type==='compare'){const c=state.comparison;modal('날짜별 규모 비교 / 日別比較',c?`<div class="comparison-cards"><div class="comparison-item"><small>${esc(c.previous.date)}</small><strong>M${esc(c.previous.magnitude)}</strong><p>${esc(c.previous.location)}</p></div><div class="comparison-item"><small>${esc(c.current.date)}</small><strong>M${esc(c.current.magnitude)}</strong><p>${esc(c.current.location)}</p></div></div><p>규모 차이: <b>${c.difference>0?'+':''}${esc(c.difference)}</b>. 이 값은 두 날의 수집된 지진 사례를 비교하며, 지진 위험도나 발생 빈도를 나타내지 않습니다.</p>`:'<div class="notice">서로 다른 실제 KST 날짜에서 직접 수집된 2건의 기록이 필요합니다.</div>');return;}
 if(type==='about'){modal('출처·데이터 안내 / 出典',`<p><b>발표 원천:</b> 일본 기상청(気象庁)<br><b>공개 API:</b> <a href="https://api.p2pquake.net/v2/jma/quake" target="_blank" rel="noopener">P2P地震情報 /v2/jma/quake</a><br><b>규모 단위:</b> M (Magnitude)<br><b>발생·발표 시각:</b> JST · UTC+09<br><b>조회·날짜키:</b> KST · Asia/Seoul (UTC+09)</p><p>이 프로젝트는 공개 지진 통보 정보를 조회하며 일본 기상청 긴급지진속보를 대체하지 않습니다. 규모와 진도는 다른 지표입니다. 진도는 실제 소스에서 제공되는 경우에만 표시해야 합니다.</p>`);return;}
 if(type==='guide'){modal('지진 정보 가이드 / 地震ガイド',`<h3>규모와 진도는 다릅니다</h3><p><b>규모(M)</b>는 지진 자체의 크기이며 <b>진도(震度)</b>는 관측 지역의 흔들림을 나타냅니다. 규모만으로 진도를 추정하지 않습니다.</p><h3>지진이 발생했을 때</h3><p>몸을 낮추고, 머리를 보호하고, 흔들림이 멈출 때까지 안전을 확보하세요.</p><a target="_blank" rel="noopener" href="https://www.jma.go.jp/jma/kishou/know/jishin/joho/seisinfo.html">일본 기상청 공식 지진 설명 확인 ↗</a>`);return;}
 if(type==='test'){modal('합성 오류 시험 / 障害シミュレーション',`<div class="notice">이 테스트는 독립적인 시연입니다. 실제 API 요청이나 저장 데이터 및 현재 FRESH 상태를 수정하지 않습니다.</div><p>시험 종류를 선택하세요.</p><div class="test-grid"><button data-scenario="timeout">① 느린 응답 / TIMEOUT</button><button data-scenario="denied">② 접근 거절 / 403</button><button data-scenario="rate">③ 호출 제한 / 429</button><button data-scenario="offline">④ 네트워크 오프라인</button><button data-scenario="schema">⑤ 응답 형식 변경</button><button data-scenario="recover">↻ 합성 복구 시연</button></div><div id="testOutput" class="test-output hidden"></div><p>참고: 공식 ALEPH fixture 검사 및 T04-RECOVER-D2 검증은 별도 미완료입니다.</p>`);}
}
async function scenario(which){const el=$('#testOutput');el.classList.remove('hidden');el.textContent='시나리오 실행 중...';try{const r=await fetch('/api/simulate/'+encodeURIComponent(which),{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);const d=await r.json();el.innerHTML=`<strong>${esc(d.status)} · ${esc(d.error_code??'NONE')}</strong><div>${esc(d.message)}</div><div>${d.action?'다음 행동: '+esc(d.action):''}</div><div>마지막 정상 저장값: ${d.last_good?'M'+esc(d.last_good.magnitude)+' / '+esc(d.last_good.location):'없음'}</div><small>합성 시험 데이터 · 실제 원천 기록 변경 없음</small>`;}catch(e){el.textContent='시험 실패: '+e.message;}}
$('#refreshTop').addEventListener('click',refresh);$('#refreshButton').addEventListener('click',refresh);document.querySelectorAll('[data-modal]').forEach(b=>b.addEventListener('click',()=>showModal(b.dataset.modal)));
$('#closeModal').addEventListener('click',closeModal);$('#modalBackdrop').addEventListener('click',e=>{if(e.target===$('#modalBackdrop'))closeModal()});document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});document.addEventListener('click',e=>{const b=e.target.closest('[data-scenario]');if(b)scenario(b.dataset.scenario)});
function initializeMap(){
 const notice=$('#mapError');
 if(!window.L){notice.textContent='Leaflet 지도 라이브러리를 불러오지 못했습니다. 인터넷을 확인하세요.';notice.classList.remove('hidden');return;}
 map=L.map('leafletMap',{zoomControl:true,scrollWheelZoom:true,preferCanvas:true,zoomSnap:.25,zoomDelta:.5,worldCopyJump:false});
 map.setView([36.5,137.5],4.7);
 L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
  attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',maxZoom:18, minZoom:3,crossOrigin:true
 }).on('tileerror',()=>{notice.classList.remove('hidden')}).on('load',()=>{notice.classList.add('hidden')}).addTo(map);
 recentLayer=L.layerGroup().addTo(map);
 const reset=$('#mapReset');if(reset)reset.addEventListener('click',()=>map.flyTo([36.5,137.5],4.7,{duration:.7}));
 requestAnimationFrame(()=>map.invalidateSize());
 updateEpicenter(state.latest);drawMapHistory();
}
function updateEpicenter(x){
 if(!map)return;
 const lat=x?.latitude,lon=x?.longitude,valid=typeof lat==='number'&&typeof lon==='number'&&lat>=24&&lat<=46&&lon>=122&&lon<=148;
 if(epicenterMarker){map.removeLayer(epicenterMarker);epicenterMarker=null;}
 $('#noPoint').classList.toggle('hidden',!!valid);
 if(!valid){$('#noPoint').textContent='현재 조회 기록에 실제 진앙 좌표가 없습니다.';return;}
 epicenterMarker=L.circleMarker([lat,lon],{radius:10,color:'#ffffff',weight:3,fillColor:'#d94349',fillOpacity:.95}).addTo(map);
 L.circle([lat,lon],{radius:40000,color:'#ec777a',weight:1.5,opacity:.65,fillOpacity:.07,interactive:false}).addTo(recentLayer);
 epicenterMarker.bindPopup(`<b>M ${esc(x.magnitude)} · ${esc(x.location)}</b><br>${esc(x.event_time)} JST`);
}
function drawMapHistory(){
 if(!map||!recentLayer)return;
 recentLayer.clearLayers();
 for(const x of recentFeed.events.slice(0,65)){
  if(typeof x.latitude!=='number'||typeof x.longitude!=='number')continue;
  const color=magColor(Number(x.magnitude));
  L.circleMarker([x.latitude,x.longitude],{radius:Math.max(3,Math.min(7,Number(x.magnitude)*1.1)),color:'#fff',weight:.6,fillColor:color,fillOpacity:.8})
   .bindPopup(`M${esc(x.magnitude)} · ${esc(x.location)}<br>${esc(x.event_time)} JST`).addTo(recentLayer);
 }
}
function magColor(m){return m>=5?'#e75e60':m>=4?'#ef9750':m>=3?'#f0ce62':m>=2?'#61b9a1':'#75aadb'}
function magBin(m){return m>=6?5:m>=5?4:m>=4?3:m>=3?2:m>=2?1:0}
function renderHistogram(){
 const ev=recentFeed.events||[];
 const dates=[...new Set(ev.map(x=>x.event_date))].sort().reverse();
 const [today,yesterday]=dates;
 const t=Array(6).fill(0),y=Array(6).fill(0);
 for(const e of ev){if(e.event_date===today)t[magBin(e.magnitude)]++;if(e.event_date===yesterday)y[magBin(e.magnitude)]++;}
 const ymax=Math.max(5,Math.ceil(Math.max(...t,...y)/5)*5);
 const labels=['M<2','M2','M3','M4','M5','M6+'];
 $('#miniCompareChart').innerHTML=`<div class="actual-hist"><div class="hist-caption">최근 발표 표본: ${esc(today||'대기')} / ${esc(yesterday||'대기')} <small>서로 다른 최신 발생일 2개 · 표본 통계</small></div><div class="actual-hist-plot"><div class="hist-scale">${[4,3,2,1,0].map(i=>`<span>${Math.round(ymax*i/4)}</span>`).join('')}</div><div class="hist-draw">${[1,2,3].map(i=>`<div class="hist-grid" style="bottom:${i*25}%"></div>`).join('')}${labels.map((label,i)=>`<div class="hist-group" title="${esc(label)}: 첫째 ${t[i]}건, 둘째 ${y[i]}건"><div class="hist-bars"><b style="height:${t[i]/ymax*100}%"></b><i style="height:${y[i]/ymax*100}%"></i></div><span>${label}</span></div>`).join('')}</div></div><div class="hist-small-note">${esc(recentFeed.note)} · 분홍: 최근 발생일 / 파랑: 이전 발생일</div></div>`;
}
function renderRecentCharts(){
 const ev=recentFeed.events||[];
 const sorted=[...ev].filter(e=>e.magnitude>=2).sort((a,b)=>a.event_time.localeCompare(b.event_time)).slice(-65);
 const first=sorted[0]?.event_time||'',last=sorted.at(-1)?.event_time||'';
 $('#timeline').innerHTML=`<div class="event-trend"><div class="trend-top"><span>규모 (M)</span><span>${ev.length}건의 고유 지진 · 최근 발표 표본</span></div><div class="trend-plot"><div class="trend-axis">${[6,4,2,0].map(i=>`<span>${i}</span>`).join('')}</div><div class="trend-canvas">${[0,2,4,6].map(i=>`<i class="trend-line" style="bottom:${i/7*100}%"></i>`).join('')}${sorted.map((e,i)=>`<b class="trend-dot" title="${esc(e.event_time)} JST · M${esc(e.magnitude)} · ${esc(e.location)}" style="left:${(i+.5)/sorted.length*100}%;bottom:${Math.min(e.magnitude,7)/7*100}%;width:${Math.max(6,e.magnitude*2.2)}px;height:${Math.max(6,e.magnitude*2.2)}px;background:${magColor(e.magnitude)}"></b>`).join('')}</div></div><div class="trend-dates"><span>${esc(first||'데이터 없음')} JST</span><span>${esc(last||'데이터 없음')} JST</span></div><p class="trend-note">${esc(recentFeed.note)} · 단위: 규모(M), 각 점은 한 지진 / 一点一地震</p></div>`;
}
async function fetchRecent(){
 try{const r=await fetch('/api/recent',{cache:'no-store'});if(!r.ok)throw Error('최근 기록 HTTP '+r.status);recentFeed=await r.json();}
 catch(e){recentFeed={events:[],note:'최근 발표 표본 불러오기 실패: '+e.message};}
 renderHistogram();renderRecentCharts();drawMapHistory();
}
const mfocus=document.getElementById('focusMap');

function tick(){val('clock',new Date().toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour12:false})+' KST')}tick();setInterval(tick,1000);redraw();initializeMap();refresh();fetchRecent();

// Emergency UI is a design preview only; it does not simulate a real earthquake alert.
const emergencyBackdrop=document.getElementById('emergencyBackdrop');
const emergencyPreview=document.getElementById('emergencyPreview');
const closeEmergencyButton=document.getElementById('closeEmergency');
function closeEmergency(){emergencyBackdrop.classList.add('hidden');emergencyBackdrop.setAttribute('aria-hidden','true');emergencyPreview.focus();}
emergencyPreview.addEventListener('click',()=>{document.getElementById('emergencyLastGood').textContent=fmt(state.latest?.fetched_at);emergencyBackdrop.classList.remove('hidden');emergencyBackdrop.setAttribute('aria-hidden','false');closeEmergencyButton.focus();});
closeEmergencyButton.addEventListener('click',closeEmergency);
emergencyBackdrop.addEventListener('click',e=>{if(e.target===emergencyBackdrop)closeEmergency()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!emergencyBackdrop.classList.contains('hidden'))closeEmergency()});


// Reference-image interactions: visible hover preview and map focus.
const rp=document.getElementById('hoverPreview');
const hints={history:'실제로 저장한 날짜별 지진 기록을 조회합니다. / 日別取得履歴',compare:'서로 다른 실제 KST 날짜 2건의 규모 차이를 보여줍니다. / 日別比較',about:'기상청 원천·P2P API·조회 시각 및 출처 안내 / 出典',guide:'규모와 진도의 차이 및 지진 행동 요령 / 地震ガイド',test:'합성 오류 5종을 시험하며 실제 기록을 바꾸지 않습니다. / 障害テスト'};
document.querySelectorAll('[data-modal]').forEach(el=>{el.addEventListener('mouseenter',()=>{rp.textContent=hints[el.dataset.modal]||'상세 정보';let b=el.getBoundingClientRect();rp.style.left=Math.min(b.left,innerWidth-290)+'px';rp.style.top=Math.max(5,b.top-74)+'px';rp.classList.remove('hidden')});el.addEventListener('mouseleave',()=>rp.classList.add('hidden'));el.addEventListener('focus',()=>rp.classList.add('hidden'))});
function updateMapsLink(){const x=state.latest;const valid=x&&typeof x.latitude==='number'&&typeof x.longitude==='number';if(mfocus){mfocus.href=valid?'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(x.latitude+','+x.longitude):'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(x?.location||'Japan');}}if(mfocus)mfocus.addEventListener('click',updateMapsLink); 
const rc=document.getElementById('refreshCard');if(rc)rc.addEventListener('click',refresh);

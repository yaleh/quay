/* Fixed inspection snapshot. No API calls, mutations, timers or live claims. */
const icons = {
  overview:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  tasks:'<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 10h6M9 14h6M9 18h3"/>',
  target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  inbox:'<path d="m3 14 3-9h12l3 9v6H3Z M3 14h5l2 3h4l2-3h5"/>',
  pulse:'<path d="M2 12h5l3-8 4 16 3-8h5"/>',
  board:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M5 7h2m4 0h2m4 0h2M5 11h2m6 0h-2"/>',
  'check-square':'<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m7 12 3 3 7-7"/>',
  layers:'<path d="m3 7 9-4 9 4-9 4ZM3 12l9 4 9-4M3 17l9 4 9-4"/>',
  sliders:'<path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  terminal:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m6 0h4"/>',
  branch:'<circle cx="6" cy="5" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10M18 9c0 6-12 3-12 8"/>',
  journal:'<path d="M7 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm3 0v18M2 7h5m-5 5h5m-5 5h5m6-10h4m-4 5h4"/>',
  decision:'<path d="m12 3 4 4-4 4-4-4Zm0 8v4M5 19v-4h14v4"/><circle cx="5" cy="20" r="1"/><circle cx="19" cy="20" r="1"/>',
  book:'<path d="M12 5v15M12 5C8 2 4 3 2 4v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-2-1-6-2-10 1Z"/>',
  network:'<rect x="9" y="2" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="16" y="16" width="6" height="6" rx="1"/><path d="M12 8v4M5 16v-4h14v4"/>',
  workspace:'<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 9v12"/>',
  chevrons:'<path d="m8 8 4-4 4 4m-8 8 4 4 4-4"/>',
  'chevron-down':'<path d="m6 9 6 6 6-6"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.5"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 11h18M7 15h2m3 0h2"/>',
  'arrow-up-right':'<path d="M6 18 18 6M6 6h12v12"/>',
  'arrow-right':'<path d="M4 12h16m-6-6 6 6-6 6"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  moon:'<path d="M20 14a9 9 0 0 1-10-11 9 9 0 1 0 10 11Z"/>',
  commit:'<circle cx="12" cy="12" r="4"/><path d="M2 12h6m8 0h6"/>',
};
function icon(name){return `<i data-icon="${name}" aria-hidden="true"><svg viewBox="0 0 24 24">${icons[name]||icons.info}</svg></i>`;}
function hydrateIcons(root=document){root.querySelectorAll('i[data-icon]:empty').forEach(el=>{el.setAttribute('aria-hidden','true');el.innerHTML=`<svg viewBox="0 0 24 24">${icons[el.dataset.icon]||icons.info}</svg>`;});}
const origin = location.protocol === 'file:' ? 'http://localhost:12931' : `${location.protocol}//${location.hostname}:12931`;
function wireRoutes(root=document){root.querySelectorAll('[data-route]').forEach(a=>{a.href=origin+a.dataset.route;a.target='_blank';a.rel='noopener';a.title='在新标签页打开现有 Quay 页面';});}
const snapshotEnd=Date.parse('2026-09-24T22:40:00+08:00');
const taskRuns=[
  {title:'目标列表：搜索与验收排序',id:'gap-webui-goal-list-title-search-and-ac-rollup-sort',start:'21:05:13',end:'21:18:33',test:'21:17:39',testSeconds:43,lock:73,round:2139,sha:'5e47db1',detail:'landing1'},
  {title:'目标列表：精简低信号字段',id:'gap-webui-goal-list-prune-low-signal-columns',start:'20:49:34',end:'21:04:20',test:'21:03:29',testSeconds:41,lock:65,round:2138,sha:'2a74649',detail:'landing2'},
  {title:'目标列表：完整 ID 与状态',id:'gap-webui-goal-list-full-id-status-title-and-real-width-ac',start:'20:29:54',end:'20:49:10',test:'20:47:52',testSeconds:38,lock:69,round:2137,sha:'b038ae6',detail:'landing3'},
];
const at=t=>Date.parse(`2026-09-24T${t}+08:00`);
const timeLabel=t=>new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Shanghai'}).format(t);
function renderTimeline(hours){
  const start=snapshotEnd-hours*3600000,span=hours*3600000;
  const visible=taskRuns.filter(r=>r.start&&at(r.end)>start&&at(r.start)<snapshotEnd);
  const landings=taskRuns.filter(r=>at(r.end)>start&&at(r.end)<=snapshotEnd);
  document.getElementById('run-count').textContent=visible.length;
  document.getElementById('landing-count').textContent=landings.length;
  const chart=document.getElementById('timeline');
  chart.setAttribute('aria-label',`快照前 ${hours} 小时：${visible.length} 次有完整执行区间的任务，${landings.length} 次落地`);
  let markup='';
  if(!visible.length){markup='<div class="timeline-empty"><span>这段时间，系统在安静待命。</span><small>最近一次完成于 21:18 · 切换到 3h 查看执行轨迹</small></div>';}
  else{
    const rows=[{name:'执行',icon:'terminal',kind:'run'},{name:'验证',icon:'check-square',kind:'test'},{name:'落地',icon:'branch',kind:'land'}];
    markup=rows.map(row=>{
      const runs=row.kind==='land'?landings:visible;
      const bars=[...runs].reverse().map(r=>{
        const end=row.kind==='test'?at(r.test)+r.testSeconds*1000:at(r.end);
        const begin=row.kind==='run'?at(r.start):row.kind==='test'?at(r.test):end-r.lock*1000;
        const left=Math.max(0,(begin-start)/span*100),width=(Math.min(end,snapshotEnd)-Math.max(begin,start))/span*100;
        return `<button class="timeline-bar" style="left:${left}%;width:${width}%" data-detail="${r.detail}" aria-label="${r.title}，${row.name}，${timeLabel(begin)} 至 ${timeLabel(end)}，点击查看详情"><span class="bar-caption">${row.kind==='run'?'#'+r.round:''}</span><span class="timeline-tooltip">${r.title}<br>${row.name} · ${timeLabel(begin)} – ${timeLabel(end)}</span></button>`;
      }).join('');
      return `<div class="timeline-row"><span class="timeline-label">${icon(row.icon)}${row.name}</span><div class="track">${bars}</div></div>`;
    }).join('');
    markup+='<span class="timeline-idle">'+icon('moon')+'当前空闲</span>';
  }
  markup+=`<div class="timeline-axis">${[0,.25,.5,.75].map(f=>`<span>${timeLabel(start+span*f)}</span>`).join('')}<span>22:40</span></div>`;
  if(visible.length)markup+='<div class="timeline-now"><span>快照</span></div>';
  chart.innerHTML=markup;
  document.querySelectorAll('[data-window]').forEach(b=>{const selected=+b.dataset.window===hours;b.classList.toggle('active',selected);b.setAttribute('aria-pressed',selected);});
}

const events=[
  {type:'git',title:'刷新目标证据的时效性记录',sub:'routine(freshness-refresh) · findings round',sha:'8acbd93',time:'22:20',state:'已提交',detail:'commit1'},
  {type:'landing',title:'目标列表支持标题搜索与验收达成率排序',sub:'gap-webui-goal-list-title-search-and-ac-rollup-sort',sha:'5e47db1',time:'21:18',state:'已落地',detail:'landing1'},
  {type:'tests',title:'第 2,139 轮验证通过',sub:'3,842 个测试全部通过 · 43 秒 · bucket P',sha:'91d5257',time:'21:18',state:'全部通过',detail:'tests'},
  {type:'landing',title:'精简目标列表低信号字段，突出核心信息',sub:'gap-webui-goal-list-prune-low-signal-columns',sha:'2a74649',time:'21:04',state:'已落地',detail:'landing2'},
  {type:'landing',title:'完整显示目标 ID、状态与长标题',sub:'gap-webui-goal-list-full-id-status-title-and-real-width-ac',sha:'b038ae6',time:'20:49',state:'已落地',detail:'landing3'},
  {type:'tests',title:'第 2,138 轮验证通过',sub:'3,838 个测试全部通过 · 41 秒 · bucket P',sha:'a95f42f',time:'21:04',state:'全部通过',detail:'tests2138'},
  {type:'tests',title:'第 2,137 轮验证通过',sub:'3,833 个测试全部通过 · 38 秒 · bucket P',sha:'9d04663',time:'20:48',state:'全部通过',detail:'tests2137'},
  {type:'git',title:'任务验收完成，变更已机械落地',sub:'tasks: 翻 gap-webui-goal-list-title-search-and-ac-rollup-sort done',sha:'5e47db1',time:'21:18',state:'已提交',detail:'landing1'},
  {type:'git',title:'合入 develop 的最新变更',sub:"Merge branch 'develop' into task/…",sha:'91d5257',time:'—',state:'合并提交',detail:'commit3'},
];
function renderActivity(filter='all'){
  const shown=filter==='all'?events.slice(0,5):events.filter(e=>e.type===filter);
  document.getElementById('activity-list').innerHTML=shown.map(e=>`<button class="activity-row" data-detail="${e.detail}"><span class="activity-icon ${e.type}">${icon(e.type==='landing'?'branch':e.type==='tests'?'check-square':'commit')}</span><span class="activity-copy"><span class="activity-title" style="display:block">${e.title}</span><span class="activity-description" style="display:block">${e.sub}</span></span><span class="activity-hash">${e.sha}</span><span class="badge ${e.type==='git'?'neutral':'positive'}">${e.state}</span><time class="activity-time">${e.time}</time>${icon('arrow-up-right').replace('data-icon','class="activity-arrow" data-icon')}</button>`).join('');
  document.getElementById('activity-count').textContent=`${filter==='all'?'最近':'共'} ${shown.length} 条记录 · UTC+8`;
  document.querySelectorAll('[data-filter]').forEach(b=>{const selected=b.dataset.filter===filter;b.classList.toggle('active',selected);b.setAttribute('aria-pressed',selected);});
}

const stats=items=>'<div class="detail-stats">'+items.map(([name,value])=>`<div class="detail-stat"><span>${name}</span><strong>${value}</strong></div>`).join('')+'</div>';
const list=items=>'<ul class="detail-list">'+items.map(([name,value])=>`<li><span>${name}</span><span>${value}</span></li>`).join('')+'</ul>';
const link=(route,label)=>`<a class="button-primary" data-route="${route}">${label}${icon('arrow-up-right')}</a>`;
const details={
  snapshot:{eyebrow:'DESIGN STUDY / 01',title:'一份可以探索的项目快照',body:'<p class="detail-intro">这是 Quay Dashboard 的独立静态原型。核心读数取自 2026 年 9 月 24 日 22:40 的页面检查，时间轴使用已观察到的历史执行区间。</p>'+list([['快照时间','2026-09-24 22:40 · UTC+8'],['数据模式','固定快照 · 不自动刷新'],['设计方向','Harbor / 暖白与松绿'],['可体验交互','时间窗口、活动筛选、详情、快捷搜索']])+'<div class="detail-callout">普通页面入口会在新标签页打开端口 12931 上的现有 Quay。当前原型的交互只改变本地展示，不提交操作。</div>'},
  workspace:{eyebrow:'WORKSPACE / QUAY',title:'一个工作空间，一条证据链',body:'<p>目标、任务、执行与落地，都在同一个项目语境中。</p>'+list([['项目','quay'],['项目路径','/data/home/yale/work/quay'],['Provider','Native'],['默认分支','develop'],['文档分支','author'],['交付物版本','0.13.0-dev'],['工作区落盘版本','未接入 / 无数据']])},
  about:{eyebrow:'QUAY / HARBOR',title:'每一步，都有着落。',body:'<p class="detail-intro">一个以证据为基础的工程工作台。先看项目是否健康，再看目标是否推进，最后追溯每一次落地。</p><div class="detail-tags"><span>暖白画布</span><span>松绿运行面板</span><span>语义化状态</span><span>渐进展开</span></div><p>本原型聚焦 Dashboard 的视觉方向、信息层级和交互手感，作为下一步全站改进的讨论基准。</p>'},
  goals:{eyebrow:'GOALS / ACTIVE',title:'两个目标，正在靠近',body:'<p>当前活跃目标共 2 个，上限为 5 个。两者合计 12 项验收条件中已有 10 项达成；这只是条件计数，不等同于目标已完成。</p>'+stats([['GOAL-020','7 / 8'],['GOAL-022','3 / 4']])+link('/goal','打开全部目标')},
  execution:{eyebrow:'EXECUTION / IDLE',title:'在线，且有余量',body:'<p>调度处于运行状态，当前在飞任务为 0，并发上限为 5。空闲是本次快照的实际状态。</p>'+stats([['当前执行','0 / 5'],['最近三小时完成','3 次']])+'<div class="detail-callout">最近一次任务完成于 21:18。切换时间窗口，可以区分当前空闲与此前的执行轨迹。</div>'+link('/live','打开实时活动')},
  tests:{eyebrow:'VERIFICATION / ROUND 2139',title:'3,842 个测试，全部通过',body:'<p>最近一次记录为 bucket P 验证轮次。通过率仅描述这一轮的测试范围。</p>'+stats([['通过率','100%'],['执行耗时','43 秒']])+list([['轮次','#2139'],['开始时间','2026-09-24 21:17:39 · UTC+8'],['提交','91d5257f'],['范围','worktree · bucket P'],['失败 / 取消','0 / 0']])+'<div class="detail-callout">验证结果、任务状态与目标验收是不同层面的证据，不能互相替代。</div>'+link('/tests','打开测试验证')},
  human:{eyebrow:'ATTENTION / CLEAR',title:'此刻，没有待接手的任务',body:'<p>任务台账中当前 needs-human 数量为 0。历史升级记录仍可以追溯，但不计入当前等待人工处理的数量。</p>'+stats([['当前等待','0 个'],['可用执行槽','5 个']])+link('/needs-human','打开待人工页面')},
  goal020:{eyebrow:'GOAL-020 / ACTIVE',title:'让 CI 与发布渠道成为可信的守门员',body:'<p class="detail-intro">CI 与 release 渠道成为可信守门员：develop 首绿 + release 能发出三平台可用产物。</p>'+stats([['验收条件已达成','7 / 8'],['关联任务已完成','18 / 18']])+'<div class="detail-callout">任务完成数与目标验收进度分开呈现。关联任务已经完成，也仍需要目标层面的真实结果来确认达成。</div>'+link('/goal/GOAL-020','查看目标与验收证据')},
  goal022:{eyebrow:'GOAL-022 / ACTIVE',title:'让每一轮 CI 在 30 秒内给出答案',body:'<p class="detail-intro">self-hosted CI test job 墙钟压到 30 秒内——128 核机器实测 93.9% 空闲，瓶颈是文件粒度太粗与重复装包。</p>'+stats([['验收条件已达成','3 / 4'],['关联任务已完成','9 / 9']])+'<div class="detail-callout">30 秒是目标阈值，不是当前测量结果。首页最近测试轮次的 43 秒也不能直接当作此目标的 CI 墙钟读数。</div>'+link('/goal/GOAL-022','查看目标与验收证据')},
  commit1:{eyebrow:'GIT / 8ACBD93',title:'刷新目标证据的时效性记录',body:'<p>routine(freshness-refresh): findings round freshness-refresh-1790259623037</p>'+list([['提交','8acbd93'],['记录时间','2026-09-24 22:20 · UTC+8']])+'<div class="detail-callout">这是记录更新，不代表有新的任务落地。活动流用独立类别区分提交、验证与落地。</div>'+link('/git-history','打开提交历史')},
  commit3:{eyebrow:'GIT / 91D5257',title:'合入 develop 的最新变更',body:'<p>Merge branch develop into task/gap-webui-goal-list-title-search-and-ac-rollup-sort</p>'+list([['提交','91d5257'],['时间','本快照未收集']])+'<div class="detail-callout">记录缺少时间时显示未知，不推测时间或新鲜度。</div>'+link('/git-history','打开提交历史')},
};
taskRuns.forEach(r=>{details[r.detail]={eyebrow:'FAN-IN / LANDED',title:r.title,body:`<p class="detail-intro mono" style="font-size:11px;overflow-wrap:anywhere">${r.id}</p>`+stats([['落地状态','已落地'],['锁持有时间',r.lock+' 秒']])+list([['执行开始',r.start?r.start+' · UTC+8':'本快照未收集'],['完成时间',r.end+' · UTC+8'],['落地提交',r.sha],['验证轮次','#'+r.round]])+'<div class="detail-callout">首页展示摘要，完整任务、验收条件和 fan-in 证据仍保留在现有详情页面中。</div>'+link('/task/'+r.id,'打开任务与落地证据')};});
[['tests2138','2138','3,838','41'],['tests2137','2137','3,833','38']].forEach(([key,round,pass,duration])=>{details[key]={eyebrow:'VERIFICATION / ROUND '+round,title:`第 ${round} 轮验证通过`,body:stats([['测试通过',pass+' / '+pass],['耗时',duration+' 秒']])+list([['范围','worktree · bucket P'],['失败 / 取消','0 / 0']])+link('/tests','打开测试验证')};});
const detailDialog=document.getElementById('detail-dialog');
const searchDialog=document.getElementById('search-dialog');
function showDetail(key){
  const detail=details[key];if(!detail)return;
  if(searchDialog.open)searchDialog.close();
  document.getElementById('detail-eyebrow').textContent=detail.eyebrow;
  document.getElementById('detail-body').innerHTML=`<h2 id="detail-title">${detail.title}</h2>${detail.body}`;
  hydrateIcons(detailDialog);wireRoutes(detailDialog);
  detailDialog.showModal();detailDialog.scrollTop=0;
}

const pageItems=[['项目概览','overview','/dashboard'],['任务台账','tasks','/tasks'],['阶段目标','target','/goal'],['待人工','inbox','/needs-human'],['实时活动','pulse','/live'],['执行看板','board','/board'],['测试验证','check-square','/tests'],['系统资源','layers','/system'],['调度管理','sliders','/manager'],['会话','terminal','/sessions'],['Git 历史','branch','/git-history'],['运行日志','journal','/journal'],['架构决策','decision','/adr'],['文档','book','/doc'],['架构地图','network','/architecture']].map(([title,icon,route])=>({title,icon,route,sub:'打开现有 Quay 页面 · '+route}));
const searchItems=[{title:'让 CI 与发布渠道成为可信的守门员',sub:'阶段目标 · GOAL-020 · 7/8 项验收达成',detail:'goal020',icon:'target'},{title:'让每一轮 CI 在 30 秒内给出答案',sub:'阶段目标 · GOAL-022 · 3/4 项验收达成',detail:'goal022',icon:'target'},...pageItems,...events.slice(0,5).map(e=>({title:e.title,sub:e.sub,detail:e.detail,icon:e.type==='tests'?'check-square':'branch'}))];
function renderSearch(query=''){
  const matches=searchItems.filter(x=>(x.title+' '+x.sub).toLowerCase().includes(query.trim().toLowerCase())).slice(0,12);
  document.getElementById('search-results').innerHTML=matches.length?matches.map(x=>`<${x.route?'a':'button'} class="search-result" ${x.route?`data-route="${x.route}"`:`data-detail="${x.detail}"`}>${icon(x.icon)}<span>${x.title}<small>${x.sub}</small></span>${icon('arrow-up-right')}</${x.route?'a':'button'}>`).join(''):'<p class="search-empty">没有找到匹配项。试试「目标」「测试」或「GOAL-020」。</p>';
  wireRoutes(searchDialog);
}
function openSearch(){if(detailDialog.open)detailDialog.close();setMenu(false);renderSearch();document.getElementById('search-input').value='';searchDialog.showModal();document.getElementById('search-input').focus();}
const menuToggle=document.getElementById('menu-toggle');
function setMenu(open){
  const sidebar=document.getElementById('sidebar');
  const mobile=innerWidth<=760;
  sidebar.classList.toggle('open',open);
  sidebar.inert=mobile&&!open;
  if(mobile&&!open)sidebar.setAttribute('aria-hidden','true');else sidebar.removeAttribute('aria-hidden');
  document.getElementById('mobile-scrim').classList.toggle('visible',open);
  document.body.classList.toggle('menu-open',open);
  menuToggle.setAttribute('aria-expanded',String(open));
  menuToggle.setAttribute('aria-label',open?'关闭导航':'打开导航');
  document.querySelector('.app-shell').inert=open;
  if(open)document.querySelector('.sidebar .brand').focus();
}
document.addEventListener('click',event=>{
  const close=event.target.closest('[data-close-dialog]');
  if(close){close.closest('dialog').close();return;}
  const detail=event.target.closest('[data-detail]');
  if(detail){setMenu(false);showDetail(detail.dataset.detail);return;}
  const windowButton=event.target.closest('[data-window]');
  if(windowButton){renderTimeline(+windowButton.dataset.window);return;}
  const filterButton=event.target.closest('[data-filter]');
  if(filterButton){renderActivity(filterButton.dataset.filter);return;}
  if(event.target.closest('.sidebar a'))setMenu(false);
});
menuToggle.addEventListener('click',()=>setMenu(!document.body.classList.contains('menu-open')));
document.getElementById('menu-close').addEventListener('click',()=>{setMenu(false);menuToggle.focus();});
document.getElementById('mobile-scrim').addEventListener('click',()=>{setMenu(false);menuToggle.focus();});
document.getElementById('search-trigger').addEventListener('click',openSearch);
document.getElementById('search-input').addEventListener('input',event=>renderSearch(event.target.value));
document.addEventListener('keydown',event=>{
  if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();openSearch();}
  if(event.key==='Escape'&&document.body.classList.contains('menu-open')){setMenu(false);menuToggle.focus();}
  if(event.key==='Tab'&&document.body.classList.contains('menu-open')){
    const focusables=[...document.querySelectorAll('.sidebar a[href],.sidebar button')];
    const first=focusables[0],last=focusables.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
});
searchDialog.addEventListener('keydown',event=>{
  if(!['ArrowDown','ArrowUp'].includes(event.key))return;
  const results=[...searchDialog.querySelectorAll('.search-result')];if(!results.length)return;
  event.preventDefault();const current=results.indexOf(document.activeElement);
  const next=event.key==='ArrowDown'?(current+1)%results.length:(current<=0?results.length-1:current-1);
  results[next].focus();
});
[detailDialog,searchDialog].forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}));
window.addEventListener('resize',()=>setMenu(innerWidth<=760&&document.body.classList.contains('menu-open')));
hydrateIcons();wireRoutes();renderTimeline(3);renderActivity();setMenu(false);

"""Publish the reviewed Super-agent plan with resumable native issue relations."""
from pathlib import Path
import json, subprocess, sys, tempfile, hashlib, re
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading, time
ROOT=Path(__file__).resolve().parent
REPO='IceFireIcer/DS-Bot-SuperAgent'
BASE=f'repos/{REPO}'
M=json.loads((ROOT/'tickets-draft.json').read_text(encoding='utf-8'))
STATE_PATH=ROOT/'publication.json'
STATE=json.loads(STATE_PATH.read_text(encoding='utf-8')) if STATE_PATH.exists() else {'version':'v2.1','repository':REPO,'spec_number':1,'issues':{},'hierarchy':[],'dependencies':[],'verified':False}
def gh(*args):
 p=subprocess.run(['gh',*args],capture_output=True,text=True,encoding='utf-8')
 if p.returncode:raise RuntimeError(p.stderr.strip())
 return json.loads(p.stdout) if p.stdout.strip() else None
def api(path,payload=None,method=None):
 args=['api',path]
 if method:args+=['--method',method]
 if payload is None:return gh(*args)
 with tempfile.TemporaryDirectory(prefix='dsbot-publication-') as d:
  p=Path(d)/'payload.json';p.write_text(json.dumps(payload,ensure_ascii=False),encoding='utf-8')
  return gh(*args,'--input',str(p))
def checkpoint():
 STATE['updated_at']=datetime.now(timezone.utc).isoformat()
 STATE_PATH.write_text(json.dumps(STATE,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def validate():
 ts={t['id']:t for t in M['tickets']}
 assert len(ts)==55 and len(M['features'])==14
 def ancestors(k,seen=None):
  seen=set() if seen is None else seen
  assert k not in seen,('cycle',k)
  result=set()
  for d in ts[k]['blocked_by']:
   assert d in ts and d<k
   result.add(d);result.update(ancestors(d,seen|{k}))
  return result
 assert len(ancestors('T55'))==54
 owners={}
 for f in M['features']:
  for k in f['tickets']:
   assert k not in owners;owners[k]=f['id'];assert ts[k]['feature']==f['id']
 assert set(owners)=={f'T{i:02}' for i in range(1,54)}
 assert all(t['feature'] is None for t in M['tickets'][-2:])
 assert all(v for category in M['coverage'].values() for v in category.values())
 assert {v for t in ts.values() for v in t.get('audit_findings',[])}=={f'F{i:02}' for i in range(1,9)}
 s=(ROOT/'spec.md').read_text(encoding='utf-8')
 assert len(re.findall(r'^\d+\. 作为',s,re.M))==108
 assert len(re.findall(r'^\| A\d{2} ',s,re.M))==44
 assert all(t['acceptance'] for t in ts.values())
 print('Validated 14 features, 55 tickets, 108 stories, 44 scenarios and 8 audit dispositions.',flush=True)
def normalize(s):return s.replace('\r\n','\n').replace('\r','')
def spec():
 current=api(f'{BASE}/issues/1')
 old=json.loads((ROOT/'spec-before-audit.json').read_text(encoding='utf-8'))
 desired=(ROOT/'spec.md').read_text(encoding='utf-8')
 assert current['state']=='open' and not current['assignees']
 assert not any(l['name']=='maintainer' for l in current['labels'])
 if normalize(current['body'])!=desired:
  assert normalize(current['body'])==normalize(old['body']),'Concurrent spec edit; inspect before updating.'
  api(f'{BASE}/issues/1',{'body':desired},'PATCH')
 check=api(f'{BASE}/issues/1')
 assert normalize(check['body'])==desired
 assert sorted(l['name'] for l in check['labels'])==sorted(l['name'] for l in old['labels'])
 STATE['spec']={'url':check['html_url'],'updated_at':check['updated_at'],'body_sha256':hashlib.sha256(desired.encode()).hexdigest()}
 checkpoint();print('Published and verified existing spec v2.1; labels/state preserved.',flush=True)
def marker(k):return f'<!-- dsbot-plan:v2.1:{k} -->'
def local_body(k,title,body):
 d=ROOT/'issues';d.mkdir(exist_ok=True)
 (d/f'{k}.md').write_text('# '+title+'\n\n'+body,encoding='utf-8')
def issue(k,title,body,labels):
 local_body(k,title,body)
 if k in STATE['issues']:
  assert STATE['issues'][k]['body_sha256']==hashlib.sha256(body.encode()).hexdigest(),('Changed body after creation',k)
  return STATE['issues'][k]
 existing=gh('issue','list','--repo',REPO,'--state','all','--search',f'"{title}" in:title','--limit','100','--json','number,title,body')
 found=[v for v in existing if v['title']==title and marker(k) in (v['body'] or '')]
 assert len(found)<=1,('Duplicate marker',k)
 assert not any(v['title']==title and marker(k) not in (v['body'] or '') for v in existing),('Unrelated title conflict',k)
 if found:created=api(f"{BASE}/issues/{found[0]['number']}")
 else:
  try:created=api(f'{BASE}/issues',{'title':title,'body':body,'labels':labels},'POST')
  except RuntimeError:
   # A lost create response is reconciled by marker before any later rerun.
   raise
 assert normalize(created['body'])==body
 v={'number':created['number'],'id':created['id'],'url':created['html_url'],'title':title,'body_sha256':hashlib.sha256(body.encode()).hexdigest()}
 STATE['issues'][k]=v;checkpoint();print(f"{k} -> #{v['number']} {title}",flush=True)
 return v
def feature(f):
 body=marker(f['id'])+'\n\n## Parent\n\n[Super-agent 架构重建规格 v2.1](https://github.com/'+REPO+'/issues/1)\n\n## What to build\n\n'+f['delivery']+'\n\n## Child tickets\n\n'
 body+='\n'.join(f"- {k} {next(t['title'] for t in M['tickets'] if t['id']==k)}" for k in f['tickets'])
 body+='\n\n子票通过 GitHub 原生 sub-issues 绑定；上列编号对应稳定计划 ID。父票只聚合功能范围与验收，不作为一张超大实施任务。\n\n## External prerequisites\n\n'
 body+='、'.join(f['external_prerequisites']) or '无'
 body+='。这些前置只约束使用它们的子票；不得转换为整功能互相等待。跨功能逐票 blocked-by 为执行依据。\n\n## Acceptance criteria\n\n'+'\n'.join('- [ ] '+a for a in f['acceptance'])
 body+='\n\n## Execution\n\n从本功能尚未完成且原生 blockers 已满足的子票开始；每票保持独立验收。功能整体验收在子票完成后进行。父票 enhancement 表示聚合范围，不代表可以忽略子票前置或已通过产品验收。\n'
 return issue(f['id'],f"[Feature {f['id']}] {f['title']}",body,['enhancement'])
def ticket(t):
 parent=STATE['issues'][t['feature']] if t['feature'] else {'url':f'https://github.com/{REPO}/issues/1','title':'Super-agent 架构重建规格 v2.1'}
 body=marker(t['id'])+f"\n\n## Parent\n\n[{parent['title']}]({parent['url']})\n\n总体行为与依据：[Super-agent v2.1](https://github.com/{REPO}/issues/1)。\n\n## What to build\n\n{t['delivery']}\n\n## Acceptance criteria\n\n"
 body+='\n'.join('- [ ] '+a for a in t['acceptance'])
 body+='\n\n## Spec coverage\n\n决定：'+'、'.join(t['decisions'])+'；场景：'+'、'.join(t['scenarios'])+'；用户故事：'+'、'.join(map(str,t['stories']))+'。'
 if t.get('audit_findings'):body+=' 审计补充：'+'、'.join(t['audit_findings'])+'。'
 body+='\n\n## Dependencies\n\n'
 if t['blocked_by']:
  body+='\n'.join(f"- [{d} {next(v['title'] for v in M['tickets'] if v['id']==d)}]({STATE['issues'][d]['url']})" for d in t['blocked_by'])
  body+='\n\n以上同时设置为 GitHub 原生 blocked-by；按这些具体子票判断可开始状态。'
 else:body+='无前置，可从本票开始。'
 body+='\n\n## Delivery requirements\n\n'+M['common_completion_conditions']+'\n'
 return issue(t['id'],f"[{t['id']}] {t['title']}",body,['ready-for-agent','enhancement'])
def hierarchy(keys):
 for k in keys:
  child=STATE['issues'][k]
  t=next((t for t in M['tickets'] if t['id']==k),None)
  pk=t['feature'] if t else None
  pn=STATE['issues'][pk]['number'] if pk else 1
  pairs=api(f'{BASE}/issues/{pn}/sub_issues?per_page=100')
  if not any(x['id']==child['id'] for x in pairs):
   api(f'{BASE}/issues/{pn}/sub_issues',{'sub_issue_id':child['id']},'POST')
  pair=[pn,child['number']]
  if pair not in STATE['hierarchy']:STATE['hierarchy'].append(pair);checkpoint()
  print(f"Parent #{pn} -> {k} #{child['number']}",flush=True)
def dependencies(keys):
 gate=threading.Lock()
 last_mutation=[0.0]
 def work(t):
  n=STATE['issues'][t['id']]['number']
  current=api(f'{BASE}/issues/{n}/dependencies/blocked_by?per_page=100')
  current_ids={x['id'] for x in current}
  pairs=[]
  for d in t['blocked_by']:
   blocker=STATE['issues'][d]
   if blocker['id'] not in current_ids:
    with gate:
     wait=1.1-(time.monotonic()-last_mutation[0])
     if wait>0:time.sleep(wait)
     last_mutation[0]=time.monotonic()
    api(f'{BASE}/issues/{n}/dependencies/blocked_by',{'issue_id':blocker['id']},'POST')
   pairs.append([n,blocker['number']])
  return t['id'],pairs
 with ThreadPoolExecutor(max_workers=4) as pool:
  futures=[pool.submit(work,t) for t in M['tickets'] if t['id'] in keys]
  for future in as_completed(futures):
   tid,pairs=future.result()
   for pair in pairs:
    if pair not in STATE['dependencies']:STATE['dependencies'].append(pair)
   checkpoint();print(f'Dependencies {tid}: {len(pairs)}',flush=True)
def verify():
 assert len(STATE['issues'])==69
 expected_parent={f['id']:1 for f in M['features']}
 expected_parent.update({t['id']:(STATE['issues'][t['feature']]['number'] if t['feature'] else 1) for t in M['tickets']})
 parents={1}|{STATE['issues'][f['id']]['number'] for f in M['features']}
 actual={}
 def read_children(pn):return pn,api(f'{BASE}/issues/{pn}/sub_issues?per_page=100')
 with ThreadPoolExecutor(max_workers=4) as pool:
  for pn,children in pool.map(read_children,parents):
   for c in children:
    if c['number']==2 and pn==1:continue
    assert c['number'] not in actual,('two parents',c['number'])
    actual[c['number']]=pn
 assert actual=={STATE['issues'][k]['number']:pn for k,pn in expected_parent.items()}
 def read_issue(k):
  v=STATE['issues'][k]
  item=api(f"{BASE}/issues/{v['number']}")
  assert item['title']==v['title'] and item['state']=='open' and not item['assignees'],k
  assert marker(k) in item['body']
  assert hashlib.sha256(normalize(item['body']).encode()).hexdigest()==v['body_sha256'],k
  labels={x['name'] for x in item['labels']}
  assert 'maintainer' not in labels
  assert ('ready-for-agent' in labels)==k.startswith('T'),k
  frontier=False
  if k.startswith('T'):
   t=next(t for t in M['tickets'] if t['id']==k)
   actual_deps=api(f"{BASE}/issues/{v['number']}/dependencies/blocked_by?per_page=100")
   assert {d['number'] for d in actual_deps}=={STATE['issues'][d]['number'] for d in t['blocked_by']},k
   frontier=all(d['state']=='closed' for d in actual_deps)
  return k,frontier
 ready=[]
 with ThreadPoolExecutor(max_workers=4) as pool:
  for k,frontier in pool.map(read_issue,list(STATE['issues'])):
   if frontier:ready.append(k)
   print('Verified',k,flush=True)
 assert ready==['T01'],ready
 final=api(f'{BASE}/issues/1')
 assert normalize(final['body'])==(ROOT/'spec.md').read_text(encoding='utf-8')
 old=json.loads((ROOT/'spec-before-audit.json').read_text(encoding='utf-8'))
 assert sorted(l['name'] for l in final['labels'])==sorted(l['name'] for l in old['labels'])
 assert final['state']=='open'
 STATE['verified']=True;STATE['verification']={'features':14,'tickets':55,'hierarchy_edges':69,'dependency_edges':sum(len(t['blocked_by']) for t in M['tickets']),'parent_spec_state':final['state'],'initial_frontier':ready,'scope':'Issue bodies, labels, hierarchy and native dependencies; no product implementation.'}
 checkpoint();print('ALL VERIFIED',STATE['verification'],flush=True)
if __name__=='__main__':
 command=sys.argv[1];keys=sys.argv[2:]
 if command=='validate':validate()
 elif command=='spec':spec()
 elif command=='features':
  for f in M['features']:
   if not keys or f['id'] in keys:feature(f)
 elif command=='tickets':
  for t in M['tickets']:
   if t['id'] in keys:ticket(t)
 elif command=='hierarchy':hierarchy(keys or list(STATE['issues']))
 elif command=='dependencies':dependencies(keys or [t['id'] for t in M['tickets']])
 elif command=='verify':verify()
 else:raise ValueError(command)

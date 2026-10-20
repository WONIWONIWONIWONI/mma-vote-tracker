"""Read only the public endpoint used by Melon's TOP10 page."""
import json, urllib.request, datetime, pathlib, time, sys, subprocess
from supervisor import Actions
ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / 'dist/data'
CONFIG = json.loads((ROOT / 'tracker.config.json').read_text())
ENDS_AT = CONFIG['endsAt']
URL = CONFIG['sources'][0]['endpoint']
TOP_N = CONFIG['topN']

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')

def parse(payload, stamp):
    response = payload['response']
    if response.get('status') != 'ok':
        raise ValueError('Melon returned a non-ok status')
    rows = response['nominees']
    if len(rows) < TOP_N:
        raise ValueError('Too few nominees')
    teams, ids = [], set()
    for row in rows:
        identity = str(row['content']['id'])
        votes, percent = row['voteCount'], row['votePercent']
        if identity in ids or not row['content']['name'] or type(votes) is not int or votes < 0:
            raise ValueError('Invalid or duplicate nominee')
        if not isinstance(percent, (int, float)) or not 0 <= percent <= 100:
            raise ValueError('Invalid percentage')
        ids.add(identity)
        teams.append(dict(id=identity,name=row['content']['name'],votes=votes,reportedShare=percent))
    total = sum(t['votes'] for t in teams)
    if total <= 0:
        raise ValueError('No votes yet')
    if any(abs(t['reportedShare']-100*t['votes']/total) > 0.501 for t in teams):
        raise ValueError('Percentage inconsistent with vote total')
    teams.sort(key=lambda t:-t['votes']) # source order breaks equal-vote ties
    for i,t in enumerate(teams):t['rank']=i+1
    return dict(sourceAt=stamp,collectedAt=stamp,origin='melon_public_api',totalVotes=total,top4=teams[:TOP_N])

def save(data):
    DATA.mkdir(parents=True,exist_ok=True)
    data['historyCount']=len(data['snapshots'])
    def write(name,value):
        target=DATA/name; temp=target.with_suffix('.tmp');temp.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':')));temp.replace(target)
    write('history.json',data)
    recent={**data,'snapshots':data['snapshots'][-3:]}
    write('latest.json',recent)
    (DATA/'seed.js').write_text('window.MMA_SEED='+json.dumps(recent,ensure_ascii=False,separators=(',',':'))+';\n')

def collect():
    path=DATA/'history.json'
    data=json.loads(path.read_text()) if path.exists() else dict(schemaVersion=2,snapshots=[])
    stamp=now()
    data['operation']={'endsAt':ENDS_AT}
    if stamp >= ENDS_AT:
        data['collector']={'state':'stopped','checkedAt':stamp};save(data);return True
    try:
        request=urllib.request.Request(URL+'&t='+str(int(time.time())),headers={'User-Agent':'Mozilla/5.0','Referer':CONFIG['sources'][0]['url']})
        with urllib.request.urlopen(request,timeout=20) as r: payload=json.load(r)
        snapshot=parse(payload,now())
        if data['snapshots'] and data['snapshots'][-1]['sourceAt'][:16] == snapshot['sourceAt'][:16]:
            data['snapshots'][-1]=snapshot
        else:
            data['snapshots'].append(snapshot)
        data['collector']={'state':'ok','checkedAt':stamp}
        save(data)
        try:
            subprocess.run(['node',str(ROOT/'collector/forecast.cjs')],cwd=ROOT,check=True,timeout=20)
        except (OSError,subprocess.SubprocessError) as error:
            print('Forecast update pending; collection retained:',type(error).__name__,flush=True)
        print('Collected',snapshot['sourceAt'],snapshot['totalVotes'],flush=True)
    except Exception as error:
        data['collector']={'state':'error','checkedAt':stamp,'message':str(error)[:300]}
        save(data)
        print('Collection failed:',error,flush=True)
        return False
    return True

def merge_history(remote, pending):
    # JSON lines cannot be text-merged safely: merge actual observations by minute.
    rows = {}
    def stamp(value):
        return datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
    for row in remote['snapshots'] + pending['snapshots']:
        observed = stamp(row['sourceAt'])
        minute = int(observed.timestamp()) // 60
        if minute not in rows or observed >= stamp(rows[minute]['sourceAt']):
            rows[minute] = row
    newest = max((remote, pending), key=lambda data: stamp(data.get('collector', {}).get('checkedAt') or data['snapshots'][-1]['sourceAt']))
    return {**remote, **newest, 'snapshots': [rows[key] for key in sorted(rows)]}

def merge_forecast_ledgers(remote, pending):
    # Already-published forecasts win: never refit a historical record during rebase.
    records = {row['cutoff']: row for row in pending.get('records', [])}
    records.update({row['cutoff']: row for row in remote.get('records', [])})
    return {'schemaVersion': 1, 'records': [records[key] for key in sorted(records)]}

def write_forecast_ledger(ledger):
    target=DATA/'gap-forecasts.json'
    temp=target.with_suffix('.tmp')
    temp.write_text(json.dumps(ledger,ensure_ascii=False,separators=(',',':')))
    temp.replace(target)

def git_run(args, **kwargs):
    return subprocess.run(args,cwd=ROOT,timeout=30,**kwargs)

def git_output(args, **kwargs):
    return subprocess.check_output(args,cwd=ROOT,timeout=30,**kwargs)

def publish():
    git_run(['git','add','dist/data'],check=True)
    if git_run(['git','diff','--cached','--quiet']).returncode:
        git_run(['git','commit','-m','data: record MMA TOP6 observation'],check=True)
        for attempt in range(3):
            push = git_run(['git','push'])
            if push.returncode == 0:
                return
            if attempt == 2:
                raise subprocess.CalledProcessError(push.returncode,['git','push'])
            print('Push rejected; syncing with origin/main and retrying',flush=True)
            pending = json.loads((DATA/'history.json').read_text())
            pending_forecasts=json.loads((DATA/'gap-forecasts.json').read_text()) if (DATA/'gap-forecasts.json').exists() else {'records': []}
            git_run(['git','fetch','origin','main'],check=True)
            rebase = git_run(['git','rebase','origin/main'])
            for resolution in range(100):
                if rebase.returncode == 0:
                    break
                conflicts = git_output(['git','diff','--name-only','--diff-filter=U'],text=True).splitlines()
                expected = {'dist/data/history.json','dist/data/latest.json','dist/data/seed.js','dist/data/gap-forecasts.json'}
                if not conflicts or not set(conflicts).issubset(expected):
                    git_run(['git','rebase','--abort'],check=True)
                    raise subprocess.CalledProcessError(rebase.returncode,['git','rebase','origin/main'])
                remote = json.loads(git_output(['git','show','origin/main:dist/data/history.json'],text=True))
                save(merge_history(remote,pending))
                if 'dist/data/gap-forecasts.json' in conflicts:
                    remote_forecasts=json.loads(git_output(['git','show','origin/main:dist/data/gap-forecasts.json'],text=True))
                    write_forecast_ledger(merge_forecast_ledgers(remote_forecasts,pending_forecasts))
                git_run(['git','add','dist/data'],check=True)
                empty = git_run(['git','diff','--cached','--quiet']).returncode == 0
                rebase = git_run(['git','-c','core.editor=true','rebase','--skip' if empty else '--continue'])
            else:
                git_run(['git','rebase','--abort'],check=True)
                raise RuntimeError('Too many pending data rebases')

def run_loop(duration=2*3600, interval=CONFIG['collectionIntervalSeconds'], supervisor=None, max_extension=2*3600):
    """Queue/verify a successor; keep collecting if a handoff cannot yet be confirmed."""
    if duration <= 0 or interval < 60:
        raise ValueError('Invalid collector duration or interval')
    supervisor=supervisor or Actions.from_environment()
    started=time.monotonic();soft_end=started+duration
    hard_end=soft_end+(max_extension if supervisor else 0)
    next_collect=started;next_supervise=started
    successor=False;failures=0;last_good=-float('inf');last_published=False;handoff_checked=False
    while time.monotonic()<hard_end:
        tick=time.monotonic()
        if tick>=next_collect:
            succeeded=False
            try:
                succeeded=collect()
                publish()  # Keep error heartbeats visible too.
                last_published=True
            except (subprocess.SubprocessError,OSError,ValueError,RuntimeError) as error:
                last_published=False
                print('Collection/publish retry pending:',type(error).__name__,flush=True)
            if succeeded and last_published:
                failures=0;last_good=time.monotonic()
                next_collect=time.monotonic()+interval-time.time()%interval
            else:
                failures+=1
                next_collect=time.monotonic()+min(120,15*2**min(failures-1,3))
            if now()>=ENDS_AT:
                break
        if supervisor and time.monotonic()>=next_supervise:
            try:
                successor=supervisor.ensure_successor()
            except (OSError,ValueError,RuntimeError) as error:
                successor=False
                print('Successor verification retry:',type(error).__name__,flush=True)
            next_supervise=time.monotonic()+(interval if successor else 30)
        tick=time.monotonic()
        if tick>=soft_end:
            if not supervisor:
                break
            if not handoff_checked:
                next_supervise=tick;handoff_checked=True
                continue
            if successor and last_published and failures==0:
                if tick-last_good<=30:
                    print('Handoff: fresh observation saved and successor verified',flush=True)
                    break
                # Take a final real observation immediately before releasing the runner.
                next_collect=tick
        boundary=hard_end if supervisor else soft_end
        wake=min(next_collect,next_supervise if supervisor else boundary,boundary)
        if tick<soft_end:
            wake=min(wake,soft_end)
        if not supervisor and wake>=soft_end:
            break
        if wake>tick:
            time.sleep(min(30,wake-tick))
    else:
        print('Hard runtime limit reached; recovery workflow will check the next worker',flush=True)

if __name__ == '__main__':
    if '--loop' in sys.argv:
        run_loop()
    else:
        succeeded = collect()
        if succeeded:
            publish()
        sys.exit(0 if succeeded else 1)


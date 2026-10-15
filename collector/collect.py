"""Read only the public endpoint used by Melon's TOP10 page."""
import json, urllib.request, datetime, pathlib, time, sys, subprocess
ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / 'dist/data'
ENDS_AT = '2026-10-29T15:10:00+00:00' # official deadline + final observation window
URL = 'https://m2.melon.com/m6/mma/2026/vote/top10.json?lang=ko'

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')

def parse(payload, stamp):
    response = payload['response']
    if response.get('status') != 'ok':
        raise ValueError('Melon returned a non-ok status')
    rows = response['nominees']
    if len(rows) < 6:
        raise ValueError('Fewer than six nominees')
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
    return dict(sourceAt=stamp,collectedAt=stamp,origin='melon_public_api',totalVotes=total,top4=teams[:6])

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
        request=urllib.request.Request(URL+'&t='+str(int(time.time())),headers={'User-Agent':'Mozilla/5.0','Referer':'https://www.melon.com/mma/2026/vote/top10/'})
        with urllib.request.urlopen(request,timeout=20) as r: payload=json.load(r)
        snapshot=parse(payload,now())
        if data['snapshots'] and data['snapshots'][-1]['sourceAt'][:16] == snapshot['sourceAt'][:16]:
            data['snapshots'][-1]=snapshot
        else:
            data['snapshots'].append(snapshot)
        data['collector']={'state':'ok','checkedAt':stamp}
        save(data)
        print('Collected',snapshot['sourceAt'],snapshot['totalVotes'],flush=True)
    except Exception as error:
        data['collector']={'state':'error','checkedAt':stamp,'message':str(error)[:300]}
        save(data)
        print('Collection failed:',error,flush=True)
        return False
    return True

def publish():
    subprocess.run(['git','add','dist/data'],cwd=ROOT,check=True)
    if subprocess.run(['git','diff','--cached','--quiet'],cwd=ROOT).returncode:
        subprocess.run(['git','commit','-m','data: record MMA TOP6 observation'],cwd=ROOT,check=True)
        for attempt in range(3):
            push = subprocess.run(['git','push'],cwd=ROOT)
            if push.returncode == 0:
                return
            if attempt == 2:
                raise subprocess.CalledProcessError(push.returncode,['git','push'])
            print('Push rejected; syncing with origin/main and retrying',flush=True)
            subprocess.run(['git','fetch','origin','main'],cwd=ROOT,check=True)
            subprocess.run(['git','rebase','origin/main'],cwd=ROOT,check=True)

if __name__ == '__main__':
    succeeded = collect()
    if succeeded:
        publish()
    sys.exit(0 if succeeded else 1)

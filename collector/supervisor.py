"""Queue a successor independently of cron and recover failed/stalled collectors."""
import datetime, json, os, time, urllib.request

ACTIVE = {'queued','pending','waiting','requested','in_progress'}

def epoch(value):
    return datetime.datetime.fromisoformat(value.replace('Z','+00:00')).timestamp()

class Actions:
    def __init__(self, repository, token, run_id=0):
        self.repository=repository;self.token=token;self.run_id=int(run_id or 0)
        self.last_dispatch=-float('inf')

    @classmethod
    def from_environment(cls):
        repository=os.environ.get('GITHUB_REPOSITORY');token=os.environ.get('GITHUB_TOKEN')
        return cls(repository,token,os.environ.get('GITHUB_RUN_ID',0)) if repository and token else None

    def request(self, method, path, payload=None, raw=False):
        headers={'Accept':'application/vnd.github.raw+json' if raw else 'application/vnd.github+json',
                 'Authorization':'Bearer '+self.token,'User-Agent':'mma-vote-collector','Content-Type':'application/json'}
        body=None if payload is None else json.dumps(payload).encode()
        request=urllib.request.Request('https://api.github.com/repos/'+self.repository+'/'+path,data=body,headers=headers,method=method)
        with urllib.request.urlopen(request,timeout=15) as response:
            content=response.read()
        return json.loads(content) if content else None

    def runs(self):
        payload=self.request('GET','actions/workflows/collect.yml/runs?per_page=100')
        if not isinstance(payload,dict) or not isinstance(payload.get('workflow_runs'),list):
            raise ValueError('Invalid Actions run list')
        return payload['workflow_runs']

    def dispatch(self, reason):
        self.request('POST','actions/workflows/collect.yml/dispatches',{'ref':'main','inputs':{'reason':reason}})
        self.last_dispatch=time.monotonic()
        print('Requested collector successor:',reason,flush=True)

    def ensure_successor(self):
        # A queued cron run can also take over; never queue a duplicate intentionally.
        others=[r for r in self.runs() if r['id']!=self.run_id and r['status'] in ACTIVE and r.get('head_branch','main')=='main']
        if others:
            return True
        if time.monotonic()-self.last_dispatch>=60:
            self.dispatch('handoff')
        return False  # Verify it appears in the queue before allowing a handoff.

    def archive(self):
        # Dispatch explicitly: pushes made by GITHUB_TOKEN do not trigger Pages.
        self.request('POST','actions/workflows/publish.yml/dispatches',{'ref':'main'})
        for workflow in ('collect.yml','recover.yml'):
            self.request('PUT',f'actions/workflows/{workflow}/disable')
        for run in self.runs():
            if run['id']!=self.run_id and run['status'] in ACTIVE:
                self.request('POST',f"actions/runs/{run['id']}/cancel",{})
        print('Final archive published; collection and recovery workflows disabled',flush=True)

    def recover(self, ends_at, stale_after=900):
        current=time.time()
        if current>=epoch(ends_at):
            latest=self.request('GET','contents/dist/data/latest.json?ref=main',raw=True)
            if latest.get('operation',{}).get('archived') and latest.get('collector',{}).get('state')=='stopped':
                self.archive()
                return 'event-archived'
            if not any(r['status'] in ACTIVE for r in self.runs()):
                self.dispatch('archive-finalization')
            return 'archive-finalization-pending'
        history=self.runs()
        runs=[r for r in history if r['id']!=self.run_id and r['status'] in ACTIVE and r.get('head_branch','main')=='main']
        active=[r for r in runs if r['status']=='in_progress']
        pending=[r for r in runs if r['status']!='in_progress']
        if active:
            latest=self.request('GET','contents/dist/data/latest.json?ref=main',raw=True)
            heartbeat=latest.get('collector',{}).get('checkedAt') or latest['snapshots'][-1]['sourceAt']
            # Fresh error heartbeats mean the worker is alive, even if Melon is down.
            stale=current-epoch(heartbeat)>stale_after
            hung=[r for r in active if stale and current-epoch(r.get('run_started_at') or r['created_at'])>stale_after]
            if not hung:
                return 'worker-healthy'
            for run in hung:
                self.request('POST',f"actions/runs/{run['id']}/cancel",{})
            if not pending:
                self.dispatch('stale-heartbeat-recovery')
            return 'stalled-worker-replaced'
        if pending:
            return 'successor-already-queued'
        recent_failures=[r for r in history if r.get('conclusion') in {'failure','timed_out','startup_failure'} and r.get('updated_at') and current-epoch(r['updated_at'])<600]
        if len(recent_failures)>=3:
            return 'restart-cooldown'
        self.dispatch('missing-worker-recovery')
        return 'worker-restarted'

if __name__=='__main__':
    api=Actions.from_environment()
    if api is None:
        raise SystemExit('GitHub Actions credentials are required')
    from collect import ENDS_AT
    print(api.recover(ENDS_AT))

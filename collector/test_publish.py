"""Reproduce overlapping writers against a local Git remote, without network calls."""
import json, pathlib, subprocess, tempfile, unittest
from unittest.mock import patch
import collect

class PublishTests(unittest.TestCase):
    def test_concurrent_data_pushes_merge_actual_observations(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp)
            def git(cwd,*args):
                return subprocess.check_output(['git',*args],cwd=cwd,stderr=subprocess.STDOUT,text=True)
            remote=root/'remote.git';git(root,'init','--bare','--initial-branch=main',str(remote))
            a=root/'a';git(root,'clone',str(remote),str(a))
            def configure(repo):
                git(repo,'config','user.name','Test');git(repo,'config','user.email','test@example.invalid')
            configure(a)
            def row(t,v):return {'sourceAt':'2026-10-15T12:'+t+'Z','totalVotes':v}
            base=row('40:00',100)
            def write(repo,rows):
                data={'schemaVersion':2,'snapshots':rows,'collector':{'state':'ok','checkedAt':rows[-1]['sourceAt']}}
                with patch.object(collect,'DATA',repo/'dist/data'):collect.save(data)
            write(a,[base]);(a/'dist/data/gap-forecasts.json').write_text(json.dumps({'schemaVersion':1,'records':[{'cutoff':1,'modelId':'preserved'}]}));git(a,'add','.');git(a,'commit','-m','seed');git(a,'push','-u','origin','main')
            b=root/'b';git(root,'clone',str(remote),str(b));configure(b)
            write(a,[base,row('41:50',200)]);(a/'dist/data/gap-forecasts.json').write_text(json.dumps({'schemaVersion':1,'records':[{'cutoff':1,'modelId':'preserved'},{'cutoff':2,'modelId':'published'}]}));git(a,'add','.');git(a,'commit','-m','remote observation');git(a,'push')
            write(b,[base,row('41:30',210)]);(b/'dist/data/gap-forecasts.json').write_text(json.dumps({'schemaVersion':1,'records':[{'cutoff':1,'modelId':'preserved'},{'cutoff':2,'modelId':'conflicting-refit'},{'cutoff':3,'modelId':'next'}]}));git(b,'add','.');git(b,'commit','-m','first unpublished point')
            write(b,[base,row('41:30',210),row('42:00',220)])
            with patch.object(collect,'ROOT',b),patch.object(collect,'DATA',b/'dist/data'):collect.publish()
            result=json.loads(git(b,'show','origin/main:dist/data/history.json'))
            self.assertEqual([r['totalVotes'] for r in result['snapshots']],[100,200,220])
            self.assertEqual(result['historyCount'],3)
            forecasts=json.loads(git(b,'show','origin/main:dist/data/gap-forecasts.json'))
            self.assertEqual([r['modelId'] for r in forecasts['records']],['preserved','published','next'])
            # A local sample older than the remote sample must become a clean skipped commit.
            git(a,'pull','--rebase')
            current=result['snapshots'];write(a,current+[row('43:50',240)])
            git(a,'add','.');git(a,'commit','-m','newer same-minute sample');git(a,'push')
            write(b,current+[row('43:30',230)])
            with patch.object(collect,'ROOT',b),patch.object(collect,'DATA',b/'dist/data'):collect.publish()
            result=json.loads(git(b,'show','origin/main:dist/data/history.json'))
            self.assertEqual([r['totalVotes'] for r in result['snapshots']],[100,200,220,240])
            self.assertFalse((b/'.git/rebase-merge').exists())

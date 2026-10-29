import datetime, json, pathlib, tempfile, unittest
from unittest.mock import patch, Mock
import collect
import test_collect

class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.data=pathlib.Path(self.tmp.name)
        self.original={'schemaVersion':2,'snapshots':[collect.parse(test_collect.ParserTests().payload(),'2026-10-29T14:55:00+00:00')]}
        (self.data/'history.json').write_text(json.dumps(self.original))
        self.addCleanup(patch.stopall)
        patch.object(collect,'DATA',self.data).start()

    def test_cutoff_is_exact_kst_october_30_one_second(self):
        self.assertEqual(datetime.datetime.fromtimestamp(collect.ENDS_EPOCH,datetime.timezone(datetime.timedelta(hours=9))).isoformat(),'2026-10-30T00:00:01+09:00')

    def test_after_cutoff_never_reads_source_or_updates_frozen_files_again(self):
        with patch.object(collect,'now',return_value=collect.ENDS_AT),patch.object(collect.urllib.request,'urlopen') as fetch,patch.object(collect.subprocess,'run') as forecast:
            self.assertTrue(collect.collect())
            before={p.name:p.read_bytes() for p in self.data.iterdir()}
            with patch.object(collect,'save') as save:
                self.assertTrue(collect.collect())
                save.assert_not_called()
            self.assertEqual(before,{p.name:p.read_bytes() for p in self.data.iterdir()})
            fetch.assert_not_called();forecast.assert_not_called()
        result=json.loads((self.data/'history.json').read_text())
        self.assertEqual(result['snapshots'],self.original['snapshots'])
        self.assertEqual(result['collector']['state'],'stopped')
        self.assertTrue(result['operation']['archived'])

    def test_response_after_deadline_is_not_backdated_or_saved(self):
        response=Mock()
        response.__enter__=Mock(return_value=response)
        response.__exit__=Mock(return_value=False)
        with patch.object(collect,'now',return_value='2026-10-29T15:00:00+00:00'),patch.object(collect.time,'time',side_effect=[collect.ENDS_EPOCH-.5,collect.ENDS_EPOCH-.5,collect.ENDS_EPOCH+.1]),patch.object(collect.urllib.request,'urlopen',return_value=response),patch.object(collect.json,'load',return_value=test_collect.ParserTests().payload()),patch.object(collect,'save') as save:
            self.assertFalse(collect.collect(final=True))
            save.assert_not_called()

    def test_final_window_waits_until_deadline_then_publishes_before_disabling(self):
        clock=[collect.ENDS_EPOCH-2]
        events=[]
        def sleep(seconds):clock[0]+=seconds
        api=Mock()
        api.archive.side_effect=lambda:events.append('disable')
        with patch.object(collect.time,'time',side_effect=lambda:clock[0]),patch.object(collect.time,'sleep',side_effect=sleep),patch.object(collect,'collect',side_effect=lambda **kw:events.append('observe' if kw else 'freeze')),patch.object(collect,'publish',side_effect=lambda:events.append('publish')):
            collect.finish_collection(api)
        self.assertEqual(events,['observe','observe','freeze','publish','disable'])
        self.assertEqual(clock[0],collect.ENDS_EPOCH)

    def test_final_window_is_woken_even_when_next_five_minute_sample_is_later(self):
        clock=[0.0]
        base=collect.ENDS_EPOCH-40
        def stamp():return datetime.datetime.fromtimestamp(base+clock[0],datetime.timezone.utc).isoformat()
        with patch.object(collect.time,'time',side_effect=lambda:base+clock[0]),patch.object(collect.time,'monotonic',side_effect=lambda:clock[0]),patch.object(collect.time,'sleep',side_effect=lambda s:clock.__setitem__(0,clock[0]+s)),patch.object(collect,'now',side_effect=stamp),patch.object(collect,'collect',return_value=True),patch.object(collect,'publish'),patch.object(collect.Actions,'from_environment',return_value=None),patch.object(collect,'finish_collection') as finish:
            collect.run_loop(601)
        finish.assert_called_once()
        self.assertEqual(clock[0],10)

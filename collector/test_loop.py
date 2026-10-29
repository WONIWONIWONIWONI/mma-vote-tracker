import subprocess, unittest
from unittest.mock import patch
import collect

class LoopTests(unittest.TestCase):
    def simulate(self,duration,results=None,publish_errors=None,supervisor_factory=None,max_extension=1200,stamp='2026-10-15T13:00:00+00:00'):
        clock=[0.0];observed=[];waits=[];attempts=[0]
        def sleep(seconds):waits.append(seconds);clock[0]+=seconds
        def read():
            observed.append(clock[0]);i=attempts[0];attempts[0]+=1
            return results[i] if results and i<len(results) else True
        api=supervisor_factory(clock) if supervisor_factory else None
        with patch.object(collect.time,'monotonic',side_effect=lambda:clock[0]),patch.object(collect.time,'time',side_effect=lambda:clock[0]),patch.object(collect.time,'sleep',side_effect=sleep),patch.object(collect,'collect',side_effect=read),patch.object(collect,'publish',side_effect=publish_errors) as publish,patch.object(collect,'now',return_value=stamp),patch.object(collect.Actions,'from_environment',return_value=None):
            collect.run_loop(duration,300,api,max_extension)
        self.assertTrue(all(w<=30 for w in waits),'keep supervision responsive while waiting')
        return observed,publish.call_count,clock[0]

    def test_keeps_five_minute_cadence_without_new_cron_starts(self):
        observed,count,_=self.simulate(601)
        self.assertEqual(observed,[0,300,600]);self.assertEqual(count,3)

    def test_failure_retries_soon_and_recovers_to_normal_cadence(self):
        observed,_,_=self.simulate(601,results=[False,False,True])
        self.assertEqual(observed,[0,15,45,300,600])

    def test_hung_git_operation_retries_without_terminating_worker(self):
        errors=[subprocess.TimeoutExpired(['git','push'],30),None,None,None]
        observed,count,_=self.simulate(601,publish_errors=errors)
        self.assertEqual(observed,[0,15,300,600]);self.assertEqual(count,4)

    def test_missing_successor_extends_worker_instead_of_creating_a_gap(self):
        class API:
            def __init__(self,c):self.c=c
            def ensure_successor(self):return self.c[0]>=900
        observed,_,end=self.simulate(301,supervisor_factory=API)
        self.assertEqual(observed,[0,300,600,900]);self.assertGreaterEqual(end,900);self.assertLessEqual(end,930)

    def test_final_real_observation_is_saved_immediately_before_handoff(self):
        class API:
            def __init__(self,c):pass
            def ensure_successor(self):return True
        observed,_,end=self.simulate(800,supervisor_factory=API)
        self.assertEqual(observed,[0,300,600,800]);self.assertEqual(end,800)

    def test_readiness_is_rechecked_at_handoff_and_can_recover_from_queue_loss(self):
        class API:
            def __init__(self,c):self.c=c
            def ensure_successor(self):return self.c[0]<800 or self.c[0]>=900
        observed,_,end=self.simulate(800,supervisor_factory=API)
        self.assertEqual(observed,[0,300,600,900]);self.assertGreaterEqual(end,900);self.assertLessEqual(end,930)

    def test_event_end_stops_before_dispatching_another_worker(self):
        with patch.object(collect,'finish_collection',side_effect=lambda api: (collect.collect(),collect.publish())):
            observed,count,_=self.simulate(601,stamp=collect.ENDS_AT)
        self.assertEqual(observed,[0]);self.assertEqual(count,1)

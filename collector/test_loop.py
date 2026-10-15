import subprocess, unittest
from unittest.mock import patch
import collect

class LoopTests(unittest.TestCase):
    def simulate(self, duration, collect_result=True, publish_error=False, stamp='2026-10-15T13:00:00+00:00'):
        clock=[0.0]; observed=[]; waits=[]
        def sleep(seconds):
            waits.append(seconds);clock[0]+=seconds
        def read():
            observed.append(clock[0]);return collect_result
        errors=[subprocess.CalledProcessError(1,['git','push']),None,None] if publish_error else None
        with patch.object(collect.time,'monotonic',side_effect=lambda:clock[0]), patch.object(collect.time,'time',side_effect=lambda:clock[0]), patch.object(collect.time,'sleep',side_effect=sleep), patch.object(collect,'collect',side_effect=read), patch.object(collect,'publish',side_effect=errors) as publish, patch.object(collect,'now',return_value=stamp):
            collect.run_loop(duration=duration,interval=300)
        return observed,waits,publish.call_count

    def test_one_runner_collects_multiple_points_without_new_scheduled_runs(self):
        self.assertEqual(self.simulate(601),([0,300,600],[300,300],3))

    def test_push_failure_does_not_stop_subsequent_observations(self):
        self.assertEqual(self.simulate(601,publish_error=True),([0,300,600],[300,300],3))

    def test_fetch_failure_publishes_error_and_retries_without_fake_observations(self):
        self.assertEqual(self.simulate(301,collect_result=False),([0,300],[300],2))

    def test_event_end_stops_loop_after_publishing_final_status(self):
        self.assertEqual(self.simulate(601,stamp=collect.ENDS_AT),([0],[],1))

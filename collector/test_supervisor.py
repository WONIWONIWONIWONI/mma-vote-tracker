import unittest
from unittest.mock import patch
from supervisor import Actions

class FakeActions(Actions):
    def __init__(self,runs=None,heartbeat='2026-10-15T13:20:00Z',state='ok'):
        super().__init__('owner/repo','test-token',99)
        self.items=runs or [];self.calls=[];self.heartbeat=heartbeat;self.state=state
    def request(self,method,path,payload=None,raw=False):
        self.calls.append((method,path,payload))
        if 'workflows/collect.yml/runs' in path:return {'workflow_runs':self.items}
        if path.startswith('contents/'):
            return {'collector':{'checkedAt':self.heartbeat,'state':self.state},'snapshots':[{'sourceAt':'2026-10-15T12:00:00Z'}]}
        return None

def run(id=1,status='in_progress',started='2026-10-15T12:00:00Z'):
    return {'id':id,'status':status,'head_branch':'main','created_at':started,'run_started_at':started}

class SupervisorTests(unittest.TestCase):
    def test_dispatch_must_be_seen_in_queue_before_handoff(self):
        api=FakeActions([run(99)])
        self.assertFalse(api.ensure_successor())
        self.assertEqual(sum(c[0]=='POST' for c in api.calls),1)
        self.assertFalse(api.ensure_successor())
        self.assertEqual(sum(c[0]=='POST' for c in api.calls),1,'avoid duplicate dispatch during propagation')
        api.items.append(run(100,'pending'))
        self.assertTrue(api.ensure_successor())

    def test_existing_cron_queue_does_not_create_another_successor(self):
        api=FakeActions([run(99),run(100,'queued')]);self.assertTrue(api.ensure_successor())
        self.assertFalse(any(c[0]=='POST' for c in api.calls))

    def check(self,api):
        with patch('supervisor.time.time',return_value=1792070400): # 2026-10-15 13:20 UTC
            return api.recover('2026-10-29T15:10:00Z')

    def test_missing_worker_is_restarted_automatically(self):
        api=FakeActions();self.assertEqual(self.check(api),'worker-restarted')
        self.assertTrue(any(c[1].endswith('/dispatches') for c in api.calls))

    def test_fresh_error_heartbeat_is_not_mistaken_for_a_hung_worker(self):
        api=FakeActions([run()],state='error');self.assertEqual(self.check(api),'worker-healthy')
        self.assertFalse(any(c[0]=='POST' for c in api.calls))

    def test_stale_worker_is_cancelled_and_replaced(self):
        api=FakeActions([run()],heartbeat='2026-10-15T12:00:00Z')
        self.assertEqual(self.check(api),'stalled-worker-replaced')
        posts=[c[1] for c in api.calls if c[0]=='POST'];self.assertEqual(len(posts),2)
        self.assertTrue(posts[0].endswith('/cancel'));self.assertTrue(posts[1].endswith('/dispatches'))

    def test_stale_worker_with_existing_queue_only_needs_cancellation(self):
        api=FakeActions([run(),run(2,'queued')],heartbeat='2026-10-15T12:00:00Z')
        self.assertEqual(self.check(api),'stalled-worker-replaced')
        self.assertEqual([c[1] for c in api.calls if c[0]=='POST'],['actions/runs/1/cancel'])

    def test_new_worker_gets_time_to_start_before_it_can_be_replaced(self):
        api=FakeActions([run(started='2026-10-15T13:18:00Z')],heartbeat='2026-10-15T12:00:00Z')
        self.assertEqual(self.check(api),'worker-healthy')

    def test_event_end_does_not_restart_service(self):
        api=FakeActions()
        self.assertEqual(api.recover('2020-01-01T00:00:00Z'),'archive-finalization-pending')
        self.assertTrue(any(c[1].endswith('/dispatches') and c[2]['inputs']['reason']=='archive-finalization' for c in api.calls))

    def test_archive_deploys_final_data_disables_schedules_and_cancels_queued_workers(self):
        api=FakeActions([run(99),run(100,'pending')])
        api.archive()
        self.assertIn(('POST','actions/workflows/publish.yml/dispatches',{'ref':'main'}),api.calls)
        self.assertIn(('PUT','actions/workflows/collect.yml/disable',None),api.calls)
        self.assertIn(('PUT','actions/workflows/recover.yml/disable',None),api.calls)
        self.assertIn(('POST','actions/runs/100/cancel',{}),api.calls)
        self.assertNotIn(('POST','actions/runs/99/cancel',{}),api.calls)

    def test_repeated_startup_failures_do_not_create_a_restart_storm(self):
        failed=[{**run(i,'completed'),'conclusion':'failure','updated_at':'2026-10-15T13:19:00Z'} for i in range(3)]
        api=FakeActions(failed);self.assertEqual(self.check(api),'restart-cooldown')
        self.assertFalse(any(c[0]=='POST' for c in api.calls))

import unittest
from collect import parse, merge_history

class ParserTests(unittest.TestCase):
    def payload(self):
        votes = [10, 40, 20, 30, 15, 5]
        shares = [8, 33, 17, 25, 13, 4]
        rows = [
            {'content': {'id': str(i), 'name': str(i)}, 'voteCount': vote, 'votePercent': share}
            for i, (vote, share) in enumerate(zip(votes, shares))
        ]
        return {'response': {'status': 'ok', 'nominees': rows}}

    def test_sort_and_keep_six(self):
        result = parse(self.payload(), '2026-10-15T00:00:00Z')
        self.assertEqual([team['votes'] for team in result['top4']], [40, 30, 20, 15, 10, 5])
        self.assertEqual(result['totalVotes'], 120)

    def test_reject_fewer_than_six(self):
        payload = self.payload()
        payload['response']['nominees'] = payload['response']['nominees'][:5]
        with self.assertRaises(ValueError):
            parse(payload, '2026-10-15T00:00:00Z')

    def test_bad_percentage(self):
        payload = self.payload()
        payload['response']['nominees'][0]['votePercent'] = 99
        with self.assertRaises(ValueError):
            parse(payload, '2026-10-15T00:00:00Z')

    def test_duplicate(self):
        payload = self.payload()
        payload['response']['nominees'][0]['content']['id'] = '1'
        with self.assertRaises(ValueError):
            parse(payload, '2026-10-15T00:00:00Z')

class MergeTests(unittest.TestCase):
    def test_conflicting_push_keeps_both_histories_and_latest_correction(self):
        def row(t, value):
            return {'sourceAt':'2026-10-15T12:'+t+'Z','totalVotes':value}
        remote={'snapshots':[row('40:00',100),row('41:50',200)],'collector':{'state':'ok','checkedAt':'2026-10-15T12:41:50Z'}}
        local={'snapshots':[row('40:00',100),row('41:30',210),row('42:00',220)],'collector':{'state':'error','checkedAt':'2026-10-15T12:42:00Z'}}
        result=merge_history(remote,local)
        self.assertEqual([r['totalVotes'] for r in result['snapshots']],[100,200,220])
        self.assertEqual(result['collector']['state'],'error')
        self.assertEqual(merge_history(local,remote),result)

if __name__ == '__main__':
    unittest.main()


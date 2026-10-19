import unittest
from collect import merge_forecast_ledgers
class LedgerTests(unittest.TestCase):
    def test_published_forecasts_are_never_replaced(self):
        remote={'records':[{'cutoff':1,'modelId':'old','path':[1]}]}
        pending={'records':[{'cutoff':1,'modelId':'new','path':[2]},{'cutoff':2,'modelId':'next','path':[3]}]}
        result=merge_forecast_ledgers(remote,pending)
        self.assertEqual(result['records'][0],remote['records'][0])
        self.assertEqual(result['records'][1],pending['records'][1])

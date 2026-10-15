import unittest
from collect import parse
class ParserTests(unittest.TestCase):
    def payload(self):
        return {'response':{'status':'ok','nominees':[{'content':{'id':str(i),'name':str(i)},'voteCount':v,'votePercent':v} for i,v in enumerate([10,40,20,30])]}}
    def test_sort_and_four(self):
        s=parse(self.payload(),'2026-10-15T00:00:00Z');self.assertEqual([t['votes'] for t in s['top4']],[40,30,20,10]);self.assertEqual(s['totalVotes'],100)
    def test_bad_percentage(self):
        p=self.payload();p['response']['nominees'][0]['votePercent']=99
        with self.assertRaises(ValueError):parse(p,'2026-10-15T00:00:00Z')
    def test_duplicate(self):
        p=self.payload();p['response']['nominees'][0]['content']['id']='1'
        with self.assertRaises(ValueError):parse(p,'2026-10-15T00:00:00Z')
if __name__=='__main__':unittest.main()

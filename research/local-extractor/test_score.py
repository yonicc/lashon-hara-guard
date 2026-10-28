import unittest
from score import decode,summary
class ExtractionScoringTests(unittest.TestCase):
    def test_unknown_is_not_false(self):
        r=summary([dict(id="u",text="hello",expect={},language="en",split="test")],
                  [dict(id="u",raw='{"verified":[false,"hello"]}')])
        self.assertEqual(r["groups"]["all"]["fp"],1)
        self.assertEqual(r["groups"]["all"]["unknown_as_false"],1)
    def test_wrong_false_is_fp_and_fn(self):
        r=summary([dict(id="u",text="yes",expect={"verified":True},language="en",split="test")],
                  [dict(id="u",raw='{"verified":[false,"yes"]}')])
        self.assertEqual((r["groups"]["all"]["tp"],r["groups"]["all"]["fp"],r["groups"]["all"]["fn"]),(0,1,1))
    def test_fabricated_evidence_rejected(self):
        p,e=decode('{"verified":[true,"I checked"]}',"I did not check")
        self.assertFalse(p);self.assertEqual(e,["evidence_not_verbatim"])
    def test_schema_and_verdict_rejected(self):
        for raw in ['[]','{"allowed":true}','{"verified":[0,"yes"]}','{"verified":[true,""]}']:
            self.assertTrue(decode(raw,"yes")[1])
    def test_invalid_json_not_clean(self):
        self.assertEqual(decode("garbage","hello"),({},["invalid_json"]))
    def test_duplicate_polarities_rejected(self):
        self.assertEqual(decode('{"verified":[true,"yes"],"verified":[false,"yes"]}',"yes"),
                         ({},["invalid_json"]))
    def test_invalid_empty_prediction_not_exact_match(self):
        r=summary([dict(id="u",text="hello",expect={},language="en",split="test")],
                  [dict(id="u",raw="invalid")])
        self.assertEqual(r["groups"]["all"]["exact"],0)
    def test_adapter_preserves_upstream_failure(self):
        r=summary([dict(id="u",text="hello",expect={},language="he",split="test")],
                  [dict(id="u",raw="{}",upstream_errors=["invalid_json"])])
        self.assertEqual(r["groups"]["all"]["format_error_rows"],1)
        self.assertEqual(r["groups"]["all"]["exact"],0)
    def test_missing_predictions_fail(self):
        with self.assertRaises(ValueError):
            summary([dict(id="u",text="hello",expect={},language="en",split="test")],[])
    def test_valid_false_survives(self):
        self.assertEqual(decode('{"verified":[false,"not checked"]}',"I have not checked"),({"verified":[False,"not checked"]},[]))
if __name__=="__main__":unittest.main()

"""py -I -m unittest discover -s classifier -p "test_gate_route.py" """
import unittest

from gate_route import combine, run_label, uses_second_model


class GateRouteTest(unittest.TestCase):
    def test_hebrew_only_stays_on_hebrew_model(self):
        self.assertFalse(uses_second_model("מנחם שוב שכח \U0001F644 123"))

    def test_any_latin_asks_second_model(self):
        self.assertTrue(uses_second_model("Marcus is lazy"))
        self.assertTrue(uses_second_model("שירות VIP"))

    def test_combine_never_lowers_hebrew_score(self):
        self.assertEqual(combine(0.9, 0.01), 0.9)
        self.assertEqual(combine(0.05, 0.7), 0.7)
        self.assertEqual(combine(0.3, None), 0.3)

    def test_run_label(self):
        self.assertEqual(run_label("v2", "v4", False), "v2")
        self.assertEqual(run_label("v2", "v4", True), "v2+v4")


if __name__ == "__main__":
    unittest.main()

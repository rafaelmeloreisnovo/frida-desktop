#!/usr/bin/env python3
import copy
import json
import tempfile
import unittest
from pathlib import Path
import custody_json_runner_v1 as m

SAMPLE={"schema":m.SCHEMA,"run_id":"fixture_01",
 "source":{"producer_commit":"b9480167640f92c971758c50341a32732306213c", "privacy_class":"PUBLIC_SYNTHETIC"},
 "input":{"word":147,"xor_mask":15,"rotate_left":1,"addition":7,"expected_word":319,"max_operations":3},
 "anchor_mesh":{"signatures":[6699]*4,"counters_before":[0]*4,"counters_after":[1]*4}}

class TestCustody(unittest.TestCase):
    def parse(self,x): return m.parse_plan(m.canonical(x))
    def run_it(self,x): return m.execute(self.parse(x),m.sha(m.canonical(x)))
    def test_valid(self):
        o=self.run_it(SAMPLE)
        self.assertEqual(o["output_word"],319)
        self.assertTrue(o["derived_fifth_local"])
        self.assertEqual(len(o["events"]),4)
        self.assertFalse(o["claim_allowed"])
        self.assertEqual(o["phase"],"RETURN_NOT_REMOTE_COMMIT")
    def test_changed_expected_blocks(self):
        x=copy.deepcopy(SAMPLE);x["input"]["expected_word"]^=1
        self.assertEqual(self.run_it(x)["result"],"BLOCKED_VALIDATION")
    def test_counter_stale(self):
        x=copy.deepcopy(SAMPLE);x["anchor_mesh"]["counters_after"][2]=0
        self.assertEqual(self.run_it(x)["software_operation_count"],0)
    def test_signature_mismatch(self):
        x=copy.deepcopy(SAMPLE);x["anchor_mesh"]["signatures"][1]=42
        self.assertFalse(self.run_it(x)["derived_fifth_local"])
    def test_no_duplicate_keys(self):
        with self.assertRaises(ValueError):m.parse_plan(b'{"a":1,"a":2}')
    def test_no_unauthorized_source(self):
        x=copy.deepcopy(SAMPLE);x["source"]["privacy_class"]="PRIVATE"
        with self.assertRaises(ValueError):self.parse(x)
    def test_no_unknown_ops(self):
        x=copy.deepcopy(SAMPLE);x["input"]["shell"]="rm -rf /"
        with self.assertRaises(ValueError):self.parse(x)
    def test_bounds(self):
        x=copy.deepcopy(SAMPLE);x["input"]["rotate_left"]=32
        with self.assertRaises(ValueError):self.parse(x)
    def test_hash_chain(self):
        o=self.run_it(SAMPLE);p="GENESIS"
        for ev in o["events"]:
            self.assertEqual(ev["parent_sha256"],p)
            h=ev["record_sha256"]
            self.assertEqual(h,m.sha(m.canonical({k:v for k,v in ev.items() if k!="record_sha256"})))
            p=h
        self.assertEqual(p,o["chain_tip_sha256"])
        h=o.pop("receipt_sha256")
        self.assertEqual(h,m.sha(m.canonical(o)))
    def test_bounded_file_receipts(self):
        o=self.run_it(SAMPLE)
        with tempfile.TemporaryDirectory() as td:
            path=Path(td)/"receipt.json"
            m.write_exclusive(path,o)
            self.assertEqual(json.loads(path.read_text())["result"],"PASS_SCOPED_LOCAL")
            with self.assertRaises(FileExistsError):m.write_exclusive(path,o)
    def test_exhaustive_u8(self):
        for i in range(256):
            x=copy.deepcopy(SAMPLE);x["input"]["word"]=i
            x["input"]["expected_word"]=(((i^15)<<1)&m.MASK)+7
            x["input"]["expected_word"]&=m.MASK
            self.assertTrue(self.run_it(x)["derived_fifth_local"])
    def test_no_ntp_claim(self):
        self.assertEqual(m.ntp_observation(None)["status"],"TOKEN_VAZIO_NTP")

if __name__ == "__main__":unittest.main()

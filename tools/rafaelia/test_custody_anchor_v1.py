#!/usr/bin/env python3
import copy
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
import custody_anchor_v1 as a

HEAD='3d7cf1605abe146d967adbb88ea80d39e17f194b'

class AnchorTest(unittest.TestCase):
    def fixture(self,n=5):
        tmp=tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root=Path(tmp.name)
        items=[]
        for i in range(n):
            p=root/('item%d.bin'%i)
            p.write_bytes(bytes([i,0,255])*(i+1))
            items.append(('ITEM%d'%i,p))
        m=a.new_manifest(items,HEAD,genesis=True)
        return root,items,m

    def test_merkle_1_to_64(self):
        for n in range(1,65):
            leaves=[a.leaf_digest({'seq':i,'sha256':hashlib.sha256(bytes([i])).hexdigest()}) for i in range(n)]
            root=a.tree_root(leaves)
            for i in range(n):
                proof=a.inclusion_proof(leaves,i)
                self.assertTrue(a.verify_proof(leaves[i],i,n,proof,root))
                self.assertFalse(a.verify_proof(leaves[i],i,n,proof,bytes(32)))

    def test_manifest_roundtrip(self):
        _,_,m=self.fixture(5)
        raw=a.canon(m)+b'\n'
        self.assertEqual(a.check_manifest(raw),m)
        self.assertEqual(m['merkle_root_sha256'],a.tree_root([a.leaf_digest(x) for x in m['ordered_items']]).hex())

    def test_parent_custody(self):
        root,items,m=self.fixture(2)
        parent=root/'parent.json';parent.write_bytes(b'{"prior":"exact bytes"}\n')
        n=a.new_manifest(items,HEAD,parent_receipt=parent)
        self.assertEqual(n['parent_receipt_sha256'],hashlib.sha256(parent.read_bytes()).hexdigest())
        self.assertFalse(n['genesis_explicit'])
        with self.assertRaises(ValueError):a.new_manifest(items,HEAD)
        with self.assertRaises(ValueError):a.new_manifest(items,HEAD,parent_receipt=parent,genesis=True)

    def test_no_zero_unknown_conflation(self):
        root,_,_=self.fixture(1)
        x=root/'zero';x.write_bytes(b'0')
        y=root/'empty';y.write_bytes(b'')
        m=a.new_manifest([('NUMBER_ZERO',x),('EMPTY_WORD',y)],HEAD,genesis=True)
        self.assertNotEqual(m['ordered_items'][0]['sha256'],m['ordered_items'][1]['sha256'])
        self.assertEqual([z['bytes'] for z in m['ordered_items']],[1,0])

    def test_tamper_leaf(self):
        _,_,m=self.fixture(3)
        m['ordered_items'][1]['sha256']='0'*64
        with self.assertRaises(ValueError):a.check_manifest(a.canon(m))

    def test_tamper_proof(self):
        _,_,m=self.fixture(8)
        m['proofs'][1][0]='f'*64
        with self.assertRaises(ValueError):a.check_manifest(a.canon(m))

    def test_refuse_unauthorized_remote_claim(self):
        _,_,m=self.fixture(1)
        m['claim_allowed']=True
        with self.assertRaises(ValueError):a.check_manifest(a.canon(m))

    def test_extra_fields_rejected(self):
        _,_,m=self.fixture(1)
        m['execute_shell']='echo hidden'
        with self.assertRaises(ValueError):a.check_manifest(a.canon(m))

    def test_reject_duplicate_alias(self):
        root,items,m=self.fixture(1)
        with self.assertRaises(ValueError):a.new_manifest([('X',items[0][1]),('X',items[0][1])],HEAD,genesis=True)

    def test_rfc3161_request(self):
        _,_,m=self.fixture(4)
        raw=a.canon(m)+b'\n'
        tsq=a.build_tsq(raw,nonce=0x80_abcdef)
        digest,nonce=a.parse_tsq(tsq)
        self.assertEqual(nonce,0x80_abcdef)
        self.assertEqual(digest,hashlib.sha256(raw).digest())
        if shutil.which('openssl'):
            with tempfile.TemporaryDirectory() as td:
                q=Path(td)/'a.tsq';q.write_bytes(tsq)
                p=subprocess.run(['openssl','ts','-query','-in',str(q),'-text'],capture_output=True,text=True)
                self.assertEqual(p.returncode,0,p.stderr)
                self.assertIn('sha256',p.stdout.lower())

    def test_bad_der_request(self):
        raw=a.canon(self.fixture(1)[2])+b'\n'
        x=a.build_tsq(raw,nonce=7)
        for bad in (x[:-1],x+b'0',b'0'*64):
            with self.assertRaises(ValueError):a.parse_tsq(bad)

    def test_no_unapproved_response(self):
        root,_,m=self.fixture(2)
        manifest=root/'manifest.json';manifest.write_bytes(a.canon(m)+b'\n')
        query=root/'request.tsq';query.write_bytes(a.build_tsq(manifest.read_bytes()))
        response=root/'fake.tsr';response.write_bytes(b'bad'*100)
        ca=root/'fake.pem';ca.write_bytes(b'not a cert')
        with self.assertRaises(ValueError):a.verify_timestamp(manifest,query,response,ca)
        with self.assertRaises(ValueError):a.verify_timestamp(manifest,query,response,ca,'missing-untrusted.pem')

    def test_mismatch_query_manifest(self):
        root,_,m=self.fixture(1)
        manifest=root/'manifest.json';manifest.write_bytes(a.canon(m)+b'\n')
        query=root/'request.tsq';query.write_bytes(a.build_tsq(manifest.read_bytes()))
        altered=copy.deepcopy(m);altered['ordered_items'][0]['sha256']='0'*64
        manifest.write_bytes(a.canon(altered)+b'\n')
        response=root/'fake';response.write_bytes(b'.')
        ca=root/'fake.pem';ca.write_text('CERT')
        with self.assertRaises(ValueError):a.verify_timestamp(manifest,query,response,ca)

    def test_no_overwrite(self):
        root,_,m=self.fixture(2)
        p=root/'manifest.json';digest=a.atomic_exclusive(p,a.canon(m)+b'\n')
        self.assertEqual(digest,a.sha(p.read_bytes()).hex())
        with self.assertRaises(FileExistsError):a.atomic_exclusive(p,b'overwrite')

    def test_duplicate_json_key(self):
        with self.assertRaises(ValueError):a.strict_json(b'{"a":1,"a":2}')
        with self.assertRaises(ValueError):a.strict_json(b'{"a":NaN}')

    @unittest.skipUnless(shutil.which('openssl'), 'OpenSSL unavailable: no TSA signing test')
    def test_ephemeral_test_tsa_positive_and_negative(self):
        # Self-signed test CA is generated in a temporary directory; this
        # demonstrates cryptographic verifier mechanics, NOT public time trust.
        root,_,m=self.fixture(3)
        raw=a.canon(m)+b'\n'
        manifest=root/'manifest.json';manifest.write_bytes(raw)
        tsq=root/'request.tsq';tsq.write_bytes(a.build_tsq(raw,nonce=0x123456abcdef))
        def openssl(*args):
            r=subprocess.run(['openssl',*map(str,args)],cwd=root,capture_output=True,text=True,timeout=20)
            if r.returncode:
                raise AssertionError('OpenSSL failed: '+r.stderr[-1500:])
        openssl('req','-new','-newkey','rsa:2048','-nodes','-x509','-days','1','-subj','/CN=Local Test CA',
                '-keyout','ca.key','-out','ca.pem')
        openssl('req','-new','-newkey','rsa:2048','-nodes','-subj','/CN=Local Test TSA',
                '-keyout','tsa.key','-out','tsa.csr')
        (root/'tsa.ext').write_text('basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\n'
                                    'extendedKeyUsage=critical,timeStamping\n')
        openssl('x509','-req','-in','tsa.csr','-CA','ca.pem','-CAkey','ca.key',
                '-CAcreateserial','-days','1','-sha256','-out','tsa.pem','-extfile','tsa.ext')
        (root/'tsaserial').write_text('01\n')
        (root/'tsa.cnf').write_text('[tsa]\ndefault_tsa=local\n[local]\nserial=tsaserial\n'
            'signer_cert=tsa.pem\ncerts=ca.pem\nsigner_key=tsa.key\nsigner_digest=sha256\n'
            'default_policy=1.3.6.1.4.1.50000.1\ndigests=sha256\n'
            'ordering=yes\naccuracy=secs:1\n')
        openssl('ts','-reply','-config','tsa.cnf','-queryfile','request.tsq','-out','response.tsr')
        result=a.verify_timestamp(manifest,tsq,root/'response.tsr',root/'ca.pem',root/'tsa.pem')
        self.assertEqual(result['manifest_sha256'],a.sha(raw).hex())
        self.assertFalse(result['claim_allowed'])
        self.assertEqual(result['cloud_commit'],'HOLD_NOT_COMMITTED')
        self.assertIn('PASS_SCOPED',result['status'])
        # Signed timestamp is tied to exact query and manifest bytes.
        invalid=root/'bad.tsr'
        blob=(root/'response.tsr').read_bytes()
        invalid.write_bytes(blob[:-1]+bytes([blob[-1]^1]))
        with self.assertRaises(ValueError):a.verify_timestamp(manifest,tsq,invalid,root/'ca.pem',root/'tsa.pem')
        other=root/'other_manifest.json'
        changed=copy.deepcopy(m)
        changed['ordered_items'][0]['sha256']='f'*64
        # A fake changed manifest is rejected before any timestamp verification.
        other.write_bytes(a.canon(changed)+b'\n')
        with self.assertRaises(ValueError):a.verify_timestamp(other,tsq,root/'response.tsr',root/'ca.pem',root/'tsa.pem')
        openssl('req','-new','-newkey','rsa:2048','-nodes','-x509','-days','1',
                '-subj','/CN=Wrong Test CA','-keyout','wrong.key','-out','wrong.pem')
        with self.assertRaises(ValueError):a.verify_timestamp(manifest,tsq,root/'response.tsr',root/'wrong.pem',root/'tsa.pem')

if __name__=='__main__':unittest.main()

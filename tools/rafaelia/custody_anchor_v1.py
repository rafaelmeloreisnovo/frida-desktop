#!/usr/bin/env python3
"""RAFAELIA: source-preserving Merkle manifest and RFC3161 timestamp request.

No external network, no remote write, no use of private identifiers. Only user
explicitly selected local files are read, in bounded chunks. OpenSSL is used
solely for trusted RFC3161 verification, never to trust an arbitrary JSON flag.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import secrets
import subprocess

SCHEMA = 'rafaelia.frida.anchor-manifest/v1'
SHA256_RE = re.compile(r'^[0-9a-f]{64}$')
GIT_SHA_RE = re.compile(r'^[0-9a-f]{40}$')
ALIAS_RE = re.compile(r'^[A-Z][A-Z0-9_]{0,39}$')
MAX_ITEMS = 256
MAX_FILE_BYTES = 512 * 1024 * 1024
MAX_JSON = 256 * 1024


def canon(obj):
    return json.dumps(obj, sort_keys=True, ensure_ascii=False,
                      separators=(',', ':'), allow_nan=False).encode('utf-8')


def sha(data):
    return hashlib.sha256(data).digest()


def hash_file(path):
    """Stream an explicitly supplied regular file and reject metadata drift.

    This detects ordinary concurrent writes but is not an immutable snapshot or
    a defense against privileged tampering that restores metadata.
    """
    flags=os.O_RDONLY|getattr(os,'O_CLOEXEC',0)|getattr(os,'O_NOFOLLOW',0)
    fd=os.open(os.fspath(path),flags)
    try:
        before=os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_size>MAX_FILE_BYTES:
            raise ValueError('NOT_REGULAR_OR_EXCEEDS_LIMIT')
        h=hashlib.sha256();length=0
        while True:
            chunk=os.read(fd,65536)
            if not chunk:break
            length+=len(chunk)
            if length>MAX_FILE_BYTES:raise ValueError('FILE_EXCEEDS_LIMIT')
            h.update(chunk)
        after=os.fstat(fd)
        for attribute in ('st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns'):
            if getattr(before,attribute)!=getattr(after,attribute):
                raise ValueError('SOURCE_MUTATED_DURING_READ')
        if length!=after.st_size:raise ValueError('SOURCE_CHANGED_LENGTH')
        return h.hexdigest(),length
    finally:
        os.close(fd)


def strict_json(raw):
    if len(raw) > MAX_JSON:
        raise ValueError('JSON_TOO_LARGE')
    def pairs(items):
        out = {}
        for k,v in items:
            if k in out:
                raise ValueError('DUPLICATE_KEY:' + k)
            out[k] = v
        return out
    def bad_constant(v):
        raise ValueError('INVALID_JSON_CONSTANT:' + v)
    return json.loads(raw.decode('utf-8'), object_pairs_hook=pairs,
                      parse_constant=bad_constant)


def leaf_digest(obj):
    return sha(b'\x00' + canon(obj))


def node_digest(left, right):
    return sha(b'\x01' + left + right)


def split(n):
    if n < 2:
        raise ValueError('SPLIT_NEEDS_TWO')
    return 1 << ((n-1).bit_length() - 1)


def tree_root(hashes):
    if not hashes:
        return sha(b'')
    if len(hashes) == 1:
        return hashes[0]
    k = split(len(hashes))
    return node_digest(tree_root(hashes[:k]), tree_root(hashes[k:]))


def inclusion_proof(hashes, index):
    n = len(hashes)
    if n <= 0 or not 0 <= index < n:
        raise ValueError('PROOF_INDEX')
    if n == 1:
        return []
    k = split(n)
    if index < k:
        return inclusion_proof(hashes[:k], index) + [tree_root(hashes[k:])]
    return inclusion_proof(hashes[k:], index-k) + [tree_root(hashes[:k])]


def verify_proof(leaf, index, count, siblings, expected_root):
    if count <= 0 or not 0 <= index < count:
        return False
    def descend(i,n,pos):
        if n == 1:
            return leaf,pos
        k = split(n)
        if i < k:
            left,pos = descend(i,k,pos)
            if pos >= len(siblings):
                raise ValueError('PROOF_SHORT')
            return node_digest(left,siblings[pos]),pos+1
        right,pos = descend(i-k,n-k,pos)
        if pos >= len(siblings):
            raise ValueError('PROOF_SHORT')
        return node_digest(siblings[pos],right),pos+1
    try:
        digest,used = descend(index,count,0)
        return used == len(siblings) and digest == expected_root
    except (ValueError, TypeError):
        return False


def new_manifest(items, producer_commit, parent_receipt=None, genesis=False):
    if not GIT_SHA_RE.fullmatch(producer_commit):
        raise ValueError('SOURCE_COMMIT_MISSING')
    if (parent_receipt is None) == (not genesis):
        raise ValueError('REQUIRE_EXACTLY_ONE_PARENT_OR_GENESIS')
    if not 1 <= len(items) <= MAX_ITEMS:
        raise ValueError('ITEM_COUNT')
    seen = set()
    leaves = []
    for seq,(alias,path) in enumerate(items):
        if not ALIAS_RE.fullmatch(alias) or alias in seen:
            raise ValueError('INVALID_OR_DUPLICATE_ALIAS')
        seen.add(alias)
        digest,size = hash_file(path)
        leaves.append({'seq':seq,'alias':alias,'bytes':size,'sha256':digest})
    base_hashes = [leaf_digest(x) for x in leaves]
    root = tree_root(base_hashes)
    proofs = [[x.hex() for x in inclusion_proof(base_hashes,i)] for i in range(len(leaves))]
    parent = hash_file(parent_receipt)[0] if parent_receipt is not None else None
    return {'schema':SCHEMA, 'source_commit_sha':producer_commit,
            'parent_receipt_sha256':parent, 'genesis_explicit':genesis,
            'ordered_items':leaves, 'item_count':len(leaves),
            'merkle_algorithm':'SHA256_RFC9162_STYLE_PREFIX_00_01',
            'merkle_root_sha256':root.hex(), 'proofs':proofs,
            'remote_state':'HOLD_NOT_COMMITTED',
            'time_state':'TOKEN_VAZIO_EXTERNAL_NOT_VERIFIED',
            'claim_allowed':False}


def check_manifest(raw):
    v = strict_json(raw)
    if not isinstance(v, dict) or set(v) != {
        'schema','source_commit_sha','parent_receipt_sha256','genesis_explicit',
        'ordered_items','item_count','merkle_algorithm','merkle_root_sha256',
        'proofs','remote_state','time_state','claim_allowed'}:
        raise ValueError('MANIFEST_SCHEMA')
    if v['schema'] != SCHEMA or not GIT_SHA_RE.fullmatch(v['source_commit_sha']):
        raise ValueError('MANIFEST_IDENTITY')
    p = v['parent_receipt_sha256']; gen = v['genesis_explicit']
    if type(gen) is not bool or (p is None) != gen or (p is not None and not SHA256_RE.fullmatch(p)):
        raise ValueError('MANIFEST_PARENT')
    leaves = v['ordered_items']
    if (not isinstance(leaves,list) or not 1 <= len(leaves) <= MAX_ITEMS or
        type(v['item_count']) is not int or v['item_count'] != len(leaves)):
        raise ValueError('MANIFEST_ITEMS')
    ids = set()
    for i,leaf in enumerate(leaves):
        if (not isinstance(leaf,dict) or set(leaf) != {'seq','alias','bytes','sha256'} or
            type(leaf['seq']) is not int or leaf['seq'] != i or
            type(leaf['bytes']) is not int or not 0 <= leaf['bytes'] <= MAX_FILE_BYTES or
            not isinstance(leaf['alias'],str) or not ALIAS_RE.fullmatch(leaf['alias']) or
            leaf['alias'] in ids or not isinstance(leaf['sha256'],str) or
            not SHA256_RE.fullmatch(leaf['sha256'])):
            raise ValueError('MANIFEST_LEAF')
        ids.add(leaf['alias'])
    hashes=[leaf_digest(x) for x in leaves]
    root=tree_root(hashes)
    if (v['merkle_algorithm'] != 'SHA256_RFC9162_STYLE_PREFIX_00_01' or
        v['merkle_root_sha256'] != root.hex()):
        raise ValueError('MERKLE_ROOT_MISMATCH')
    proof_lists=v['proofs']
    if not isinstance(proof_lists,list) or len(proof_lists)!=len(leaves):
        raise ValueError('PROOF_LIST')
    for i,pp in enumerate(proof_lists):
        if (not isinstance(pp,list) or len(pp)>16 or any(not isinstance(z,str) or not SHA256_RE.fullmatch(z) for z in pp)):
            raise ValueError('PROOF_FORMAT')
        if not verify_proof(hashes[i],i,len(leaves),[bytes.fromhex(s) for s in pp],root):
            raise ValueError('PROOF_MISMATCH')
    if (v['remote_state'] != 'HOLD_NOT_COMMITTED' or
        v['time_state'] != 'TOKEN_VAZIO_EXTERNAL_NOT_VERIFIED' or
        v['claim_allowed'] is not False):
        raise ValueError('UNAUTHORIZED_CLAIM')
    return v


def der_length(n):
    if n<0:raise ValueError('DER_LENGTH')
    if n<128:return bytes([n])
    b=n.to_bytes((n.bit_length()+7)//8,'big')
    return bytes([0x80|len(b)])+b


def tlv(tag, body):
    return bytes([tag])+der_length(len(body))+body


def der_integer(n):
    if type(n) is not int or n<0:raise ValueError('DER_INT')
    b=n.to_bytes(max(1,(n.bit_length()+7)//8),'big')
    if b[0] & 0x80:b=b'\x00'+b
    return tlv(2,b)


def build_tsq(manifest_raw,nonce=None):
    check_manifest(manifest_raw)
    if nonce is None:nonce=secrets.randbits(128) | (1<<127)
    if type(nonce) is not int or not 0 < nonce < 1<<160:raise ValueError('NONCE_RANGE')
    alg=tlv(0x30,tlv(6,bytes.fromhex('608648016503040201'))+tlv(5,b''))
    imprint=tlv(0x30,alg+tlv(4,sha(manifest_raw)))
    return tlv(0x30,der_integer(1)+imprint+der_integer(nonce)+tlv(1,b'\xff'))


def parse_tlv(data,offset):
    if offset >= len(data):raise ValueError('DER_TRUNCATED')
    tag=data[offset];offset+=1
    if tag&31==31:raise ValueError('DER_HIGHTAG_UNSUPPORTED')
    if offset>=len(data):raise ValueError('DER_TRUNCATED_LENGTH')
    l=data[offset];offset+=1
    if l==0x80:raise ValueError('DER_INDEFINITE')
    if l>=0x80:
        n=l&0x7f
        if n==0 or n>4 or offset+n>len(data) or data[offset]==0:raise ValueError('DER_LENGTH')
        l=int.from_bytes(data[offset:offset+n],'big');offset+=n
        if l<128:raise ValueError('DER_NONMINIMAL_LENGTH')
    end=offset+l
    if end>len(data):raise ValueError('DER_TRUNCATED_BODY')
    return tag,data[offset:end],end


def parse_tsq(tsq):
    if not 64<=len(tsq)<4096:raise ValueError('TSQ_SIZE')
    tag,body,end=parse_tlv(tsq,0)
    if tag!=0x30 or end!=len(tsq):raise ValueError('TSQ_SEQUENCE')
    i=0; parts=[]
    while i<len(body):
        t,datum,j=parse_tlv(body,i);parts.append((t,datum));i=j
    if len(parts)!=4 or [x[0] for x in parts]!=[2,0x30,2,1] or parts[0][1]!=b'\x01' or parts[3][1]!=b'\xff':
        raise ValueError('TSQ_FORMAT')
    # Restrict algorithm identifier to SHA-256 with the optional NULL encoding we generate.
    im=parts[1][1]; a,alg,pos=parse_tlv(im,0);b,digest,fin=parse_tlv(im,pos)
    oid=bytes.fromhex('0609608648016503040201');null=b'\x05\x00'
    if a!=0x30 or alg!=oid+null or b!=4 or len(digest)!=32 or fin!=len(im):
        raise ValueError('TSQ_IMPRINT')
    nonce=parts[2][1]
    if not nonce or nonce[0]&0x80 or (len(nonce)>1 and nonce[:2]==b'\x00\x00'):
        raise ValueError('TSQ_NONCE')
    return digest, int.from_bytes(nonce,'big')


def atomic_exclusive(path,data):
    path=Path(path)
    if not path.parent.is_dir():raise ValueError('OUTPUT_PARENT_MISSING')
    with path.open('xb') as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    return sha(path.read_bytes()).hex()


def verify_timestamp(manifest_path,query_path,response_path,ca_path,untrusted_path=None,openssl='openssl'):
    manifest=Path(manifest_path).read_bytes();m=check_manifest(manifest)
    tsq=Path(query_path).read_bytes();response=Path(response_path).read_bytes()
    imprint,nonce=parse_tsq(tsq)
    if imprint != sha(manifest):raise ValueError('TSQ_MANIFEST_MISMATCH')
    if len(response)>4*1024*1024:raise ValueError('TSR_TOO_LARGE')
    response_hash,_=hash_file(response_path)
    if response_hash != sha(response).hex():raise ValueError('TSR_SOURCE_CHANGED')
    # Trust anchor is supplied explicitly, never fetched or silently trusted.
    ca_hash,ca_len=hash_file(ca_path)
    try:
        untrusted_hash=hash_file(untrusted_path)[0] if untrusted_path else None
    except OSError as exc:
        raise ValueError('CHAIN_FILE_UNAVAILABLE') from exc
    if ca_len == 0:raise ValueError('EMPTY_TRUST_ANCHOR')
    args=[openssl,'ts','-verify','-queryfile',str(query_path),'-in',str(response_path),'-CAfile',str(ca_path)]
    if untrusted_path:args.extend(['-untrusted',str(untrusted_path)])
    try:
        cmd=subprocess.run(args,capture_output=True,text=True,timeout=20,check=False)
    except (FileNotFoundError,subprocess.TimeoutExpired) as exc:
        raise ValueError('VERIFIER_UNAVAILABLE_OR_TIMEOUT') from exc
    if cmd.returncode != 0 or 'Verification: OK' not in cmd.stdout:
        raise ValueError('RFC3161_SIGNATURE_CHAIN_OR_IMPRINT_INVALID')
    if (hash_file(query_path)[0] != sha(tsq).hex() or
        hash_file(response_path)[0] != response_hash or
        hash_file(ca_path)[0] != ca_hash or
        (untrusted_path and hash_file(untrusted_path)[0] != untrusted_hash)):
        raise ValueError('SOURCE_MUTATED_DURING_EXTERNAL_VERIFICATION')
    return {'schema':'rafaelia.frida.timestamp-verification/v1',
            'manifest_sha256':sha(manifest).hex(),'query_sha256':sha(tsq).hex(),
            'response_sha256':response_hash, 'ca_bundle_sha256':ca_hash,
            'untrusted_chain_sha256':untrusted_hash,
            'merkle_root_sha256':m['merkle_root_sha256'],
            'parent_receipt_sha256':m['parent_receipt_sha256'],
            'request_nonce':str(nonce),
            'status':'PASS_SCOPED_OPENSSL_RFC3161_WITH_SUPPLIED_TRUST_ANCHOR',
            'provenance_authority':'EXTERNALLY_TRUSTED_CA_NOT_INFERRED',
            'github_commit_verified':'TOKEN_VAZIO', 'cloud_commit':'HOLD_NOT_COMMITTED',
            'physical_execution_verified':'TOKEN_VAZIO', 'claim_allowed':False}


def main(argv=None):
    ap=argparse.ArgumentParser(description=__doc__)
    sp=ap.add_subparsers(dest='command',required=True)
    build=sp.add_parser('build');build.add_argument('--source-commit',required=True)
    src=build.add_mutually_exclusive_group(required=True)
    src.add_argument('--parent-receipt');src.add_argument('--genesis',action='store_true')
    build.add_argument('--item',action='append',required=True,help='ALIAS=local_file_path')
    build.add_argument('--out',required=True)
    q=sp.add_parser('query');q.add_argument('--manifest',required=True);q.add_argument('--out',required=True)
    v=sp.add_parser('verify');v.add_argument('--manifest',required=True);v.add_argument('--query',required=True)
    v.add_argument('--response',required=True);v.add_argument('--ca-file',required=True)
    v.add_argument('--untrusted');v.add_argument('--out',required=True)
    a=ap.parse_args(argv)
    try:
        if a.command=='build':
            items=[]
            for spec in a.item:
                if '=' not in spec:raise ValueError('ITEM_ALIAS_PATH_REQUIRED')
                alias,path=spec.split('=',1);items.append((alias,path))
            m=new_manifest(items,a.source_commit,a.parent_receipt,a.genesis)
            data=canon(m)+b'\n'
        elif a.command=='query':
            data=build_tsq(Path(a.manifest).read_bytes())
            parse_tsq(data)
        else:
            o=verify_timestamp(a.manifest,a.query,a.response,a.ca_file,a.untrusted)
            data=canon(o)+b'\n'
        digest=atomic_exclusive(a.out,data)
        print(json.dumps({'state':'WRITTEN_LOCAL_NOT_CLOUD','output_sha256':digest,'kind':a.command}))
        return 0
    except (ValueError,OSError,UnicodeError,TypeError) as e:
        print(json.dumps({'state':'BLOCKED','reason_type':type(e).__name__,
                          'detail':str(e),'claim_allowed':False}))
        return 2


if __name__=='__main__':raise SystemExit(main())

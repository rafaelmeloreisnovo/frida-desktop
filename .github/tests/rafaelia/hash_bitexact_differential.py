#!/usr/bin/env python3
import ctypes
import hashlib
import pathlib
import subprocess
import tempfile

root = pathlib.Path(__file__).resolve().parents[3] / "android" / "app" / "native"
lengths = [0,1,2,3,7,55,56,57,63,64,65,111,112,113,127,128,129,255,256,511,512,1023,4095,4096,4097]
with tempfile.TemporaryDirectory() as td0:
    td = pathlib.Path(td0)
    c = td / "w.c"
    so = td / "w.so"
    c.write_text(
        '#include "hash_bitexact_digest.h"\n'
        'void m(const void*p,unsigned long long n,unsigned char*out){rafaelia_md5_digest(p,n,out);}\n'
        'void s256(const void*p,unsigned long long n,unsigned char*out){rafaelia_sha256_digest(p,n,out);}\n'
        'void s512(const void*p,unsigned long long n,unsigned char*out){rafaelia_sha512_digest(p,n,out);}\n'
    )
    subprocess.run(["clang","-std=c11","-O2","-fPIC","-shared","-I",str(root),str(c),"-o",str(so)],check=True)
    lib = ctypes.CDLL(str(so))
    for name, nout, hf in [("m",16,hashlib.md5),("s256",32,hashlib.sha256),("s512",64,hashlib.sha512)]:
        fn = getattr(lib,name)
        fn.argtypes = [ctypes.c_void_p,ctypes.c_ulonglong,ctypes.c_void_p]
        for n in lengths:
            data = bytes(((i * 131 + 17) & 255) for i in range(n))
            ib = ctypes.create_string_buffer(data if data else b"\0")
            ob = (ctypes.c_ubyte * nout)()
            fn(ib,n,ob)
            if bytes(ob) != hf(data).digest():
                raise SystemExit(f"{name} mismatch length={n}")
print(f"DIFFERENTIAL_PASS algorithms=3 lengths={len(lengths)} cases={3*len(lengths)}")

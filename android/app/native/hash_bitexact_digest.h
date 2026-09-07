#ifndef RAFAELIA_HASH_BITEXACT_DIGEST_H
#define RAFAELIA_HASH_BITEXACT_DIGEST_H
#include "hash_bitexact_equations.h"

typedef struct { rafaelia_u32 h[4]; rafaelia_u64 total; rafaelia_u32 used; rafaelia_u8 block[64]; } rafaelia_md5_ctx;
typedef struct { rafaelia_u32 h[8]; rafaelia_u64 total; rafaelia_u32 used; rafaelia_u8 block[64]; } rafaelia_sha256_ctx;
typedef struct { rafaelia_u64 h[8]; rafaelia_u64 total; rafaelia_u32 used; rafaelia_u8 block[128]; } rafaelia_sha512_ctx;

RAFAELIA_FORCE_INLINE void rafaelia_md5_compress(rafaelia_md5_ctx *q, const rafaelia_u8 p[64]) {
  static const rafaelia_u32 k[64]={
    0xd76aa478u,0xe8c7b756u,0x242070dbu,0xc1bdceeeu,0xf57c0fafu,0x4787c62au,0xa8304613u,0xfd469501u,
    0x698098d8u,0x8b44f7afu,0xffff5bb1u,0x895cd7beu,0x6b901122u,0xfd987193u,0xa679438eu,0x49b40821u,
    0xf61e2562u,0xc040b340u,0x265e5a51u,0xe9b6c7aau,0xd62f105du,0x02441453u,0xd8a1e681u,0xe7d3fbc8u,
    0x21e1cde6u,0xc33707d6u,0xf4d50d87u,0x455a14edu,0xa9e3e905u,0xfcefa3f8u,0x676f02d9u,0x8d2a4c8au,
    0xfffa3942u,0x8771f681u,0x6d9d6122u,0xfde5380cu,0xa4beea44u,0x4bdecfa9u,0xf6bb4b60u,0xbebfbc70u,
    0x289b7ec6u,0xeaa127fau,0xd4ef3085u,0x04881d05u,0xd9d4d039u,0xe6db99e5u,0x1fa27cf8u,0xc4ac5665u,
    0xf4292244u,0x432aff97u,0xab9423a7u,0xfc93a039u,0x655b59c3u,0x8f0ccc92u,0xffeff47du,0x85845dd1u,
    0x6fa87e4fu,0xfe2ce6e0u,0xa3014314u,0x4e0811a1u,0xf7537e82u,0xbd3af235u,0x2ad7d2bbu,0xeb86d391u};
  static const rafaelia_u8 s1[16]={7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22};
  static const rafaelia_u8 s2[16]={5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20};
  static const rafaelia_u8 s3[16]={4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23};
  static const rafaelia_u8 s4[16]={6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21};
  rafaelia_u32 m[16],a=q->h[0],b=q->h[1],c=q->h[2],d=q->h[3],t,f,g;
  unsigned int i;
  for(i=0;i<16u;i++)m[i]=rafaelia_load32_le(p+(i<<2));
#define RMD5(F,G,K,S) do { f=(F); g=(G); t=d; d=c; c=b; b=rafaelia_md5_step(a,b,f,m[g],k[(K)],(S)); a=t; } while(0)
  for(i=0;i<16u;i++) RMD5(rafaelia_md5_f(b,c,d),i,i,s1[i]);
  for(i=0;i<16u;i++) RMD5(rafaelia_md5_g(b,c,d),(5u*i+1u)&15u,16u+i,s2[i]);
  for(i=0;i<16u;i++) RMD5(rafaelia_md5_h(b,c,d),(3u*i+5u)&15u,32u+i,s3[i]);
  for(i=0;i<16u;i++) RMD5(rafaelia_md5_i(b,c,d),(7u*i)&15u,48u+i,s4[i]);
#undef RMD5
  q->h[0]=rafaelia_add32(q->h[0],a); q->h[1]=rafaelia_add32(q->h[1],b);
  q->h[2]=rafaelia_add32(q->h[2],c); q->h[3]=rafaelia_add32(q->h[3],d);
}

RAFAELIA_FORCE_INLINE void rafaelia_md5_init(rafaelia_md5_ctx *q){q->h[0]=0x67452301u;q->h[1]=0xefcdab89u;q->h[2]=0x98badcfeu;q->h[3]=0x10325476u;q->total=0;q->used=0;}
RAFAELIA_FORCE_INLINE void rafaelia_md5_update(rafaelia_md5_ctx*q,const void*p0,rafaelia_u64 n){const rafaelia_u8*p=(const rafaelia_u8*)p0;q->total+=n;while(n){if(q->used==0u&&n>=64u){rafaelia_md5_compress(q,p);p+=64;n-=64;continue;}rafaelia_u32 take=(rafaelia_u32)(64u-q->used);if((rafaelia_u64)take>n)take=(rafaelia_u32)n;rafaelia_u32 i;for(i=0;i<take;i++)q->block[q->used+i]=p[i];q->used+=take;p+=take;n-=take;if(q->used==64u){rafaelia_md5_compress(q,q->block);q->used=0;}}}
RAFAELIA_FORCE_INLINE void rafaelia_md5_final(rafaelia_md5_ctx*q,rafaelia_u8 out[16]){rafaelia_u64 bits=q->total<<3;rafaelia_u32 i;q->block[q->used++]=0x80u;if(q->used>56u){while(q->used<64u)q->block[q->used++]=0;rafaelia_md5_compress(q,q->block);q->used=0;}while(q->used<56u)q->block[q->used++]=0;rafaelia_store64_le(q->block+56,bits);rafaelia_md5_compress(q,q->block);for(i=0;i<4u;i++)rafaelia_store32_le(out+(i<<2),q->h[i]);}
RAFAELIA_FORCE_INLINE void rafaelia_md5_digest(const void*p,rafaelia_u64 n,rafaelia_u8 out[16]){rafaelia_md5_ctx q;rafaelia_md5_init(&q);rafaelia_md5_update(&q,p,n);rafaelia_md5_final(&q,out);}

RAFAELIA_FORCE_INLINE void rafaelia_sha256_compress(rafaelia_sha256_ctx*q,const rafaelia_u8 p[64]){
 static const rafaelia_u32 k[64]={0x428a2f98u,0x71374491u,0xb5c0fbcfu,0xe9b5dba5u,0x3956c25bu,0x59f111f1u,0x923f82a4u,0xab1c5ed5u,0xd807aa98u,0x12835b01u,0x243185beu,0x550c7dc3u,0x72be5d74u,0x80deb1feu,0x9bdc06a7u,0xc19bf174u,0xe49b69c1u,0xefbe4786u,0x0fc19dc6u,0x240ca1ccu,0x2de92c6fu,0x4a7484aau,0x5cb0a9dcu,0x76f988dau,0x983e5152u,0xa831c66du,0xb00327c8u,0xbf597fc7u,0xc6e00bf3u,0xd5a79147u,0x06ca6351u,0x14292967u,0x27b70a85u,0x2e1b2138u,0x4d2c6dfcu,0x53380d13u,0x650a7354u,0x766a0abbu,0x81c2c92eu,0x92722c85u,0xa2bfe8a1u,0xa81a664bu,0xc24b8b70u,0xc76c51a3u,0xd192e819u,0xd6990624u,0xf40e3585u,0x106aa070u,0x19a4c116u,0x1e376c08u,0x2748774cu,0x34b0bcb5u,0x391c0cb3u,0x4ed8aa4au,0x5b9cca4fu,0x682e6ff3u,0x748f82eeu,0x78a5636fu,0x84c87814u,0x8cc70208u,0x90befffau,0xa4506cebu,0xbef9a3f7u,0xc67178f2u};
 rafaelia_u32 w[64],a=q->h[0],b=q->h[1],c=q->h[2],d=q->h[3],e=q->h[4],f=q->h[5],g=q->h[6],h=q->h[7],t1,t2;unsigned int i;
 for(i=0;i<16u;i++)w[i]=rafaelia_load32_be(p+(i<<2));for(i=16u;i<64u;i++)w[i]=RAFAELIA_ADD32_4(rafaelia_sha256_ssig1(w[i-2]),w[i-7],rafaelia_sha256_ssig0(w[i-15]),w[i-16]);
 for(i=0;i<64u;i++){t1=RAFAELIA_ADD32_5(h,rafaelia_sha256_bsig1(e),rafaelia_sha256_ch(e,f,g),k[i],w[i]);t2=rafaelia_add32(rafaelia_sha256_bsig0(a),rafaelia_sha256_maj(a,b,c));h=g;g=f;f=e;e=rafaelia_add32(d,t1);d=c;c=b;b=a;a=rafaelia_add32(t1,t2);}
 q->h[0]=rafaelia_add32(q->h[0],a);q->h[1]=rafaelia_add32(q->h[1],b);q->h[2]=rafaelia_add32(q->h[2],c);q->h[3]=rafaelia_add32(q->h[3],d);q->h[4]=rafaelia_add32(q->h[4],e);q->h[5]=rafaelia_add32(q->h[5],f);q->h[6]=rafaelia_add32(q->h[6],g);q->h[7]=rafaelia_add32(q->h[7],h);
}
RAFAELIA_FORCE_INLINE void rafaelia_sha256_init(rafaelia_sha256_ctx*q){static const rafaelia_u32 x[8]={0x6a09e667u,0xbb67ae85u,0x3c6ef372u,0xa54ff53au,0x510e527fu,0x9b05688cu,0x1f83d9abu,0x5be0cd19u};unsigned int i;for(i=0;i<8u;i++)q->h[i]=x[i];q->total=0;q->used=0;}
RAFAELIA_FORCE_INLINE void rafaelia_sha256_update(rafaelia_sha256_ctx*q,const void*p0,rafaelia_u64 n){const rafaelia_u8*p=(const rafaelia_u8*)p0;q->total+=n;while(n){if(q->used==0u&&n>=64u){rafaelia_sha256_compress(q,p);p+=64;n-=64;continue;}rafaelia_u32 take=(rafaelia_u32)(64u-q->used);if((rafaelia_u64)take>n)take=(rafaelia_u32)n;rafaelia_u32 i;for(i=0;i<take;i++)q->block[q->used+i]=p[i];q->used+=take;p+=take;n-=take;if(q->used==64u){rafaelia_sha256_compress(q,q->block);q->used=0;}}}
RAFAELIA_FORCE_INLINE void rafaelia_sha256_final(rafaelia_sha256_ctx*q,rafaelia_u8 out[32]){rafaelia_u64 bits=q->total<<3;rafaelia_u32 i;q->block[q->used++]=0x80u;if(q->used>56u){while(q->used<64u)q->block[q->used++]=0;rafaelia_sha256_compress(q,q->block);q->used=0;}while(q->used<56u)q->block[q->used++]=0;rafaelia_store64_be(q->block+56,bits);rafaelia_sha256_compress(q,q->block);for(i=0;i<8u;i++)rafaelia_store32_be(out+(i<<2),q->h[i]);}
RAFAELIA_FORCE_INLINE void rafaelia_sha256_digest(const void*p,rafaelia_u64 n,rafaelia_u8 out[32]){rafaelia_sha256_ctx q;rafaelia_sha256_init(&q);rafaelia_sha256_update(&q,p,n);rafaelia_sha256_final(&q,out);}

RAFAELIA_FORCE_INLINE rafaelia_u64 rafaelia_sha512_ch(rafaelia_u64 x,rafaelia_u64 y,rafaelia_u64 z){return rafaelia_xor64(rafaelia_and64(x,y),rafaelia_and64(rafaelia_not64(x),z));}
RAFAELIA_FORCE_INLINE rafaelia_u64 rafaelia_sha512_maj(rafaelia_u64 x,rafaelia_u64 y,rafaelia_u64 z){return rafaelia_xor64(rafaelia_xor64(rafaelia_and64(x,y),rafaelia_and64(x,z)),rafaelia_and64(y,z));}
RAFAELIA_FORCE_INLINE rafaelia_u64 rafaelia_sha512_bsig0(rafaelia_u64 x){return rafaelia_xor64(rafaelia_xor64(rafaelia_rotr64(x,28),rafaelia_rotr64(x,34)),rafaelia_rotr64(x,39));}
RAFAELIA_FORCE_INLINE rafaelia_u64 rafaelia_sha512_bsig1(rafaelia_u64 x){return rafaelia_xor64(rafaelia_xor64(rafaelia_rotr64(x,14),rafaelia_rotr64(x,18)),rafaelia_rotr64(x,41));}
RAFAELIA_FORCE_INLINE rafaelia_u64 rafaelia_sha512_ssig0(rafaelia_u64 x){return rafaelia_xor64(rafaelia_xor64(rafaelia_rotr64(x,1),rafaelia_rotr64(x,8)),rafaelia_shr64(x,7));}
RAFAELIA_FORCE_INLINE rafaelia_u64 rafaelia_sha512_ssig1(rafaelia_u64 x){return rafaelia_xor64(rafaelia_xor64(rafaelia_rotr64(x,19),rafaelia_rotr64(x,61)),rafaelia_shr64(x,6));}
RAFAELIA_FORCE_INLINE void rafaelia_sha512_compress(rafaelia_sha512_ctx*q,const rafaelia_u8 p[128]){
 static const rafaelia_u64 k[80]={
0x428a2f98d728ae22ULL,0x7137449123ef65cdULL,0xb5c0fbcfec4d3b2fULL,0xe9b5dba58189dbbcULL,0x3956c25bf348b538ULL,0x59f111f1b605d019ULL,0x923f82a4af194f9bULL,0xab1c5ed5da6d8118ULL,
0xd807aa98a3030242ULL,0x12835b0145706fbeULL,0x243185be4ee4b28cULL,0x550c7dc3d5ffb4e2ULL,0x72be5d74f27b896fULL,0x80deb1fe3b1696b1ULL,0x9bdc06a725c71235ULL,0xc19bf174cf692694ULL,
0xe49b69c19ef14ad2ULL,0xefbe4786384f25e3ULL,0x0fc19dc68b8cd5b5ULL,0x240ca1cc77ac9c65ULL,0x2de92c6f592b0275ULL,0x4a7484aa6ea6e483ULL,0x5cb0a9dcbd41fbd4ULL,0x76f988da831153b5ULL,
0x983e5152ee66dfabULL,0xa831c66d2db43210ULL,0xb00327c898fb213fULL,0xbf597fc7beef0ee4ULL,0xc6e00bf33da88fc2ULL,0xd5a79147930aa725ULL,0x06ca6351e003826fULL,0x142929670a0e6e70ULL,
0x27b70a8546d22ffcULL,0x2e1b21385c26c926ULL,0x4d2c6dfc5ac42aedULL,0x53380d139d95b3dfULL,0x650a73548baf63deULL,0x766a0abb3c77b2a8ULL,0x81c2c92e47edaee6ULL,0x92722c851482353bULL,
0xa2bfe8a14cf10364ULL,0xa81a664bbc423001ULL,0xc24b8b70d0f89791ULL,0xc76c51a30654be30ULL,0xd192e819d6ef5218ULL,0xd69906245565a910ULL,0xf40e35855771202aULL,0x106aa07032bbd1b8ULL,
0x19a4c116b8d2d0c8ULL,0x1e376c085141ab53ULL,0x2748774cdf8eeb99ULL,0x34b0bcb5e19b48a8ULL,0x391c0cb3c5c95a63ULL,0x4ed8aa4ae3418acbULL,0x5b9cca4f7763e373ULL,0x682e6ff3d6b2b8a3ULL,
0x748f82ee5defb2fcULL,0x78a5636f43172f60ULL,0x84c87814a1f0ab72ULL,0x8cc702081a6439ecULL,0x90befffa23631e28ULL,0xa4506cebde82bde9ULL,0xbef9a3f7b2c67915ULL,0xc67178f2e372532bULL,
0xca273eceea26619cULL,0xd186b8c721c0c207ULL,0xeada7dd6cde0eb1eULL,0xf57d4f7fee6ed178ULL,0x06f067aa72176fbaULL,0x0a637dc5a2c898a6ULL,0x113f9804bef90daeULL,0x1b710b35131c471bULL,
0x28db77f523047d84ULL,0x32caab7b40c72493ULL,0x3c9ebe0a15c9bebcULL,0x431d67c49c100d4cULL,0x4cc5d4becb3e42b6ULL,0x597f299cfc657e2aULL,0x5fcb6fab3ad6faecULL,0x6c44198c4a475817ULL};
 rafaelia_u64 w[80],a=q->h[0],b=q->h[1],c=q->h[2],d=q->h[3],e=q->h[4],f=q->h[5],g=q->h[6],h=q->h[7],t1,t2;unsigned int i;
 for(i=0;i<16u;i++)w[i]=rafaelia_load64_be(p+(i<<3));for(i=16u;i<80u;i++)w[i]=RAFAELIA_ADD64_4(rafaelia_sha512_ssig1(w[i-2]),w[i-7],rafaelia_sha512_ssig0(w[i-15]),w[i-16]);
 for(i=0;i<80u;i++){t1=RAFAELIA_ADD64_5(h,rafaelia_sha512_bsig1(e),rafaelia_sha512_ch(e,f,g),k[i],w[i]);t2=rafaelia_add64(rafaelia_sha512_bsig0(a),rafaelia_sha512_maj(a,b,c));h=g;g=f;f=e;e=rafaelia_add64(d,t1);d=c;c=b;b=a;a=rafaelia_add64(t1,t2);}
 q->h[0]=rafaelia_add64(q->h[0],a);q->h[1]=rafaelia_add64(q->h[1],b);q->h[2]=rafaelia_add64(q->h[2],c);q->h[3]=rafaelia_add64(q->h[3],d);q->h[4]=rafaelia_add64(q->h[4],e);q->h[5]=rafaelia_add64(q->h[5],f);q->h[6]=rafaelia_add64(q->h[6],g);q->h[7]=rafaelia_add64(q->h[7],h);
}
RAFAELIA_FORCE_INLINE void rafaelia_sha512_init(rafaelia_sha512_ctx*q){static const rafaelia_u64 x[8]={0x6a09e667f3bcc908ULL,0xbb67ae8584caa73bULL,0x3c6ef372fe94f82bULL,0xa54ff53a5f1d36f1ULL,0x510e527fade682d1ULL,0x9b05688c2b3e6c1fULL,0x1f83d9abfb41bd6bULL,0x5be0cd19137e2179ULL};unsigned int i;for(i=0;i<8u;i++)q->h[i]=x[i];q->total=0;q->used=0;}
RAFAELIA_FORCE_INLINE void rafaelia_sha512_update(rafaelia_sha512_ctx*q,const void*p0,rafaelia_u64 n){const rafaelia_u8*p=(const rafaelia_u8*)p0;q->total+=n;while(n){if(q->used==0u&&n>=128u){rafaelia_sha512_compress(q,p);p+=128;n-=128;continue;}rafaelia_u32 take=(rafaelia_u32)(128u-q->used);if((rafaelia_u64)take>n)take=(rafaelia_u32)n;rafaelia_u32 i;for(i=0;i<take;i++)q->block[q->used+i]=p[i];q->used+=take;p+=take;n-=take;if(q->used==128u){rafaelia_sha512_compress(q,q->block);q->used=0;}}}
RAFAELIA_FORCE_INLINE void rafaelia_sha512_final(rafaelia_sha512_ctx*q,rafaelia_u8 out[64]){rafaelia_u64 hi=q->total>>61,lo=q->total<<3;rafaelia_u32 i;q->block[q->used++]=0x80u;if(q->used>112u){while(q->used<128u)q->block[q->used++]=0;rafaelia_sha512_compress(q,q->block);q->used=0;}while(q->used<112u)q->block[q->used++]=0;rafaelia_store64_be(q->block+112,hi);rafaelia_store64_be(q->block+120,lo);rafaelia_sha512_compress(q,q->block);for(i=0;i<8u;i++)rafaelia_store64_be(out+(i<<3),q->h[i]);}
RAFAELIA_FORCE_INLINE void rafaelia_sha512_digest(const void*p,rafaelia_u64 n,rafaelia_u8 out[64]){rafaelia_sha512_ctx q;rafaelia_sha512_init(&q);rafaelia_sha512_update(&q,p,n);rafaelia_sha512_final(&q,out);}
#endif

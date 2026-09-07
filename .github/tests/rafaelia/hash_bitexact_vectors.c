#include "../../../android/app/native/hash_bitexact_equations.h"

static int eq(const rafaelia_u8 *a, const rafaelia_u8 *b, unsigned int n)
{
  unsigned int i = 0u;
  unsigned int d = 0u;
  while (i != n) { d |= (unsigned int)(a[i] ^ b[i]); ++i; }
  return d == 0u;
}

static void md5_abc(rafaelia_u8 out[16])
{
  static const rafaelia_u32 k[64] = {
    0xd76aa478u,0xe8c7b756u,0x242070dbu,0xc1bdceeeu,0xf57c0fafu,0x4787c62au,0xa8304613u,0xfd469501u,
    0x698098d8u,0x8b44f7afu,0xffff5bb1u,0x895cd7beu,0x6b901122u,0xfd987193u,0xa679438eu,0x49b40821u,
    0xf61e2562u,0xc040b340u,0x265e5a51u,0xe9b6c7aau,0xd62f105du,0x02441453u,0xd8a1e681u,0xe7d3fbc8u,
    0x21e1cde6u,0xc33707d6u,0xf4d50d87u,0x455a14edu,0xa9e3e905u,0xfcefa3f8u,0x676f02d9u,0x8d2a4c8au,
    0xfffa3942u,0x8771f681u,0x6d9d6122u,0xfde5380cu,0xa4beea44u,0x4bdecfa9u,0xf6bb4b60u,0xbebfbc70u,
    0x289b7ec6u,0xeaa127fau,0xd4ef3085u,0x04881d05u,0xd9d4d039u,0xe6db99e5u,0x1fa27cf8u,0xc4ac5665u,
    0xf4292244u,0x432aff97u,0xab9423a7u,0xfc93a039u,0x655b59c3u,0x8f0ccc92u,0xffeff47du,0x85845dd1u,
    0x6fa87e4fu,0xfe2ce6e0u,0xa3014314u,0x4e0811a1u,0xf7537e82u,0xbd3af235u,0x2ad7d2bbu,0xeb86d391u
  };
  static const rafaelia_u8 s[64] = {
    7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
    5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
    4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
    6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21
  };
  rafaelia_u8 block[64] = {0};
  rafaelia_u32 m[16];
  rafaelia_u32 a=0x67452301u,b=0xefcdab89u,c=0x98badcfeu,d=0x10325476u;
  rafaelia_u32 aa=a,bb=b,cc=c,dd=d;
  unsigned int i;
  block[0]='a'; block[1]='b'; block[2]='c'; block[3]=0x80u; block[56]=24u;
  for(i=0;i<16u;i++) m[i]=rafaelia_load32_le(block+4u*i);
  for(i=0;i<64u;i++) {
    rafaelia_u32 f,g,t;
    if(i<16u){f=rafaelia_md5_f(b,c,d);g=i;}
    else if(i<32u){f=rafaelia_md5_g(b,c,d);g=(5u*i+1u)&15u;}
    else if(i<48u){f=rafaelia_md5_h(b,c,d);g=(3u*i+5u)&15u;}
    else {f=rafaelia_md5_i(b,c,d);g=(7u*i)&15u;}
    t=d; d=c; c=b; b=rafaelia_md5_step(a,b,f,m[g],k[i],s[i]); a=t;
  }
  a=rafaelia_add32(a,aa); b=rafaelia_add32(b,bb); c=rafaelia_add32(c,cc); d=rafaelia_add32(d,dd);
  rafaelia_store32_le(out+0,a); rafaelia_store32_le(out+4,b); rafaelia_store32_le(out+8,c); rafaelia_store32_le(out+12,d);
}

static void sha256_abc(rafaelia_u8 out[32])
{
  static const rafaelia_u32 k[64]={
    0x428a2f98u,0x71374491u,0xb5c0fbcfu,0xe9b5dba5u,0x3956c25bu,0x59f111f1u,0x923f82a4u,0xab1c5ed5u,
    0xd807aa98u,0x12835b01u,0x243185beu,0x550c7dc3u,0x72be5d74u,0x80deb1feu,0x9bdc06a7u,0xc19bf174u,
    0xe49b69c1u,0xefbe4786u,0x0fc19dc6u,0x240ca1ccu,0x2de92c6fu,0x4a7484aau,0x5cb0a9dcu,0x76f988dau,
    0x983e5152u,0xa831c66du,0xb00327c8u,0xbf597fc7u,0xc6e00bf3u,0xd5a79147u,0x06ca6351u,0x14292967u,
    0x27b70a85u,0x2e1b2138u,0x4d2c6dfcu,0x53380d13u,0x650a7354u,0x766a0abbu,0x81c2c92eu,0x92722c85u,
    0xa2bfe8a1u,0xa81a664bu,0xc24b8b70u,0xc76c51a3u,0xd192e819u,0xd6990624u,0xf40e3585u,0x106aa070u,
    0x19a4c116u,0x1e376c08u,0x2748774cu,0x34b0bcb5u,0x391c0cb3u,0x4ed8aa4au,0x5b9cca4fu,0x682e6ff3u,
    0x748f82eeu,0x78a5636fu,0x84c87814u,0x8cc70208u,0x90befffau,0xa4506cebu,0xbef9a3f7u,0xc67178f2u};
  rafaelia_u8 block[64]={0}; rafaelia_u32 w[64];
  rafaelia_u32 h[8]={0x6a09e667u,0xbb67ae85u,0x3c6ef372u,0xa54ff53au,0x510e527fu,0x9b05688cu,0x1f83d9abu,0x5be0cd19u};
  rafaelia_u32 a,b,c,d,e,f,g,hh,t1,t2; unsigned int i;
  block[0]='a';block[1]='b';block[2]='c';block[3]=0x80u;block[63]=24u;
  for(i=0;i<16u;i++) w[i]=rafaelia_load32_be(block+4u*i);
  for(i=16u;i<64u;i++) w[i]=RAFAELIA_ADD32_4(rafaelia_sha256_ssig1(w[i-2u]),w[i-7u],rafaelia_sha256_ssig0(w[i-15u]),w[i-16u]);
  a=h[0];b=h[1];c=h[2];d=h[3];e=h[4];f=h[5];g=h[6];hh=h[7];
  for(i=0;i<64u;i++){
    t1=RAFAELIA_ADD32_5(hh,rafaelia_sha256_bsig1(e),rafaelia_sha256_ch(e,f,g),k[i],w[i]);
    t2=rafaelia_add32(rafaelia_sha256_bsig0(a),rafaelia_sha256_maj(a,b,c));
    hh=g;g=f;f=e;e=rafaelia_add32(d,t1);d=c;c=b;b=a;a=rafaelia_add32(t1,t2);
  }
  h[0]=rafaelia_add32(h[0],a);h[1]=rafaelia_add32(h[1],b);h[2]=rafaelia_add32(h[2],c);h[3]=rafaelia_add32(h[3],d);
  h[4]=rafaelia_add32(h[4],e);h[5]=rafaelia_add32(h[5],f);h[6]=rafaelia_add32(h[6],g);h[7]=rafaelia_add32(h[7],hh);
  for(i=0;i<8u;i++)rafaelia_store32_be(out+4u*i,h[i]);
}

static void blake3_empty(rafaelia_u8 out[32])
{
  static const rafaelia_u32 iv[8]={0x6A09E667u,0xBB67AE85u,0x3C6EF372u,0xA54FF53Au,0x510E527Fu,0x9B05688Cu,0x1F83D9ABu,0x5BE0CD19u};
  static const rafaelia_u8 perm[16]={2,6,3,10,7,0,4,13,1,11,12,5,9,14,15,8};
  rafaelia_u32 v[16],m[16]={0},tmp[16]; unsigned int i,r;
  for(i=0;i<8u;i++)v[i]=iv[i]; for(i=0;i<4u;i++)v[8u+i]=iv[i];
  v[12]=0u;v[13]=0u;v[14]=0u;v[15]=11u;
  for(r=0;r<7u;r++){
    rafaelia_blake3_g(&v[0],&v[4],&v[8],&v[12],m[0],m[1]);
    rafaelia_blake3_g(&v[1],&v[5],&v[9],&v[13],m[2],m[3]);
    rafaelia_blake3_g(&v[2],&v[6],&v[10],&v[14],m[4],m[5]);
    rafaelia_blake3_g(&v[3],&v[7],&v[11],&v[15],m[6],m[7]);
    rafaelia_blake3_g(&v[0],&v[5],&v[10],&v[15],m[8],m[9]);
    rafaelia_blake3_g(&v[1],&v[6],&v[11],&v[12],m[10],m[11]);
    rafaelia_blake3_g(&v[2],&v[7],&v[8],&v[13],m[12],m[13]);
    rafaelia_blake3_g(&v[3],&v[4],&v[9],&v[14],m[14],m[15]);
    for(i=0;i<16u;i++)tmp[i]=m[perm[i]]; for(i=0;i<16u;i++)m[i]=tmp[i];
  }
  for(i=0;i<8u;i++)rafaelia_store32_le(out+4u*i,rafaelia_xor32(v[i],v[i+8u]));
}

int main(void)
{
  static const rafaelia_u8 md5_ref[16]={0x90,0x01,0x50,0x98,0x3c,0xd2,0x4f,0xb0,0xd6,0x96,0x3f,0x7d,0x28,0xe1,0x7f,0x72};
  static const rafaelia_u8 sha_ref[32]={0xba,0x78,0x16,0xbf,0x8f,0x01,0xcf,0xea,0x41,0x41,0x40,0xde,0x5d,0xae,0x22,0x23,0xb0,0x03,0x61,0xa3,0x96,0x17,0x7a,0x9c,0xb4,0x10,0xff,0x61,0xf2,0x00,0x15,0xad};
  static const rafaelia_u8 b3_ref[32]={0xaf,0x13,0x49,0xb9,0xf5,0xf9,0xa1,0xa6,0xa0,0x40,0x4d,0xea,0x36,0xdc,0xc9,0x49,0x9b,0xcb,0x25,0xc9,0xad,0xc1,0x12,0xb7,0xcc,0x9a,0x93,0xca,0xe4,0x1f,0x32,0x62};
  rafaelia_u8 x[32]; unsigned int fail=0u;
  md5_abc(x); fail |= !eq(x,md5_ref,16u);
  sha256_abc(x); fail |= !eq(x,sha_ref,32u);
  blake3_empty(x); fail |= !eq(x,b3_ref,32u);
  return (int)fail;
}

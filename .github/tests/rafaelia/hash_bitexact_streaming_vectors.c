#include "../../../android/app/native/hash_bitexact_neon4.h"
static int eq8(const rafaelia_u8*a,const rafaelia_u8*b,unsigned int n){unsigned int i,d=0;for(i=0;i<n;i++)d|=(unsigned int)(a[i]^b[i]);return d==0u;}
static int eq32(const rafaelia_u32*a,const rafaelia_u32*b,unsigned int n){unsigned int i;rafaelia_u32 d=0;for(i=0;i<n;i++)d|=a[i]^b[i];return d==0u;}
static void oneblock(const rafaelia_u8*p,rafaelia_u32 n,rafaelia_u8 b[64]){rafaelia_u32 i;for(i=0;i<64u;i++)b[i]=0;for(i=0;i<n;i++)b[i]=p[i];b[n]=0x80u;b[63]=(rafaelia_u8)(n<<3);}
int main(void){
 static const rafaelia_u8 md5abc[16]={0x90,0x01,0x50,0x98,0x3c,0xd2,0x4f,0xb0,0xd6,0x96,0x3f,0x7d,0x28,0xe1,0x7f,0x72};
 static const rafaelia_u8 shaabc[32]={0xba,0x78,0x16,0xbf,0x8f,0x01,0xcf,0xea,0x41,0x41,0x40,0xde,0x5d,0xae,0x22,0x23,0xb0,0x03,0x61,0xa3,0x96,0x17,0x7a,0x9c,0xb4,0x10,0xff,0x61,0xf2,0x00,0x15,0xad};
 static const rafaelia_u8 sha512abc[64]={0xdd,0xaf,0x35,0xa1,0x93,0x61,0x7a,0xba,0xcc,0x41,0x73,0x49,0xae,0x20,0x41,0x31,0x12,0xe6,0xfa,0x4e,0x89,0xa9,0x7e,0xa2,0x0a,0x9e,0xee,0xe6,0x4b,0x55,0xd3,0x9a,0x21,0x92,0x99,0x2a,0x27,0x4f,0xc1,0xa8,0x36,0xba,0x3c,0x23,0xa3,0xfe,0xeb,0xbd,0x45,0x4d,0x44,0x23,0x64,0x3c,0xe8,0x0e,0x2a,0x9a,0xc9,0x4f,0xa5,0x4c,0xa4,0x9f};
 rafaelia_u8 d[64];rafaelia_md5_digest("abc",3,d);if(!eq8(d,md5abc,16))return 1;rafaelia_sha256_digest("abc",3,d);if(!eq8(d,shaabc,32))return 2;rafaelia_sha512_digest("abc",3,d);if(!eq8(d,sha512abc,64))return 3;
 {rafaelia_sha512_ctx q;rafaelia_sha512_init(&q);rafaelia_sha512_update(&q,"a",1);rafaelia_sha512_update(&q,"bc",2);rafaelia_sha512_final(&q,d);if(!eq8(d,sha512abc,64))return 4;}
 {rafaelia_u8 b[4][64];rafaelia_u32 s[8];rafaelia_sha256x4_state q;unsigned int i,j;static const rafaelia_u8 seed[4]={0x11,0x53,0x97,0xd1};for(j=0;j<4;j++)for(i=0;i<64;i++)b[j][i]=(rafaelia_u8)(seed[j]+(rafaelia_u8)(i*13u));rafaelia_sha256x4_init(&q);rafaelia_sha256x4_compress(&q,b[0],b[1],b[2],b[3]);for(j=0;j<4;j++){rafaelia_sha256_ctx z;rafaelia_u32 lane[8];rafaelia_sha256_init(&z);rafaelia_sha256_compress(&z,b[j]);for(i=0;i<8;i++){s[i]=z.h[i];lane[i]=q.h[i][j];}if(!eq32(lane,s,8))return 10+(int)j;}}
 {rafaelia_u8 b[4][64];rafaelia_u32 out[8][4];static const rafaelia_u8 a0[1]={0};static const rafaelia_u8 a1[1]={'a'};static const rafaelia_u8 a2[2]={'a','b'};static const rafaelia_u8 a3[3]={'a','b','c'};oneblock(a0,0,b[0]);oneblock(a1,1,b[1]);oneblock(a2,2,b[2]);oneblock(a3,3,b[3]);rafaelia_sha256x4_oneblock(b[0],b[1],b[2],b[3],out);for(unsigned int j=0;j<4;j++){rafaelia_sha256_ctx z;rafaelia_sha256_init(&z);rafaelia_sha256_compress(&z,b[j]);for(unsigned int i=0;i<8;i++)if(out[i][j]!=z.h[i])return 20+(int)j;}}
 return 0;
}

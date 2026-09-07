#ifndef RAFAELIA_HASH_BITEXACT_NEON4_H
#define RAFAELIA_HASH_BITEXACT_NEON4_H
#include "hash_bitexact_digest.h"

#if defined(__clang__) || defined(__GNUC__)
typedef rafaelia_u32 rafaelia_v4u32 __attribute__((vector_size(16)));
#else
#error "hash_bitexact_neon4 requires compiler vector extensions"
#endif

typedef struct { rafaelia_u32 h[8][4]; } rafaelia_sha256x4_state;

#define RV4(x) ((rafaelia_v4u32){(x),(x),(x),(x)})
#define RVR(x,n) (((x)>>(n))|((x)<<(32u-(n))))
#define RVCH(x,y,z) (((x)&(y))^((~(x))&(z)))
#define RVMAJ(x,y,z) (((x)&(y))^((x)&(z))^((y)&(z)))
#define RVBS0(x) (RVR((x),2u)^RVR((x),13u)^RVR((x),22u))
#define RVBS1(x) (RVR((x),6u)^RVR((x),11u)^RVR((x),25u))
#define RVSS0(x) (RVR((x),7u)^RVR((x),18u)^((x)>>3u))
#define RVSS1(x) (RVR((x),17u)^RVR((x),19u)^((x)>>10u))

RAFAELIA_FORCE_INLINE void rafaelia_sha256x4_init(rafaelia_sha256x4_state *q){
 static const rafaelia_u32 x[8]={0x6a09e667u,0xbb67ae85u,0x3c6ef372u,0xa54ff53au,0x510e527fu,0x9b05688cu,0x1f83d9abu,0x5be0cd19u};
 unsigned int i,j;for(i=0;i<8u;i++)for(j=0;j<4u;j++)q->h[i][j]=x[i];
}

RAFAELIA_FORCE_INLINE void rafaelia_sha256x4_compress(rafaelia_sha256x4_state *q,const rafaelia_u8 *p0,const rafaelia_u8 *p1,const rafaelia_u8 *p2,const rafaelia_u8 *p3){
 static const rafaelia_u32 k[64]={0x428a2f98u,0x71374491u,0xb5c0fbcfu,0xe9b5dba5u,0x3956c25bu,0x59f111f1u,0x923f82a4u,0xab1c5ed5u,0xd807aa98u,0x12835b01u,0x243185beu,0x550c7dc3u,0x72be5d74u,0x80deb1feu,0x9bdc06a7u,0xc19bf174u,0xe49b69c1u,0xefbe4786u,0x0fc19dc6u,0x240ca1ccu,0x2de92c6fu,0x4a7484aau,0x5cb0a9dcu,0x76f988dau,0x983e5152u,0xa831c66du,0xb00327c8u,0xbf597fc7u,0xc6e00bf3u,0xd5a79147u,0x06ca6351u,0x14292967u,0x27b70a85u,0x2e1b2138u,0x4d2c6dfcu,0x53380d13u,0x650a7354u,0x766a0abbu,0x81c2c92eu,0x92722c85u,0xa2bfe8a1u,0xa81a664bu,0xc24b8b70u,0xc76c51a3u,0xd192e819u,0xd6990624u,0xf40e3585u,0x106aa070u,0x19a4c116u,0x1e376c08u,0x2748774cu,0x34b0bcb5u,0x391c0cb3u,0x4ed8aa4au,0x5b9cca4fu,0x682e6ff3u,0x748f82eeu,0x78a5636fu,0x84c87814u,0x8cc70208u,0x90befffau,0xa4506cebu,0xbef9a3f7u,0xc67178f2u};
 rafaelia_v4u32 w[64],a,b,c,d,e,f,g,h,t1,t2;unsigned int i,j;
 for(i=0;i<16u;i++)w[i]=(rafaelia_v4u32){rafaelia_load32_be(p0+(i<<2)),rafaelia_load32_be(p1+(i<<2)),rafaelia_load32_be(p2+(i<<2)),rafaelia_load32_be(p3+(i<<2))};
 for(i=16u;i<64u;i++)w[i]=RVSS1(w[i-2])+w[i-7]+RVSS0(w[i-15])+w[i-16];
 a=(rafaelia_v4u32){q->h[0][0],q->h[0][1],q->h[0][2],q->h[0][3]};b=(rafaelia_v4u32){q->h[1][0],q->h[1][1],q->h[1][2],q->h[1][3]};c=(rafaelia_v4u32){q->h[2][0],q->h[2][1],q->h[2][2],q->h[2][3]};d=(rafaelia_v4u32){q->h[3][0],q->h[3][1],q->h[3][2],q->h[3][3]};e=(rafaelia_v4u32){q->h[4][0],q->h[4][1],q->h[4][2],q->h[4][3]};f=(rafaelia_v4u32){q->h[5][0],q->h[5][1],q->h[5][2],q->h[5][3]};g=(rafaelia_v4u32){q->h[6][0],q->h[6][1],q->h[6][2],q->h[6][3]};h=(rafaelia_v4u32){q->h[7][0],q->h[7][1],q->h[7][2],q->h[7][3]};
 for(i=0;i<64u;i++){t1=h+RVBS1(e)+RVCH(e,f,g)+RV4(k[i])+w[i];t2=RVBS0(a)+RVMAJ(a,b,c);h=g;g=f;f=e;e=d+t1;d=c;c=b;b=a;a=t1+t2;}
 {rafaelia_v4u32 z[8];z[0]=a+(rafaelia_v4u32){q->h[0][0],q->h[0][1],q->h[0][2],q->h[0][3]};z[1]=b+(rafaelia_v4u32){q->h[1][0],q->h[1][1],q->h[1][2],q->h[1][3]};z[2]=c+(rafaelia_v4u32){q->h[2][0],q->h[2][1],q->h[2][2],q->h[2][3]};z[3]=d+(rafaelia_v4u32){q->h[3][0],q->h[3][1],q->h[3][2],q->h[3][3]};z[4]=e+(rafaelia_v4u32){q->h[4][0],q->h[4][1],q->h[4][2],q->h[4][3]};z[5]=f+(rafaelia_v4u32){q->h[5][0],q->h[5][1],q->h[5][2],q->h[5][3]};z[6]=g+(rafaelia_v4u32){q->h[6][0],q->h[6][1],q->h[6][2],q->h[6][3]};z[7]=h+(rafaelia_v4u32){q->h[7][0],q->h[7][1],q->h[7][2],q->h[7][3]};for(i=0;i<8u;i++)for(j=0;j<4u;j++)q->h[i][j]=z[i][j];}
}

RAFAELIA_FORCE_INLINE void rafaelia_sha256x4_oneblock(const rafaelia_u8 *p0,const rafaelia_u8 *p1,const rafaelia_u8 *p2,const rafaelia_u8 *p3,rafaelia_u32 out[8][4]){rafaelia_sha256x4_state q;unsigned int i,j;rafaelia_sha256x4_init(&q);rafaelia_sha256x4_compress(&q,p0,p1,p2,p3);for(i=0;i<8u;i++)for(j=0;j<4u;j++)out[i][j]=q.h[i][j];}

#undef RV4
#undef RVR
#undef RVCH
#undef RVMAJ
#undef RVBS0
#undef RVBS1
#undef RVSS0
#undef RVSS1
#endif

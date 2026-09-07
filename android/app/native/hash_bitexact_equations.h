#ifndef RAFAELIA_HASH_BITEXACT_EQUATIONS_H
#define RAFAELIA_HASH_BITEXACT_EQUATIONS_H
#include "hash_bitexact_core.h"
RAFAELIA_FORCE_INLINE rafaelia_u32 rafaelia_md5_f(rafaelia_u32 x,rafaelia_u32 y,rafaelia_u32 z){return rafaelia_or32(rafaelia_and32(x,y),rafaelia_and32(rafaelia_not32(x),z));}
RAFAELIA_FORCE_INLINE rafaelia_u32 rafaelia_md5_g(rafaelia_u32 x,rafaelia_u32 y,rafaelia_u32 z){return rafaelia_or32(rafaelia_and32(x,z),rafaelia_and32(y,rafaelia_not32(z)));}
RAFAELIA_FORCE_INLINE rafaelia_u32 rafaelia_md5_h(rafaelia_u32 x,rafaelia_u32 y,rafaelia_u32 z){return rafaelia_xor32(rafaelia_xor32(x,y),z);}
RAFAELIA_FORCE_INLINE rafaelia_u32 rafaelia_md5_i(rafaelia_u32 x,rafaelia_u32 y,rafaelia_u32 z){return rafaelia_xor32(y,rafaelia_or32(x,rafaelia_not32(z)));}
RAFAELIA_FORCE_INLINE rafaelia_u32 rafaelia_md5_step(rafaelia_u32 a,rafaelia_u32 b,rafaelia_u32 f,rafaelia_u32 m,rafaelia_u32 k,unsigned int s){return rafaelia_add32(b,rafaelia_rotl32(RAFAELIA_ADD32_4(a,f,m,k),s));}
RAFAELIA_FORCE_INLINE rafaelia_u32 rafaelia_sha256_ch(rafaelia_u32 x,rafaelia_u32 y,rafaelia_u32 z){return rafaelia_xor32(rafaelia_and32(x,y),rafaelia_and32(rafaelia_not32(x),z));}
RAFAELIA_FORCE_INLINE rafaelia_u32 rafaelia_sha256_maj(rafaelia_u32 x,rafaelia_u32 y,rafaelia_u32 z){return rafaelia_xor32(rafaelia_xor32(rafaelia_and32(x,y),rafaelia_and32(x,z)),rafaelia_and32(y,z));}
RAFAELIA_FORCE_INLINE rafaelia_u32 rafaelia_sha256_bsig0(rafaelia_u32 x){return rafaelia_xor32(rafaelia_xor32(rafaelia_rotr32(x,2u),rafaelia_rotr32(x,13u)),rafaelia_rotr32(x,22u));}
RAFAELIA_FORCE_INLINE rafaelia_u32 rafaelia_sha256_bsig1(rafaelia_u32 x){return rafaelia_xor32(rafaelia_xor32(rafaelia_rotr32(x,6u),rafaelia_rotr32(x,11u)),rafaelia_rotr32(x,25u));}
RAFAELIA_FORCE_INLINE rafaelia_u32 rafaelia_sha256_ssig0(rafaelia_u32 x){return rafaelia_xor32(rafaelia_xor32(rafaelia_rotr32(x,7u),rafaelia_rotr32(x,18u)),rafaelia_shr32(x,3u));}
RAFAELIA_FORCE_INLINE rafaelia_u32 rafaelia_sha256_ssig1(rafaelia_u32 x){return rafaelia_xor32(rafaelia_xor32(rafaelia_rotr32(x,17u),rafaelia_rotr32(x,19u)),rafaelia_shr32(x,10u));}
RAFAELIA_FORCE_INLINE void rafaelia_blake3_g(rafaelia_u32 *a,rafaelia_u32 *b,rafaelia_u32 *c,rafaelia_u32 *d,rafaelia_u32 mx,rafaelia_u32 my){*a=RAFAELIA_ADD32_3(*a,*b,mx);*d=rafaelia_rotr32(rafaelia_xor32(*d,*a),16u);*c=rafaelia_add32(*c,*d);*b=rafaelia_rotr32(rafaelia_xor32(*b,*c),12u);*a=RAFAELIA_ADD32_3(*a,*b,my);*d=rafaelia_rotr32(rafaelia_xor32(*d,*a),8u);*c=rafaelia_add32(*c,*d);*b=rafaelia_rotr32(rafaelia_xor32(*b,*c),7u);}
#endif

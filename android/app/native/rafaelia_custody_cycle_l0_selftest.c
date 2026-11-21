#include "rafaelia_custody_cycle_l0.h"
static RafC32 rol(RafC32 v, RafC32 n) { return n ? (v << n)|(v>>(32u-n)) : v; }
int main(void) {
  RafCustodyPlan p = {0};
  RafCustodyResult r;
  RafC32 i;
  p.xor_mask=0xa5a5u; p.rotate_left=3u; p.addition=7u;
  p.expected_present=1u; p.max_operations=3u;
  for(i=0;i<4u;i++) {p.signatures[i]=0x00001a2bu;p.counters_before[i]=0u;p.counters_after[i]=1u;}
  for(i=0;i<256u;i++) {
    p.input_word=i; p.expected_word=rol(i^p.xor_mask,3u)+7u;
    if(raf_custody_cycle_l0(&p,&r)!=0u||r.output_word!=p.expected_word||r.fifth_state!=1u||r.self_gate_mask!=15u||r.peer_gate_mask!=15u||r.executed_operations!=3u) return 1;
  }
  p.signatures[1]^=1u;
  if(raf_custody_cycle_l0(&p,&r)==0u||r.fifth_state!=0u) return 2;
  p.signatures[1]^=1u;p.counters_after[2]=0u;
  if(raf_custody_cycle_l0(&p,&r)==0u||r.fifth_state!=0u) return 3;
  p.counters_after[2]=1u;p.expected_word^=1u;
  if(raf_custody_cycle_l0(&p,&r)==0u||r.fifth_state!=0u) return 4;
  p.expected_present=0u;
  if(raf_custody_cycle_l0(&p,&r)!=RAF_CUSTODY_MISSING_EXPECTATION) return 5;
  p.expected_present=1u;p.rotate_left=32u;
  if(raf_custody_cycle_l0(&p,&r)==0u) return 6;
  if(raf_custody_cycle_l0((void *)0,&r)==0u) return 7;
  if(raf_custody_cycle_l0(&p,(void *)0)==0u) return 8;
  return 0;
}

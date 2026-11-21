package io.rafaelia.fridalab;
final class CycleMathTest {
  public static void main(String[] args) {
    int[] sig={6699,6699,6699,6699};
    long[] before={0,0,0,0}, after={1,1,1,1};
    if(CycleMath.selfGates(sig,before,after)!=15||CycleMath.peerGates(sig)!=15) throw new AssertionError("gates");
    for(int i=0;i<256;i++) {
      int expect=Integer.rotateLeft(i ^ 15,1)+7;
      if(CycleMath.run(i,15,1,7)!=expect) throw new AssertionError(i);
    }
    sig[1]=42;
    if(CycleMath.peerGates(sig)==15) throw new AssertionError("bad peer accepted");
    sig[1]=6699;after[2]=0;
    if(CycleMath.selfGates(sig,before,after)==15) throw new AssertionError("stale accepted");
    boolean rejects=false;
    try {CycleMath.run(1,2,32,4);}catch(IllegalArgumentException e){rejects=true;}
    if(!rejects) throw new AssertionError("bad rotate accepted");
    System.out.println("PASS: Java CycleMath 256 vectors + gate negatives");
  }
}

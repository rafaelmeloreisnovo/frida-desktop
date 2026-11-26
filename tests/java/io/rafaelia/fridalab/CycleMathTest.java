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
    if(CycleMath.checkedSignature(4294967295L)!=-1 || CycleMath.checkedSignature(6699)!=6699) throw new AssertionError("u32 boundary");
    for(Object invalid : new Object[]{4294973995L,4294967296L,-1L,6699.0,"6699",true,null}) {
      boolean blocked=false;
      try { CycleMath.checkedSignature(invalid); } catch(IllegalArgumentException e) { blocked=true; }
      if(!blocked) throw new AssertionError("signature alias accepted: "+invalid);
    }
    String alias = "\\" + "u0065xpected_word";
    String[] goodJson={"{\"expected_word\":319}","{\"input\":{\"word\":1},\"source\":{\"word\":2}}","{\"note\":\"\\\"expected_word\\\":0\",\"expected_word\":319}","{\"a\":[0,-1,1.5e+2,true,false,null,\"\\u0041\"]}"};
    String[] badJson={"{\"expected_word\":0,\""+alias+"\":319}","{\""+alias+"\":319}","{\"a\":{\"word\":0,\"word\":1}}","{\"a\":1,\"a\":2}","{a:1}","{'a':1}","{\"a\":01}","{\"a\":1,}","{\"a\":1}{}","{\"a\":/*x*/1}","{\"a\":[1,]}","{\"a\":\"\\q\"}","{\"a\":1e}","{\"a\":1e+}","{\"a\":nullx}","{\"a\":[[[[[[[[[1]]]]]]]]]}","[]"};
    for(String s:goodJson) CustodyJsonKeys.validate(s);
    for(String s:badJson) {
      boolean blocked=false;
      try { CustodyJsonKeys.validate(s); } catch(IllegalArgumentException e) { blocked=true; }
      if(!blocked) throw new AssertionError("invalid JSON accepted: "+s);
    }
    System.out.println("PASS: strict JSON key custody "+(goodJson.length+badJson.length)+" vectors");
    System.out.println("PASS: Java CycleMath 256 vectors + gate negatives + signature bounds");
  }
}

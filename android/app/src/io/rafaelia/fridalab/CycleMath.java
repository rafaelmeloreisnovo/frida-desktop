package io.rafaelia.fridalab;
/** Pure Java companion of freestanding rafaelia_custody_cycle_l0.c.
 * No network, Android framework, heap manipulation, file IO or JNI.
 */
final class CycleMath {
    private CycleMath() { }
    static int run(int value, int xorMask, int rotate, int add) {
        if (rotate < 0 || rotate > 31) throw new IllegalArgumentException("rotate");
        return Integer.rotateLeft(value ^ xorMask, rotate) + add;
    }
    static int selfGates(int[] sig, long[] before, long[] after) {
        if (sig.length != 4 || before.length != 4 || after.length != 4) return 0;
        int mask = 0;
        for (int i=0;i<4;i++) if (sig[i] != 0 && after[i] > before[i]) mask |= 1<<i;
        return mask;
    }
    static int peerGates(int[] sig) {
        if (sig.length != 4) return 0;
        int mask = 0;
        for (int i=0;i<4;i++) if (sig[i] != 0 && sig[i] == sig[(i+1)&3]) mask |= 1<<i;
        return mask;
    }
}

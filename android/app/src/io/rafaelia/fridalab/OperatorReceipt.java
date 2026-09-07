package io.rafaelia.fridalab;

import android.os.Build;
import android.os.Process;

/** Human-readable receipt with no new runtime dependency. */
final class OperatorReceipt {
    private OperatorReceipt() {}

    static String format(String probeStatus,
                         String gadgetStatus,
                         String snapshot,
                         String storePath,
                         String learningMode,
                         boolean debuggable) {
        StringBuilder out = new StringBuilder();
        out.append("RAFAELIA_FRIDA_LAB_RECEIPT_V1\n");
        out.append("pid=").append(Process.myPid()).append('\n');
        out.append("sdk=").append(Build.VERSION.SDK_INT).append('\n');
        out.append("android=").append(Build.VERSION.RELEASE).append('\n');
        out.append("abi=").append(primaryAbi()).append('\n');
        out.append("debuggable=").append(debuggable).append('\n');
        out.append("probe=").append(oneLine(probeStatus)).append('\n');
        out.append("gadget=").append(oneLine(gadgetStatus)).append('\n');
        out.append("learning_mode=").append(learningMode).append('\n');
        out.append("store=").append(storePath == null ? "TOKEN_VAZIO" : storePath).append('\n');
        out.append("automatic_active=DISABLED\n");
        out.append("claim_allowed=false\n");
        out.append("--- METRICS ---\n");
        out.append(snapshot == null ? "TOKEN_VAZIO" : snapshot).append('\n');
        return out.toString();
    }

    private static String primaryAbi() {
        return Build.VERSION.SDK_INT >= 21 && Build.SUPPORTED_ABIS.length > 0
                ? Build.SUPPORTED_ABIS[0] : "TOKEN_VAZIO";
    }

    private static String oneLine(String value) {
        return value == null ? "TOKEN_VAZIO" : value.replace('\n', ' ').replace('\r', ' ');
    }
}

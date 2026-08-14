package io.rafaelia.fridalab;

import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.widget.TextView;

public final class MainActivity extends Activity {
    private static String loadElf(String library, String label) {
        try {
            System.loadLibrary(library);
            return label + ": LOADED";
        } catch (Throwable t) {
            return label + ": FAILED\n" + t.getClass().getName() + ": " + String.valueOf(t.getMessage());
        }
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        StringBuilder status = new StringBuilder();
        status.append("RAFAELIA / Frida Android Lab\n\n");
        status.append(loadElf("rafaelia-probe", "Source-built ELF probe")).append("\n");
        status.append(loadElf("frida-gadget", "Frida Gadget ELF")).append("\n");
        status.append("SDK: ").append(Build.VERSION.SDK_INT).append("\n");
        status.append("Primary ABI: ");
        if (Build.VERSION.SDK_INT >= 21 && Build.SUPPORTED_ABIS.length > 0) {
            status.append(Build.SUPPORTED_ABIS[0]);
        } else {
            status.append("TOKEN_VAZIO");
        }
        status.append("\n");
        status.append("C source -> NDK clang -> ELF\n");
        status.append("Java source -> javac -> D8 -> DEX -> Activity -> System.loadLibrary -> ELF\n");
        status.append("Embedded Gadget endpoint: 127.0.0.1:27042\n");

        TextView view = new TextView(this);
        view.setText(status.toString());
        view.setTextSize(16.0f);
        int pad = 32;
        view.setPadding(pad, pad, pad, pad);
        setContentView(view);
    }
}

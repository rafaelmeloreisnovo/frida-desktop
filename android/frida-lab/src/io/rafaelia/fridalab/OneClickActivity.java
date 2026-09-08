package io.rafaelia.fridalab;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Process;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.lang.reflect.Method;

/**
 * Minimal operator surface for the already-working Frida/RFL lab.
 * One start button, read-only progress boxes, then one receipt button.
 * No synthetic observations are generated here: only real learningObserve()
 * traffic can satisfy the healthy-evidence gate.
 */
public final class OneClickActivity extends Activity {
    private static final int LEARN_SHADOW = 2;
    private static final long MIN_OBSERVATIONS = 64L; // one complete RFL slab
    private static final long POLL_MS = 1000L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private CheckBox probeBox;
    private CheckBox gadgetBox;
    private CheckBox rflBox;
    private CheckBox shadowBox;
    private CheckBox healthyBox;
    private TextView stateView;
    private Button startButton;
    private Button receiptButton;

    private Method nativeInit;
    private Method nativeSetMode;
    private Method nativeFlush;
    private Method nativeSnapshot;
    private String storePath;
    private String probeState = "PENDING";
    private String gadgetState = "PENDING";
    private String lastSnapshot = "TOKEN_VAZIO";
    private boolean polling;

    private final Runnable poll = new Runnable() {
        @Override public void run() {
            if (!polling) return;
            try {
                lastSnapshot = snapshot(true);
                long observations = metric(lastSnapshot, "observations:");
                long committed = metric(lastSnapshot, "RFL committed records:");
                long storeBytes = metric(lastSnapshot, "store bytes:");
                stateView.setText("Rodando em LEARN_SHADOW\nObservações reais: " + observations
                        + " / " + MIN_OBSERVATIONS + "\nRegistros persistidos: " + committed
                        + "\nStore: " + storeBytes + " B");

                if (observations >= MIN_OBSERVATIONS) {
                    invokeInt(nativeFlush);
                    lastSnapshot = snapshot(true);
                    committed = metric(lastSnapshot, "RFL committed records:");
                    storeBytes = metric(lastSnapshot, "store bytes:");
                    if (committed >= MIN_OBSERVATIONS && storeBytes > 64L) {
                        polling = false;
                        complete(healthyBox, "5. Evidência saudável: OK");
                        receiptButton.setEnabled(true);
                        stateView.setText("PRONTO PARA GERAR RECEIPT\n"
                                + committed + " registros reais persistidos.");
                        return;
                    }
                }
            } catch (Throwable t) {
                polling = false;
                stateView.setText("Falha ao ler métricas: " + t.getClass().getSimpleName());
                startButton.setEnabled(true);
                return;
            }
            handler.postDelayed(this, POLL_MS);
        }
    };

    private CheckBox step(String text) {
        CheckBox box = new CheckBox(this);
        box.setText(text);
        box.setEnabled(false);
        box.setChecked(false);
        return box;
    }

    private void complete(CheckBox box, String text) {
        box.setText(text);
        box.setChecked(true);
        box.setEnabled(false);
    }

    private void resetSteps() {
        CheckBox[] boxes = {probeBox, gadgetBox, rflBox, shadowBox, healthyBox};
        String[] labels = {
                "1. ELF probe", "2. Frida Gadget", "3. RFL inicializado",
                "4. LEARN_SHADOW", "5. Evidência saudável (64 registros)"};
        for (int i = 0; i < boxes.length; i++) {
            boxes[i].setChecked(false);
            boxes[i].setEnabled(false);
            boxes[i].setText(labels[i]);
        }
        receiptButton.setEnabled(false);
    }

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);

        ScrollView scroll = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(28, 28, 28, 28);
        scroll.addView(root);

        TextView title = new TextView(this);
        title.setText("RAFAELIA / FRIDA");
        title.setTextSize(22f);
        root.addView(title);

        stateView = new TextView(this);
        stateView.setText("Pronto. Aperte EXECUTAR.");
        stateView.setTextSize(16f);
        root.addView(stateView);

        probeBox = step("1. ELF probe");
        gadgetBox = step("2. Frida Gadget");
        rflBox = step("3. RFL inicializado");
        shadowBox = step("4. LEARN_SHADOW");
        healthyBox = step("5. Evidência saudável (64 registros)");
        root.addView(probeBox);
        root.addView(gadgetBox);
        root.addView(rflBox);
        root.addView(shadowBox);
        root.addView(healthyBox);

        startButton = new Button(this);
        startButton.setText("EXECUTAR");
        startButton.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { startFlow(); }
        });
        root.addView(startButton);

        receiptButton = new Button(this);
        receiptButton.setText("GERAR + COPIAR RECEIPT");
        receiptButton.setEnabled(false);
        receiptButton.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { generateReceipt(); }
        });
        root.addView(receiptButton);

        Button details = new Button(this);
        details.setText("Detalhes técnicos");
        details.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                startActivity(new Intent(OneClickActivity.this, MainActivity.class));
            }
        });
        root.addView(details);

        setContentView(scroll);
    }

    private void bindNative() throws Exception {
        Class<?> cls = Class.forName("io.rafaelia.fridalab.MainActivity");
        nativeInit = cls.getDeclaredMethod("nativeLearningInit", String.class);
        nativeSetMode = cls.getDeclaredMethod("nativeLearningSetMode", int.class);
        nativeFlush = cls.getDeclaredMethod("nativeLearningFlush");
        nativeSnapshot = cls.getDeclaredMethod("nativeLearningSnapshot", boolean.class);
        nativeInit.setAccessible(true);
        nativeSetMode.setAccessible(true);
        nativeFlush.setAccessible(true);
        nativeSnapshot.setAccessible(true);
    }

    private void startFlow() {
        polling = false;
        handler.removeCallbacks(poll);
        resetSteps();
        startButton.setEnabled(false);
        stateView.setText("Iniciando...");

        try {
            System.loadLibrary("rafaelia-probe");
            probeState = "LOADED";
            complete(probeBox, "1. ELF probe: OK");
        } catch (Throwable t) {
            probeState = "FAILED: " + t.getClass().getSimpleName();
            fail("ELF probe falhou");
            return;
        }

        try {
            System.loadLibrary("frida-gadget");
            gadgetState = "LOADED";
            complete(gadgetBox, "2. Frida Gadget: OK");
        } catch (Throwable t) {
            gadgetState = "FAILED: " + t.getClass().getSimpleName();
            fail("Frida Gadget falhou");
            return;
        }

        try {
            bindNative();
            storePath = new File(getFilesDir(), "frida-learning-v1.rfl").getAbsolutePath();
            int initRc = ((Integer) nativeInit.invoke(null, storePath)).intValue();
            if (initRc != 0) {
                fail("RFL init rc=" + initRc);
                return;
            }
            complete(rflBox, "3. RFL inicializado: OK");

            int modeRc = ((Integer) nativeSetMode.invoke(null, LEARN_SHADOW)).intValue();
            if (modeRc != 0) {
                fail("LEARN_SHADOW rc=" + modeRc);
                return;
            }
            complete(shadowBox, "4. LEARN_SHADOW: RODANDO");
            stateView.setText("Rodando. Aguardando observações reais...");
            polling = true;
            handler.post(poll);
        } catch (Throwable t) {
            fail("Orquestração falhou: " + t.getClass().getSimpleName());
        }
    }

    private int invokeInt(Method method) throws Exception {
        return ((Integer) method.invoke(null)).intValue();
    }

    private String snapshot(boolean verbose) throws Exception {
        return String.valueOf(nativeSnapshot.invoke(null, Boolean.valueOf(verbose)));
    }

    private long metric(String text, String key) {
        int p = text.indexOf(key);
        if (p < 0) return -1L;
        p += key.length();
        while (p < text.length() && Character.isWhitespace(text.charAt(p))) p++;
        long value = 0L;
        boolean found = false;
        while (p < text.length()) {
            char c = text.charAt(p);
            if (c < '0' || c > '9') break;
            found = true;
            value = value * 10L + (c - '0');
            p++;
        }
        return found ? value : -1L;
    }

    private String primaryAbi() {
        return Build.VERSION.SDK_INT >= 21 && Build.SUPPORTED_ABIS.length > 0
                ? Build.SUPPORTED_ABIS[0] : "TOKEN_VAZIO";
    }

    private boolean isDebuggable() {
        return (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    private void generateReceipt() {
        try {
            invokeInt(nativeFlush);
            lastSnapshot = snapshot(true);
            String receipt = "RAFAELIA_FRIDA_LAB_RECEIPT_V1\n"
                    + "diagnostic_state=PASS\n"
                    + "pid=" + Process.myPid() + "\n"
                    + "package=" + getPackageName() + "\n"
                    + "sdk=" + Build.VERSION.SDK_INT + "\n"
                    + "android=" + Build.VERSION.RELEASE + "\n"
                    + "abi=" + primaryAbi() + "\n"
                    + "debuggable=" + isDebuggable() + "\n"
                    + "gadget_endpoint=127.0.0.1:27042\n"
                    + "probe=Source-built ELF probe: " + probeState + "\n"
                    + "gadget=Frida Gadget ELF: " + gadgetState + "\n"
                    + "learning_mode=LEARN_SHADOW — aprender sem agir\n"
                    + "store=" + storePath + "\n"
                    + "automatic_active=DISABLED\n"
                    + "claim_allowed=false\n"
                    + "--- METRICS ---\n" + lastSnapshot + "\n";

            File dir = getExternalFilesDir(null);
            if (dir == null) dir = getFilesDir();
            File out = new File(dir, "RAFAELIA_FRIDA_LAB_RECEIPT_V1_" + System.currentTimeMillis() + ".txt");
            FileOutputStream stream = new FileOutputStream(out);
            stream.write(receipt.getBytes("UTF-8"));
            stream.flush();
            stream.close();

            ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            clipboard.setPrimaryClip(ClipData.newPlainText("RAFAELIA Frida receipt", receipt));
            stateView.setText("RECEIPT GERADO E COPIADO\n" + out.getAbsolutePath());
            Toast.makeText(this, "Receipt copiado", Toast.LENGTH_SHORT).show();
        } catch (Throwable t) {
            stateView.setText("Falha ao gerar receipt: " + t.getClass().getSimpleName());
        }
    }

    private void fail(String message) {
        polling = false;
        handler.removeCallbacks(poll);
        stateView.setText(message);
        startButton.setEnabled(true);
        receiptButton.setEnabled(false);
    }

    @Override protected void onDestroy() {
        polling = false;
        handler.removeCallbacks(poll);
        super.onDestroy();
    }
}

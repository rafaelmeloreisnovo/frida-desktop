package io.rafaelia.fridalab;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.Process;
import android.provider.Settings;
import android.util.Log;
import android.view.View;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.CompoundButton;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;

public final class MainActivity extends Activity {
    private static final String TAG = "RAFAELIA-FridaLab";
    private static final String PREFS = "frida_lab_prefs";
    private static final String PREF_DEVELOPER = "developer_mode";
    private static final String PREF_VERBOSE = "verbose_mode";
    private static final String PREF_LEARNING_MODE = "learning_mode";
    private static final String ENDPOINT = "127.0.0.1:27042";

    private static final int LEARNING_OFF = 0;
    private static final int LEARNING_OBSERVE = 1;
    private static final int LEARNING_LEARN_SHADOW = 2;
    private static final int LEARNING_PREDICT_SHADOW = 3;
    private static final int LEARNING_VALIDATE_SHADOW = 4;
    private static final int LEARNING_FROZEN = 5;

    private static final String[] LEARNING_MODE_LABELS = new String[] {
            "OFF — sem gravação",
            "OBSERVE — medir e gravar",
            "LEARN_SHADOW — aprender sem agir",
            "PREDICT_SHADOW — prever e continuar aprendendo",
            "VALIDATE_SHADOW — modelo congelado + dados novos",
            "FROZEN — somente leitura"
    };

    private static native int nativeLearningInit(String path);
    private static native int nativeLearningSetMode(int mode);
    private static native int nativeLearningFlush();
    private static native int nativeLearningResetVolatile();
    private static native String nativeLearningSnapshot(boolean verbose);

    /*
     * Public bridge for Frida JavaScript. Instrumentation agents can call this
     * without creating a Java-side model or database object per event.
     */
    public static native int learningObserve(
            long contextHash,
            int candidateId,
            int eventType,
            long costNs,
            long memoryDelta,
            long auxHash);

    private boolean developerMode;
    private boolean verboseMode;
    private boolean learningInitialized;
    private boolean changingLearningMode;
    private int learningMode;
    private int learningInitRc;
    private String learningStorePath;
    private String probeStatus;
    private String gadgetStatus;
    private TextView statusView;
    private TextView learningStatusView;
    private CheckBox developerCheck;
    private CheckBox verboseCheck;
    private LinearLayout learningPanel;
    private Spinner learningModeSpinner;

    private String loadElf(String library, String label) {
        try {
            System.loadLibrary(library);
            String result = label + ": LOADED";
            Log.i(TAG, result);
            return result;
        } catch (Throwable t) {
            String result = label + ": FAILED — " + t.getClass().getSimpleName() + ": "
                    + String.valueOf(t.getMessage());
            Log.e(TAG, result, t);
            return result;
        }
    }

    private String primaryAbi() {
        if (Build.VERSION.SDK_INT >= 21 && Build.SUPPORTED_ABIS.length > 0) {
            return Build.SUPPORTED_ABIS[0];
        }
        return "TOKEN_VAZIO";
    }

    private String supportedAbis() {
        if (Build.VERSION.SDK_INT >= 21 && Build.SUPPORTED_ABIS.length > 0) {
            StringBuilder result = new StringBuilder();
            for (int i = 0; i < Build.SUPPORTED_ABIS.length; i++) {
                if (i != 0) result.append(", ");
                result.append(Build.SUPPORTED_ABIS[i]);
            }
            return result.toString();
        }
        return "TOKEN_VAZIO";
    }

    private boolean isDebuggable() {
        return (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    private String hostCommands() {
        return "adb devices\n"
                + "adb forward tcp:27042 tcp:27042\n"
                + "frida-ps -H 127.0.0.1:27042\n"
                + "frida -H 127.0.0.1:27042 -n Gadget";
    }

    private String learningAgentSnippet() {
        return "Java.perform(function () {\n"
                + "  const Lab = Java.use('io.rafaelia.fridalab.MainActivity');\n"
                + "  // Pass only real observations from your hook:\n"
                + "  // Lab.learningObserve(contextHash, actualCandidate, eventType, costNs, memoryDelta, auxHash);\n"
                + "  // Candidate may represent a class or route (CPU scalar / NEON / GPU / storage).\n"
                + "  // VALIDATE_SHADOW predicts with the frozen model and never trains it.\n"
                + "});";
    }

    private void verbose(String message) {
        if (verboseMode) Log.v(TAG, message);
    }

    private String safeLearningSnapshot(boolean verbose) {
        if (!learningInitialized) {
            return "Learning core: NOT_INITIALIZED rc=" + learningInitRc;
        }
        try {
            return nativeLearningSnapshot(verbose);
        } catch (Throwable t) {
            Log.e(TAG, "Learning snapshot failed", t);
            return "Learning core: FAILED — " + t.getClass().getSimpleName() + ": "
                    + String.valueOf(t.getMessage());
        }
    }

    private void renderLearningStatus() {
        if (learningStatusView == null) return;
        StringBuilder text = new StringBuilder();
        text.append("\nLEARNING / RFL V1 + NEON4096/3\n");
        text.append(safeLearningSnapshot(verboseMode)).append("\n");
        text.append("Store: ").append(learningStorePath == null ? "TOKEN_VAZIO" : learningStorePath).append("\n");
        text.append("VALIDATE_SHADOW: modelo congelado; janela de validação não altera suporte aprendido.\n");
        text.append("Validation persistence: TOKEN_VAZIO (janela atual é volátil).\n");
        text.append("ZIPRAF checkpoint + segment GC/compaction: TOKEN_VAZIO / próxima fase.\n");
        text.append("GPU compute backend: TOKEN_VAZIO até execução física medida.\n");
        text.append("Automatic ACTIVE policy: DISABLED\n");
        text.append("Promotion gate: support + error + confidence + overhead + memory + validation window\n");
        if (verboseMode) {
            text.append("\nFrida bridge example:\n").append(learningAgentSnippet()).append("\n");
            text.append("\nNative geometry: 4096 B = 64 B control + 3 x 1344 B; 64 cache-lines; 256 NEON vectors.\n");
            text.append("RFL hot path: fixed native predictor + 4 KiB record slab; no Java DB object per observation.\n");
        }
        learningStatusView.setText(text.toString());
    }

    private void renderStatus() {
        StringBuilder status = new StringBuilder();
        status.append("RAFAELIA / Frida Android Lab\n\n");

        if (!developerMode) {
            status.append(probeStatus).append("\n");
            status.append(gadgetStatus).append("\n\n");
            status.append("Endpoint: ").append(ENDPOINT).append("\n");
            status.append("Próximo passo: conecte pelo ADB/Frida no computador.\n");
            status.append("Ative Developer Mode abaixo para diagnóstico e Learning.\n");
        } else {
            status.append("DEVELOPER MODE: ON\n");
            status.append("Verbose: ").append(verboseMode ? "ON" : "OFF").append("\n\n");
            status.append(probeStatus).append("\n");
            status.append(gadgetStatus).append("\n");
            status.append("PID: ").append(Process.myPid()).append("\n");
            status.append("Package: ").append(getPackageName()).append("\n");
            status.append("SDK: ").append(Build.VERSION.SDK_INT).append("\n");
            status.append("Android: ").append(Build.VERSION.RELEASE).append("\n");
            status.append("Primary ABI: ").append(primaryAbi()).append("\n");
            status.append("Debuggable APK: ").append(isDebuggable()).append("\n");
            status.append("Gadget endpoint: ").append(ENDPOINT).append("\n");

            if (verboseMode) {
                status.append("\n--- VERBOSE ---\n");
                status.append("Supported ABIs: ").append(supportedAbis()).append("\n");
                status.append("Device: ").append(Build.MANUFACTURER).append(" ")
                        .append(Build.MODEL).append("\n");
                status.append("Build fingerprint: ").append(Build.FINGERPRINT).append("\n");
                status.append("C source -> NDK clang -> ELF -> RFL/NEON4096 runtime\n");
                status.append("Java source -> javac -> D8 -> DEX -> Activity -> System.loadLibrary -> ELF\n");
                status.append("\nHost commands:\n").append(hostCommands()).append("\n");
                status.append("\nSystem Developer Options status is not inferred by this app; use the button below to open the Android settings page.\n");
            }
        }

        statusView.setText(status.toString());
        if (learningPanel != null) learningPanel.setVisibility(developerMode ? View.VISIBLE : View.GONE);
        renderLearningStatus();
        verbose("renderStatus developer=" + developerMode + " verbose=" + verboseMode
                + " pid=" + Process.myPid() + " abi=" + primaryAbi()
                + " learningMode=" + learningMode);
    }

    private void saveModes() {
        getSharedPreferences(PREFS, MODE_PRIVATE)
                .edit()
                .putBoolean(PREF_DEVELOPER, developerMode)
                .putBoolean(PREF_VERBOSE, verboseMode)
                .putInt(PREF_LEARNING_MODE, learningMode)
                .apply();
    }

    private Button button(String text, View.OnClickListener listener) {
        Button button = new Button(this);
        button.setText(text);
        button.setOnClickListener(listener);
        return button;
    }

    private void openDeveloperOptions() {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS);
        try {
            startActivity(intent);
        } catch (ActivityNotFoundException e) {
            startActivity(new Intent(Settings.ACTION_SETTINGS));
        }
    }

    private void copyHostCommands() {
        ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        clipboard.setPrimaryClip(ClipData.newPlainText(
                "Frida host + learning commands",
                hostCommands() + "\n\n" + learningAgentSnippet()));
        Toast.makeText(this, "Comandos ADB/Frida/Learning copiados", Toast.LENGTH_SHORT).show();
    }

    private void initializeLearning() {
        learningStorePath = new File(getFilesDir(), "frida-learning-v1.rfl").getAbsolutePath();
        try {
            learningInitRc = nativeLearningInit(learningStorePath);
            learningInitialized = learningInitRc == 0;
            if (learningInitialized) {
                int rc = nativeLearningSetMode(learningMode);
                if (rc != 0) {
                    Log.e(TAG, "Could not restore learning mode rc=" + rc);
                    learningMode = LEARNING_OFF;
                    nativeLearningSetMode(LEARNING_OFF);
                }
            }
        } catch (Throwable t) {
            learningInitialized = false;
            learningInitRc = Integer.MIN_VALUE;
            Log.e(TAG, "Learning initialization failed", t);
        }
    }

    private void setLearningMode(int requestedMode, boolean fromUser) {
        if (requestedMode < LEARNING_OFF || requestedMode > LEARNING_FROZEN) return;
        if (!learningInitialized) {
            if (fromUser) Toast.makeText(this, "Learning core não inicializado", Toast.LENGTH_SHORT).show();
            return;
        }
        try {
            int rc = nativeLearningSetMode(requestedMode);
            if (rc == 0) {
                learningMode = requestedMode;
                saveModes();
                if (fromUser) {
                    Toast.makeText(this, "Learning: " + LEARNING_MODE_LABELS[requestedMode], Toast.LENGTH_SHORT).show();
                }
            } else {
                Toast.makeText(this, "Falha ao mudar Learning rc=" + rc, Toast.LENGTH_LONG).show();
                changingLearningMode = true;
                learningModeSpinner.setSelection(learningMode);
                changingLearningMode = false;
            }
        } catch (Throwable t) {
            Log.e(TAG, "Learning mode change failed", t);
            Toast.makeText(this, "Learning mode falhou: " + t.getClass().getSimpleName(), Toast.LENGTH_LONG).show();
        }
        renderLearningStatus();
    }

    private void flushLearning() {
        if (!learningInitialized) return;
        try {
            int rc = nativeLearningFlush();
            Toast.makeText(this, rc == 0 ? "RFL flush: PASS" : "RFL flush rc=" + rc,
                    Toast.LENGTH_SHORT).show();
        } catch (Throwable t) {
            Log.e(TAG, "Learning flush failed", t);
            Toast.makeText(this, "RFL flush falhou", Toast.LENGTH_LONG).show();
        }
        renderLearningStatus();
    }

    private void resetVolatilePredictor() {
        if (!learningInitialized) return;
        if (learningMode != LEARNING_OFF && learningMode != LEARNING_FROZEN) {
            Toast.makeText(this, "Coloque Learning em OFF ou FROZEN antes do reset", Toast.LENGTH_LONG).show();
            return;
        }
        try {
            int rc = nativeLearningResetVolatile();
            Toast.makeText(this, rc == 0 ? "Preditor volátil resetado" : "Reset rc=" + rc,
                    Toast.LENGTH_SHORT).show();
        } catch (Throwable t) {
            Log.e(TAG, "Learning reset failed", t);
            Toast.makeText(this, "Reset falhou", Toast.LENGTH_LONG).show();
        }
        renderLearningStatus();
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        developerMode = prefs.getBoolean(PREF_DEVELOPER, false);
        verboseMode = prefs.getBoolean(PREF_VERBOSE, false);
        learningMode = prefs.getInt(PREF_LEARNING_MODE, LEARNING_OFF);
        if (learningMode < LEARNING_OFF || learningMode > LEARNING_FROZEN) learningMode = LEARNING_OFF;

        probeStatus = loadElf("rafaelia-probe", "Source-built ELF probe");
        gadgetStatus = loadElf("frida-gadget", "Frida Gadget ELF");
        initializeLearning();

        ScrollView scroll = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = 28;
        root.setPadding(pad, pad, pad, pad);
        scroll.addView(root);

        statusView = new TextView(this);
        statusView.setTextSize(16.0f);
        statusView.setTextIsSelectable(true);
        root.addView(statusView);

        developerCheck = new CheckBox(this);
        developerCheck.setText("Developer Mode do laboratório");
        developerCheck.setChecked(developerMode);
        root.addView(developerCheck);

        verboseCheck = new CheckBox(this);
        verboseCheck.setText("Verbose diagnostics");
        verboseCheck.setChecked(verboseMode);
        verboseCheck.setEnabled(developerMode);
        root.addView(verboseCheck);

        learningPanel = new LinearLayout(this);
        learningPanel.setOrientation(LinearLayout.VERTICAL);
        root.addView(learningPanel);

        TextView learningTitle = new TextView(this);
        learningTitle.setText("Learning / RFL + NEON4096 — shadow / validation");
        learningTitle.setTextSize(18.0f);
        learningPanel.addView(learningTitle);

        learningModeSpinner = new Spinner(this);
        ArrayAdapter<String> learningAdapter = new ArrayAdapter<String>(
                this,
                android.R.layout.simple_spinner_item,
                LEARNING_MODE_LABELS);
        learningAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        learningModeSpinner.setAdapter(learningAdapter);
        learningModeSpinner.setSelection(learningMode);
        learningPanel.addView(learningModeSpinner);

        learningStatusView = new TextView(this);
        learningStatusView.setTextSize(14.0f);
        learningStatusView.setTextIsSelectable(true);
        learningPanel.addView(learningStatusView);

        learningPanel.addView(button("Atualizar métricas do Learning", new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                renderLearningStatus();
            }
        }));

        learningPanel.addView(button("Flush RFL agora", new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                flushLearning();
            }
        }));

        learningPanel.addView(button("Resetar preditor volátil", new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                resetVolatilePredictor();
            }
        }));

        TextView phase2 = new TextView(this);
        phase2.setText("Próxima etapa: persistir janela VALIDATE + ZIPRAF checkpoint + segment GC/compaction + backend GPU físico medido.");
        learningPanel.addView(phase2);

        learningModeSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                if (changingLearningMode || position == learningMode) return;
                setLearningMode(position, true);
            }

            @Override
            public void onNothingSelected(AdapterView<?> parent) {
            }
        });

        developerCheck.setOnCheckedChangeListener(new CompoundButton.OnCheckedChangeListener() {
            @Override
            public void onCheckedChanged(CompoundButton buttonView, boolean checked) {
                developerMode = checked;
                if (!developerMode) {
                    verboseMode = false;
                    verboseCheck.setChecked(false);
                }
                verboseCheck.setEnabled(developerMode);
                saveModes();
                renderStatus();
            }
        });

        verboseCheck.setOnCheckedChangeListener(new CompoundButton.OnCheckedChangeListener() {
            @Override
            public void onCheckedChanged(CompoundButton buttonView, boolean checked) {
                verboseMode = developerMode && checked;
                saveModes();
                renderStatus();
            }
        });

        root.addView(button("Executar / atualizar diagnóstico", new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                renderStatus();
                Toast.makeText(MainActivity.this, "Diagnóstico atualizado", Toast.LENGTH_SHORT).show();
            }
        }));

        root.addView(button("Abrir Opções do desenvolvedor do Android", new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                openDeveloperOptions();
            }
        }));

        root.addView(button("Copiar comandos ADB / Frida / Learning", new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                copyHostCommands();
            }
        }));

        renderStatus();
        setContentView(scroll);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (learningInitialized && learningMode != LEARNING_OFF) {
            try {
                nativeLearningFlush();
            } catch (Throwable t) {
                Log.e(TAG, "Learning flush onPause failed", t);
            }
        }
    }
}

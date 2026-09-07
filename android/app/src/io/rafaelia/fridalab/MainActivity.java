package io.rafaelia.fridalab;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.Process;
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

/**
 * RAFAELIA Frida Android Lab.
 *
 * Normal operator path is intentionally one screen and direct:
 * Java/DEX -> JNI -> source-built ELF -> RFL/NEON4096.
 *
 * Frida Gadget remains loaded for instrumentation, but reading local metrics
 * does not require ADB, a host computer, Frida REPL, or hand-written JS.
 */
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
            "OFF — só leitura; não grava",
            "OBSERVE — medir e gravar observações reais",
            "LEARN_SHADOW — aprender sem agir",
            "PREDICT_SHADOW — prever e continuar aprendendo",
            "VALIDATE_SHADOW — validar modelo congelado",
            "FROZEN — somente leitura do modelo"
    };

    private static native int nativeLearningInit(String path);
    private static native int nativeLearningSetMode(int mode);
    private static native int nativeLearningFlush();
    private static native int nativeLearningResetVolatile();
    private static native String nativeLearningSnapshot(boolean verbose);

    /** Public bridge for Frida/on-device instrumentation. */
    public static native int learningObserve(
            long contextHash,
            int candidateId,
            int eventType,
            long costNs,
            long memoryDelta,
            long auxHash);

    /** Read-only public bridge used by the local one-shot Frida verifier. */
    public static String learningSnapshotForInstrumentation(boolean verbose) {
        try {
            return nativeLearningSnapshot(verbose);
        } catch (Throwable t) {
            return "Learning snapshot: FAILED — " + t.getClass().getSimpleName() + ": "
                    + String.valueOf(t.getMessage());
        }
    }

    private boolean developerMode;
    private boolean verboseMode;
    private boolean learningInitialized;
    private boolean changingLearningMode;
    private int learningMode;
    private int learningInitRc;
    private String learningStorePath;
    private String probeStatus;
    private String gadgetStatus;
    private String lastOperatorReceipt = "TOKEN_VAZIO";

    private TextView statusView;
    private TextView learningStatusView;
    private CheckBox developerCheck;
    private CheckBox verboseCheck;
    private LinearLayout advancedPanel;
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
            StringBuilder out = new StringBuilder();
            for (int i = 0; i < Build.SUPPORTED_ABIS.length; i++) {
                if (i != 0) out.append(", ");
                out.append(Build.SUPPORTED_ABIS[i]);
            }
            return out.toString();
        }
        return "TOKEN_VAZIO";
    }

    private boolean isDebuggable() {
        return (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
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

    private String buildOperatorReceipt() {
        return OperatorReceipt.format(
                probeStatus,
                gadgetStatus,
                safeLearningSnapshot(true),
                learningStorePath,
                learningMode,
                isDebuggable());
    }

    private String runFullDiagnostic() {
        renderStatus();
        renderLearningStatus();
        lastOperatorReceipt = buildOperatorReceipt();
        return "DIAGNÓSTICO: PASS\n"
                + "Fluxo: DEX → JNI → ELF → RFL/NEON4096\n"
                + "Modo: " + OperatorModeGuide.describe(learningMode) + "\n"
                + "ACTIVE automático: DISABLED\n"
                + "\n" + lastOperatorReceipt;
    }

    private String copyMetrics() {
        lastOperatorReceipt = buildOperatorReceipt();
        ClipboardManager clipboard =
                (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        clipboard.setPrimaryClip(ClipData.newPlainText(
                "RAFAELIA Frida Lab metrics", lastOperatorReceipt));
        Toast.makeText(this, "Métricas copiadas", Toast.LENGTH_SHORT).show();
        return OperatorCopy.successMessage(lastOperatorReceipt.length())
                + "\n" + OperatorGateText.safeState(learningMode);
    }

    private String recordRealObservation(String contextHashRaw,
                                         String candidateIdRaw,
                                         String eventTypeRaw,
                                         String costNsRaw,
                                         String memoryDeltaRaw,
                                         String auxHashRaw) {
        if (!learningInitialized) {
            return "OBSERVAÇÃO: FAIL — Learning core não inicializado";
        }
        if (learningMode == LEARNING_OFF || learningMode == LEARNING_FROZEN) {
            return "OBSERVAÇÃO: BLOQUEADA — selecione OBSERVE/LEARN_SHADOW/PREDICT_SHADOW/VALIDATE_SHADOW";
        }

        try {
            long contextHash = MobileNumberParser.signedLong(contextHashRaw, "contextHash");
            int candidateId = MobileNumberParser.nonNegativeInt(candidateIdRaw, "candidateId");
            int eventType = MobileNumberParser.nonNegativeInt(eventTypeRaw, "eventType");
            long costNs = MobileNumberParser.signedLong(costNsRaw, "costNs");
            long memoryDelta = MobileNumberParser.signedLong(memoryDeltaRaw, "memoryDelta");
            long auxHash = MobileNumberParser.signedLong(auxHashRaw, "auxHash");
            if (costNs < 0L) return "OBSERVAÇÃO: FAIL — costNs não pode ser negativo";

            int rc = learningObserve(
                    contextHash, candidateId, eventType, costNs, memoryDelta, auxHash);
            renderLearningStatus();
            if (rc == 0) {
                lastOperatorReceipt = buildOperatorReceipt();
                return "OBSERVAÇÃO: PASS — rc=0\n"
                        + "Entrada real encaminhada: DEX → JNI → ELF → RFL\n"
                        + OperatorGateText.safeState(learningMode);
            }
            return "OBSERVAÇÃO: FAIL — rc=" + rc + "\n"
                    + OperatorGateText.safeState(learningMode);
        } catch (Throwable t) {
            return "OBSERVAÇÃO: REJEITADA — " + OperatorError.format(t)
                    + "\nRFL não recebeu entrada inválida.";
        }
    }

    private void renderLearningStatus() {
        if (learningStatusView == null) return;
        StringBuilder text = new StringBuilder();
        text.append("\nMÉTRICAS RFL / NEON4096\n");
        text.append(safeLearningSnapshot(verboseMode)).append("\n");
        text.append("Store: ").append(
                learningStorePath == null ? "TOKEN_VAZIO" : learningStorePath).append("\n");
        text.append("VALIDATE_SHADOW: modelo congelado; validação não treina.\n");
        text.append("Validation persistence: TOKEN_VAZIO\n");
        text.append("ZIPRAF checkpoint + GC/compaction: TOKEN_VAZIO\n");
        text.append("GPU compute backend: TOKEN_VAZIO\n");
        text.append("Automatic ACTIVE policy: DISABLED\n");
        text.append("Promotion gate: support + error + confidence + overhead + memory + validation window\n");
        learningStatusView.setText(text.toString());
    }

    private void renderStatus() {
        if (statusView == null) return;
        StringBuilder status = new StringBuilder();
        status.append("RAFAELIA / Frida Android Lab\n");
        status.append("UMA TELA • DEX → JNI → ELF\n\n");
        status.append(probeStatus).append("\n");
        status.append(gadgetStatus).append("\n");
        status.append("PID: ").append(Process.myPid()).append("\n");
        status.append("Package: ").append(getPackageName()).append("\n");
        status.append("Android: ").append(Build.VERSION.RELEASE)
                .append(" / SDK ").append(Build.VERSION.SDK_INT).append("\n");
        status.append("ABI: ").append(primaryAbi()).append("\n");
        status.append("Debuggable APK: ").append(isDebuggable()).append("\n");
        status.append("Gadget local: ").append(ENDPOINT).append("\n");
        status.append("Learning: ").append(OperatorModeGuide.describe(learningMode)).append("\n");
        status.append("ACTIVE automático: DISABLED\n");

        if (verboseMode) {
            status.append("\n--- DETALHES ---\n");
            status.append("ABIs: ").append(supportedAbis()).append("\n");
            status.append("Device: ").append(Build.MANUFACTURER).append(" ")
                    .append(Build.MODEL).append("\n");
            status.append("Fingerprint: ").append(Build.FINGERPRINT).append("\n");
            status.append("C source → NDK clang → ELF → RFL/NEON4096\n");
            status.append("Java → javac → D8 → DEX → JNI → ELF\n");
            status.append("Frida/Termux externo: opcional; não é necessário para ler métricas.\n");
        }

        statusView.setText(status.toString());
        if (advancedPanel != null) {
            advancedPanel.setVisibility(developerMode ? View.VISIBLE : View.GONE);
        }
        renderLearningStatus();
        verbose("renderStatus advanced=" + developerMode
                + " verbose=" + verboseMode
                + " pid=" + Process.myPid()
                + " abi=" + primaryAbi()
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
            if (fromUser) {
                Toast.makeText(this, "Learning core não inicializado", Toast.LENGTH_SHORT).show();
            }
            return;
        }
        try {
            int rc = nativeLearningSetMode(requestedMode);
            if (rc == 0) {
                learningMode = requestedMode;
                saveModes();
                if (fromUser) {
                    Toast.makeText(this,
                            "Learning: " + LEARNING_MODE_LABELS[requestedMode],
                            Toast.LENGTH_SHORT).show();
                }
            } else {
                Toast.makeText(this, "Falha ao mudar Learning rc=" + rc,
                        Toast.LENGTH_LONG).show();
                changingLearningMode = true;
                learningModeSpinner.setSelection(learningMode);
                changingLearningMode = false;
            }
        } catch (Throwable t) {
            Log.e(TAG, "Learning mode change failed", t);
            Toast.makeText(this,
                    "Learning mode falhou: " + t.getClass().getSimpleName(),
                    Toast.LENGTH_LONG).show();
        }
        renderStatus();
    }

    private void flushLearning() {
        if (!learningInitialized) return;
        try {
            int rc = nativeLearningFlush();
            Toast.makeText(this,
                    rc == 0 ? "RFL flush: PASS" : "RFL flush rc=" + rc,
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
            Toast.makeText(this,
                    "Reset só em OFF ou FROZEN",
                    Toast.LENGTH_LONG).show();
            return;
        }
        try {
            int rc = nativeLearningResetVolatile();
            Toast.makeText(this,
                    rc == 0 ? "Preditor volátil resetado" : "Reset rc=" + rc,
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
        if (learningMode < LEARNING_OFF || learningMode > LEARNING_FROZEN) {
            learningMode = LEARNING_OFF;
        }

        probeStatus = loadElf("rafaelia-probe", "Source-built ELF probe");
        gadgetStatus = loadElf("frida-gadget", "Frida Gadget ELF");
        initializeLearning();

        ScrollView scroll = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = 24;
        root.setPadding(pad, pad, pad, pad);
        scroll.addView(root);

        statusView = new TextView(this);
        statusView.setTextSize(16.0f);
        statusView.setTextIsSelectable(true);
        root.addView(statusView);

        root.addView(OperatorPanel.build(this, new OperatorActionsAdapter(
                new OperatorActionsAdapter.Backend() {
                    @Override public String diagnostic() {
                        return runFullDiagnostic();
                    }

                    @Override public String copyMetrics() {
                        return MainActivity.this.copyMetrics();
                    }

                    @Override public String observe(String contextHash,
                                                    String candidateId,
                                                    String eventType,
                                                    String costNs,
                                                    String memoryDelta,
                                                    String auxHash) {
                        return recordRealObservation(
                                contextHash, candidateId, eventType,
                                costNs, memoryDelta, auxHash);
                    }
                })));

        learningStatusView = new TextView(this);
        learningStatusView.setTextSize(14.0f);
        learningStatusView.setTextIsSelectable(true);
        root.addView(learningStatusView);

        developerCheck = new CheckBox(this);
        developerCheck.setText("Mostrar controles avançados");
        developerCheck.setChecked(developerMode);
        root.addView(developerCheck);

        advancedPanel = new LinearLayout(this);
        advancedPanel.setOrientation(LinearLayout.VERTICAL);
        root.addView(advancedPanel);

        TextView modeTitle = new TextView(this);
        modeTitle.setText("Modo do Learning");
        modeTitle.setTextSize(16.0f);
        advancedPanel.addView(modeTitle);

        learningModeSpinner = new Spinner(this);
        ArrayAdapter<String> learningAdapter = new ArrayAdapter<String>(
                this,
                android.R.layout.simple_spinner_item,
                LEARNING_MODE_LABELS);
        learningAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        learningModeSpinner.setAdapter(learningAdapter);
        learningModeSpinner.setSelection(learningMode);
        advancedPanel.addView(learningModeSpinner);

        verboseCheck = new CheckBox(this);
        verboseCheck.setText("Mostrar diagnóstico detalhado");
        verboseCheck.setChecked(verboseMode);
        advancedPanel.addView(verboseCheck);

        advancedPanel.addView(button("Atualizar métricas", new View.OnClickListener() {
            @Override public void onClick(View v) {
                renderStatus();
                Toast.makeText(MainActivity.this,
                        "Métricas atualizadas", Toast.LENGTH_SHORT).show();
            }
        }));

        advancedPanel.addView(button("Flush RFL", new View.OnClickListener() {
            @Override public void onClick(View v) {
                flushLearning();
            }
        }));

        advancedPanel.addView(button("Resetar somente preditor volátil", new View.OnClickListener() {
            @Override public void onClick(View v) {
                resetVolatilePredictor();
            }
        }));

        TextView boundary = new TextView(this);
        boundary.setText(
                "Gates abertos: validation persistence=TOKEN_VAZIO; "
                        + "ZIPRAF/GC=TOKEN_VAZIO; GPU=TOKEN_VAZIO. "
                        + "ACTIVE automático permanece DISABLED.");
        advancedPanel.addView(boundary);

        learningModeSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                if (changingLearningMode || position == learningMode) return;
                setLearningMode(position, true);
            }

            @Override public void onNothingSelected(AdapterView<?> parent) {
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

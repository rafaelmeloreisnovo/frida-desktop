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
import android.text.InputType;
import android.util.Log;
import android.view.View;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.CompoundButton;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;

/**
 * RAFAELIA Frida Android Lab — one-screen operator console.
 *
 * Normal control path:
 *   MainActivity.java -> javac -> D8/DEX -> JNI -> source-built ELF -> RFL/NEON4096
 *
 * Frida Gadget stays available at localhost for instrumentation. Reading local
 * metrics does not require ADB, a desktop host, Frida REPL, or hand-written JS.
 */
public final class MainActivity extends Activity {
    private static final String TAG = "RAFAELIA-FridaLab";
    private static final String PREFS = "frida_lab_prefs";
    private static final String PREF_ADVANCED = "developer_mode";
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

    /** Existing direct Java/DEX -> JNI -> ELF observation bridge. */
    public static native int learningObserve(
            long contextHash,
            int candidateId,
            int eventType,
            long costNs,
            long memoryDelta,
            long auxHash);

    /** Read-only bridge for optional Frida/on-device verification. */
    public static String learningSnapshotForInstrumentation(boolean verbose) {
        try {
            return nativeLearningSnapshot(verbose);
        } catch (Throwable t) {
            return "Learning snapshot: FAILED — " + formatError(t);
        }
    }

    private boolean advancedMode;
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
    private TextView operatorResultView;
    private CheckBox advancedCheck;
    private CheckBox verboseCheck;
    private LinearLayout advancedPanel;
    private Spinner learningModeSpinner;

    private static String formatError(Throwable t) {
        if (t == null) return "TOKEN_VAZIO";
        String message = t.getMessage();
        return t.getClass().getSimpleName()
                + (message == null ? "" : ": " + message);
    }

    private static String modeName(int mode) {
        if (mode >= 0 && mode < LEARNING_MODE_LABELS.length) {
            return LEARNING_MODE_LABELS[mode];
        }
        return "TOKEN_VAZIO";
    }

    private String gateText() {
        return "modo=" + modeName(learningMode)
                + " | ACTIVE automático=DISABLED"
                + " | GPU=TOKEN_VAZIO"
                + " | validation persistence=TOKEN_VAZIO";
    }

    private String loadElf(String library, String label) {
        try {
            System.loadLibrary(library);
            String result = label + ": LOADED";
            Log.i(TAG, result);
            return result;
        } catch (Throwable t) {
            String result = label + ": FAILED — " + formatError(t);
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
            return "Learning core: FAILED — " + formatError(t);
        }
    }

    private static String requiredField(String raw, String name) {
        String value = raw == null ? "" : raw.trim();
        if (value.length() == 0) {
            throw new IllegalArgumentException(name + " é obrigatório");
        }
        return value;
    }

    private static long parseLongField(String raw, String name) {
        String value = requiredField(raw, name);
        try {
            if (value.startsWith("0x") || value.startsWith("0X")) {
                return Long.parseUnsignedLong(value.substring(2), 16);
            }
            return Long.parseLong(value, 10);
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(name + " inválido");
        }
    }

    private static int parseUint32Field(String raw, String name) {
        long value = parseLongField(raw, name);
        if (value < 0L || value > 0xffffffffL) {
            throw new IllegalArgumentException(name + " fora do intervalo uint32");
        }
        return (int)value;
    }

    private String diagnosticState(String snapshot) {
        boolean probeOk = probeStatus != null && probeStatus.endsWith(": LOADED");
        boolean gadgetOk = gadgetStatus != null && gadgetStatus.endsWith(": LOADED");
        boolean learningOk = learningInitialized
                && snapshot != null
                && !snapshot.startsWith("Learning core: FAILED")
                && !snapshot.startsWith("Learning runtime: ERROR");
        boolean neonOk = snapshot != null
                && snapshot.contains("observed OS page: 4096 B (MATCH_4096)")
                && snapshot.contains("SIMD fold selftest: PASS");

        if (!probeOk || !learningOk) return "FAIL";
        if (!gadgetOk || !neonOk) return "DEGRADED";
        return "PASS";
    }

    private String buildOperatorReceipt(String snapshot, String diagnosticState) {
        StringBuilder out = new StringBuilder();
        out.append("RAFAELIA_FRIDA_LAB_RECEIPT_V1\n");
        out.append("diagnostic_state=").append(diagnosticState).append('\n');
        out.append("pid=").append(Process.myPid()).append('\n');
        out.append("package=").append(getPackageName()).append('\n');
        out.append("sdk=").append(Build.VERSION.SDK_INT).append('\n');
        out.append("android=").append(Build.VERSION.RELEASE).append('\n');
        out.append("abi=").append(primaryAbi()).append('\n');
        out.append("debuggable=").append(isDebuggable()).append('\n');
        out.append("gadget_endpoint=").append(ENDPOINT).append('\n');
        out.append("probe=").append(oneLine(probeStatus)).append('\n');
        out.append("gadget=").append(oneLine(gadgetStatus)).append('\n');
        out.append("learning_mode=").append(modeName(learningMode)).append('\n');
        out.append("store=").append(
                learningStorePath == null ? "TOKEN_VAZIO" : learningStorePath).append('\n');
        out.append("automatic_active=DISABLED\n");
        out.append("claim_allowed=false\n");
        out.append("--- METRICS ---\n");
        out.append(snapshot == null ? "TOKEN_VAZIO" : snapshot).append('\n');
        return out.toString();
    }

    private static String oneLine(String value) {
        return value == null
                ? "TOKEN_VAZIO"
                : value.replace('\n', ' ').replace('\r', ' ');
    }

    private String runFullDiagnostic() {
        renderStatus();
        renderLearningStatus();
        String snapshot = safeLearningSnapshot(true);
        String state = diagnosticState(snapshot);
        lastOperatorReceipt = buildOperatorReceipt(snapshot, state);
        return "DIAGNÓSTICO LOCAL: " + state + "\n"
                + "DEX → JNI → ELF → RFL/NEON4096\n"
                + gateText() + "\n\n"
                + lastOperatorReceipt;
    }

    private String copyMetrics() {
        String snapshot = safeLearningSnapshot(true);
        String state = diagnosticState(snapshot);
        lastOperatorReceipt = buildOperatorReceipt(snapshot, state);
        ClipboardManager clipboard =
                (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        clipboard.setPrimaryClip(ClipData.newPlainText(
                "RAFAELIA Frida Lab metrics", lastOperatorReceipt));
        Toast.makeText(this, "Métricas copiadas", Toast.LENGTH_SHORT).show();
        return "MÉTRICAS COPIADAS: " + state + "\n" + gateText();
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
            return "OBSERVAÇÃO: BLOQUEADA — abra Controles avançados e escolha um modo que aceite observações.";
        }

        try {
            long contextHash = parseLongField(contextHashRaw, "contextHash");
            int candidateId = parseUint32Field(candidateIdRaw, "candidateId");
            int eventType = parseUint32Field(eventTypeRaw, "eventType");
            long costNs = parseLongField(costNsRaw, "costNs");
            long memoryDelta = parseLongField(memoryDeltaRaw, "memoryDelta");
            long auxHash = parseLongField(auxHashRaw, "auxHash");
            if (costNs < 0L) {
                return "OBSERVAÇÃO: REJEITADA — costNs não pode ser negativo. RFL inalterado.";
            }

            int rc = learningObserve(
                    contextHash, candidateId, eventType, costNs, memoryDelta, auxHash);
            renderLearningStatus();
            if (rc == 0) {
                return "OBSERVAÇÃO: PASS — DEX → JNI → ELF → RFL\n" + gateText();
            }
            return "OBSERVAÇÃO: FAIL — rc=" + rc + "\n" + gateText();
        } catch (Throwable t) {
            return "OBSERVAÇÃO: REJEITADA — " + formatError(t)
                    + "\nEntrada inválida não foi encaminhada ao RFL.";
        }
    }

    private View buildOperatorPanel() {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);

        TextView title = new TextView(this);
        title.setText("Painel rápido — DEX → JNI → ELF");
        title.setTextSize(18.0f);
        panel.addView(title);

        TextView help = new TextView(this);
        help.setText("Uso normal: toque em Diagnóstico completo. As métricas aparecem aqui. Copiar métricas gera um receipt em um toque.");
        panel.addView(help);

        operatorResultView = new TextView(this);
        operatorResultView.setTextIsSelectable(true);
        operatorResultView.setText("Pronto para diagnosticar.");
        panel.addView(operatorResultView);

        panel.addView(button("Executar diagnóstico completo", new View.OnClickListener() {
            @Override public void onClick(View v) {
                operatorResultView.setText(runFullDiagnostic());
            }
        }));

        panel.addView(button("Copiar métricas", new View.OnClickListener() {
            @Override public void onClick(View v) {
                operatorResultView.setText(copyMetrics());
            }
        }));

        TextView observationTitle = new TextView(this);
        observationTitle.setText("Observação real — opcional");
        observationTitle.setTextSize(16.0f);
        panel.addView(observationTitle);

        TextView observationHelp = new TextView(this);
        observationHelp.setText(
                "Uma linha: contextHash, candidateId, eventType, costNs, memoryDelta, auxHash. "
                        + "Decimal ou 0x para hashes. Nada é preenchido automaticamente.");
        panel.addView(observationHelp);

        final EditText observation = new EditText(this);
        observation.setHint("0xcontext, candidate, event, costNs, memoryDelta, 0xaux");
        observation.setSingleLine(true);
        observation.setInputType(
                InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        panel.addView(observation);

        panel.addView(button("Registrar observação real", new View.OnClickListener() {
            @Override public void onClick(View v) {
                String[] fields = observation.getText().toString().split(",", -1);
                if (fields.length != 6) {
                    operatorResultView.setText(
                            "OBSERVAÇÃO: REJEITADA — use exatamente 6 campos separados por vírgula. RFL inalterado.");
                    return;
                }
                operatorResultView.setText(recordRealObservation(
                        fields[0].trim(), fields[1].trim(), fields[2].trim(),
                        fields[3].trim(), fields[4].trim(), fields[5].trim()));
            }
        }));

        TextView safety = new TextView(this);
        safety.setText(
                "Fail-safe: sem dado sintético; entrada inválida não toca no RFL; "
                        + "OFF/FROZEN bloqueiam gravação; ACTIVE automático segue DISABLED.");
        panel.addView(safety);

        return panel;
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
        status.append("Learning: ").append(modeName(learningMode)).append("\n");
        status.append("ACTIVE automático: DISABLED\n");

        if (verboseMode) {
            status.append("\n--- DETALHES ---\n");
            status.append("ABIs: ").append(supportedAbis()).append("\n");
            status.append("Device: ").append(Build.MANUFACTURER).append(" ")
                    .append(Build.MODEL).append("\n");
            status.append("Fingerprint: ").append(Build.FINGERPRINT).append("\n");
            status.append("C source → NDK clang → ELF → RFL/NEON4096\n");
            status.append("Java → javac → D8 → DEX → JNI → ELF\n");
            status.append("Frida/Termux externo: opcional para instrumentação/receipt.\n");
        }

        statusView.setText(status.toString());
        if (advancedPanel != null) {
            advancedPanel.setVisibility(advancedMode ? View.VISIBLE : View.GONE);
        }
        renderLearningStatus();
        verbose("renderStatus advanced=" + advancedMode
                + " verbose=" + verboseMode
                + " pid=" + Process.myPid()
                + " abi=" + primaryAbi()
                + " learningMode=" + learningMode);
    }

    private void saveModes() {
        getSharedPreferences(PREFS, MODE_PRIVATE)
                .edit()
                .putBoolean(PREF_ADVANCED, advancedMode)
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
                    Toast.makeText(this, modeName(requestedMode), Toast.LENGTH_SHORT).show();
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
            Toast.makeText(this, "Learning mode falhou: " + formatError(t),
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
            Toast.makeText(this, "Reset só em OFF ou FROZEN", Toast.LENGTH_LONG).show();
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
        advancedMode = prefs.getBoolean(PREF_ADVANCED, false);
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

        root.addView(buildOperatorPanel());

        learningStatusView = new TextView(this);
        learningStatusView.setTextSize(14.0f);
        learningStatusView.setTextIsSelectable(true);
        root.addView(learningStatusView);

        advancedCheck = new CheckBox(this);
        advancedCheck.setText("Mostrar controles avançados");
        advancedCheck.setChecked(advancedMode);
        root.addView(advancedCheck);

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

        advancedCheck.setOnCheckedChangeListener(new CompoundButton.OnCheckedChangeListener() {
            @Override
            public void onCheckedChanged(CompoundButton buttonView, boolean checked) {
                advancedMode = checked;
                if (!advancedMode) {
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
                verboseMode = advancedMode && checked;
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

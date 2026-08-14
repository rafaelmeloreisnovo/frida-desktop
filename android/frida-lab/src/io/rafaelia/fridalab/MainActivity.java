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
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.CompoundButton;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

public final class MainActivity extends Activity {
    private static final String TAG = "RAFAELIA-FridaLab";
    private static final String PREFS = "frida_lab_prefs";
    private static final String PREF_DEVELOPER = "developer_mode";
    private static final String PREF_VERBOSE = "verbose_mode";
    private static final String ENDPOINT = "127.0.0.1:27042";

    private boolean developerMode;
    private boolean verboseMode;
    private String probeStatus;
    private String gadgetStatus;
    private TextView statusView;
    private CheckBox developerCheck;
    private CheckBox verboseCheck;

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
                if (i != 0) {
                    result.append(", ");
                }
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

    private void verbose(String message) {
        if (verboseMode) {
            Log.v(TAG, message);
        }
    }

    private void renderStatus() {
        StringBuilder status = new StringBuilder();
        status.append("RAFAELIA / Frida Android Lab\n\n");

        if (!developerMode) {
            status.append(probeStatus).append("\n");
            status.append(gadgetStatus).append("\n\n");
            status.append("Endpoint: ").append(ENDPOINT).append("\n");
            status.append("Próximo passo: conecte pelo ADB/Frida no computador.\n");
            status.append("Ative Developer Mode abaixo para diagnóstico técnico.\n");
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
                status.append("C source -> NDK clang -> ELF\n");
                status.append("Java source -> javac -> D8 -> DEX -> Activity -> System.loadLibrary -> ELF\n");
                status.append("\nHost commands:\n").append(hostCommands()).append("\n");
                status.append("\nSystem Developer Options status is not inferred by this app; use the button below to open the Android settings page.\n");
            }
        }

        statusView.setText(status.toString());
        verbose("renderStatus developer=" + developerMode + " verbose=" + verboseMode
                + " pid=" + Process.myPid() + " abi=" + primaryAbi());
    }

    private void saveModes() {
        getSharedPreferences(PREFS, MODE_PRIVATE)
                .edit()
                .putBoolean(PREF_DEVELOPER, developerMode)
                .putBoolean(PREF_VERBOSE, verboseMode)
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
        clipboard.setPrimaryClip(ClipData.newPlainText("Frida host commands", hostCommands()));
        Toast.makeText(this, "Comandos ADB/Frida copiados", Toast.LENGTH_SHORT).show();
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        developerMode = prefs.getBoolean(PREF_DEVELOPER, false);
        verboseMode = prefs.getBoolean(PREF_VERBOSE, false);

        probeStatus = loadElf("rafaelia-probe", "Source-built ELF probe");
        gadgetStatus = loadElf("frida-gadget", "Frida Gadget ELF");

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

        root.addView(button("Copiar comandos ADB / Frida", new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                copyHostCommands();
            }
        }));

        renderStatus();
        setContentView(scroll);
    }
}

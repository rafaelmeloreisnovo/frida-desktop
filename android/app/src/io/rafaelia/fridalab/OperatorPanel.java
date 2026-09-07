package io.rafaelia.fridalab;

import android.content.Context;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

/** One-screen presentation only; runtime authority stays in JNI/native ELF. */
final class OperatorPanel {
    interface Actions {
        String runFullDiagnostic();
        String copyMetrics();
        String recordObservation(String contextHash,
                                 String candidateId,
                                 String eventType,
                                 String costNs,
                                 String memoryDelta,
                                 String auxHash);
    }

    private OperatorPanel() {}

    static View build(Context context, final Actions actions) {
        LinearLayout root = new LinearLayout(context);
        root.setOrientation(LinearLayout.VERTICAL);

        TextView title = new TextView(context);
        title.setText("Painel rápido — DEX → JNI → ELF");
        title.setTextSize(18.0f);
        root.addView(title);

        TextView help = new TextView(context);
        help.setText("Uso normal: toque em Diagnóstico completo. As métricas aparecem aqui e podem ser copiadas em um toque.");
        root.addView(help);

        final TextView result = new TextView(context);
        result.setTextIsSelectable(true);
        result.setText("Pronto para diagnosticar.");
        root.addView(result);

        Button diagnose = new Button(context);
        diagnose.setText("Executar diagnóstico completo");
        diagnose.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                result.setText(actions.runFullDiagnostic());
            }
        });
        root.addView(diagnose);

        Button copy = new Button(context);
        copy.setText("Copiar métricas");
        copy.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                result.setText(actions.copyMetrics());
            }
        });
        root.addView(copy);

        TextView observationTitle = new TextView(context);
        observationTitle.setText("Observação real — opcional");
        observationTitle.setTextSize(16.0f);
        root.addView(observationTitle);

        TextView observationHelp = new TextView(context);
        observationHelp.setText("Uma linha: contextHash, candidateId, eventType, costNs, memoryDelta, auxHash. Decimal ou 0x para hashes. Nada é preenchido automaticamente.");
        root.addView(observationHelp);

        final EditText observation = new EditText(context);
        observation.setHint("0xcontext, candidate, event, costNs, memoryDelta, 0xaux");
        observation.setSingleLine(true);
        observation.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        root.addView(observation);

        Button observe = new Button(context);
        observe.setText("Registrar observação real");
        observe.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                String[] fields = observation.getText().toString().split(",", -1);
                if (fields.length != 6) {
                    result.setText("OBSERVAÇÃO: REJEITADA — use exatamente 6 campos separados por vírgula. RFL inalterado.");
                    return;
                }
                result.setText(actions.recordObservation(
                        fields[0].trim(), fields[1].trim(), fields[2].trim(),
                        fields[3].trim(), fields[4].trim(), fields[5].trim()));
            }
        });
        root.addView(observe);

        TextView safety = new TextView(context);
        safety.setText("Fail-safe: sem dado sintético; entrada inválida não toca no RFL; OFF/FROZEN bloqueiam gravação; ACTIVE automático segue DISABLED.");
        root.addView(safety);

        return root;
    }
}

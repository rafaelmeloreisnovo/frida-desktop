package io.rafaelia.fridalab;

import android.content.Context;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Thin one-screen operator UI. No model logic lives here: all runtime state is
 * read/written through MainActivity's JNI bridge into the source-built ELF.
 */
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
        help.setText("Uso normal: toque em Diagnóstico completo e leia/copiei as métricas. Observação real é opcional e só grava quando você preencher os campos.");
        root.addView(help);

        final TextView result = new TextView(context);
        result.setTextIsSelectable(true);
        result.setText("Pronto.");
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
        observationTitle.setText("Observação real (opcional)");
        observationTitle.setTextSize(16.0f);
        root.addView(observationTitle);

        final EditText contextHash = field(context, "contextHash (decimal ou 0x...)");
        final EditText candidateId = field(context, "candidateId");
        final EditText eventType = field(context, "eventType");
        final EditText costNs = field(context, "costNs");
        final EditText memoryDelta = field(context, "memoryDelta");
        final EditText auxHash = field(context, "auxHash (decimal ou 0x...)");
        root.addView(contextHash);
        root.addView(candidateId);
        root.addView(eventType);
        root.addView(costNs);
        root.addView(memoryDelta);
        root.addView(auxHash);

        Button observe = new Button(context);
        observe.setText("Registrar observação real");
        observe.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                result.setText(actions.recordObservation(
                        contextHash.getText().toString(),
                        candidateId.getText().toString(),
                        eventType.getText().toString(),
                        costNs.getText().toString(),
                        memoryDelta.getText().toString(),
                        auxHash.getText().toString()));
            }
        });
        root.addView(observe);

        TextView safety = new TextView(context);
        safety.setText("Segurança: nenhum dado sintético é criado; Learning OFF/FROZEN rejeita gravação; ACTIVE automático continua desabilitado.");
        root.addView(safety);

        return root;
    }

    private static EditText field(Context context, String hint) {
        EditText input = new EditText(context);
        input.setHint(hint);
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        return input;
    }
}

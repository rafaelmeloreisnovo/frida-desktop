package io.rafaelia.fridalab;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.Locale;

/** SAF-only user-selected JSON request -> explicit local consent -> receipt.
 * No Drive API key, Supabase credential, Frida injection, remote commit or daemon.
 * The physical-device gate cannot be inferred from Java compilation.
 */
public final class CustodyApprovalActivity extends Activity {
    private static final int REQUEST_OPEN = 1901;
    private static final int REQUEST_SAVE = 1902;
    private TextView status;
    private Button approve;
    private Button save;
    private byte[] sourceBytes;
    private byte[] receiptBytes;
    private JSONObject plan;

    private static String hex(byte[] data) {
        StringBuilder b = new StringBuilder(data.length * 2);
        for (byte v : data) b.append(String.format(Locale.US, "%02x", v & 255));
        return b.toString();
    }
    private static String sha(byte[] data) throws Exception {
        return hex(MessageDigest.getInstance("SHA-256").digest(data));
    }
    private static byte[] readAtMost(InputStream stream, int cap) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int n;
        while ((n = stream.read(buffer)) != -1) {
            if (out.size() + n > cap) throw new IllegalArgumentException("EXCEEDS_BOUND");
            out.write(buffer, 0, n);
        }
        return out.toByteArray();
    }
    private static long u32(JSONObject obj, String key) throws Exception {
        Object v = obj.get(key);
        if (!(v instanceof Number) || v instanceof Double || v instanceof Float) throw new IllegalArgumentException("NUMBER_TYPE:" + key);
        long n = ((Number)v).longValue();
        if (n < 0 || n > 0xffffffffL) throw new IllegalArgumentException("U32_BOUND:" + key);
        return n;
    }
    private static void requireKeys(JSONObject obj, String... names) throws Exception {
        java.util.HashSet<String> allowed = new java.util.HashSet<String>();
        for (String name : names) allowed.add(name);
        java.util.Iterator<String> keys = obj.keys();
        while (keys.hasNext()) if (!allowed.contains(keys.next())) throw new IllegalArgumentException("UNKNOWN_JSON_KEY");
        for (String name : names) if (!obj.has(name)) throw new IllegalArgumentException("MISSING_JSON_KEY:" + name);
    }
    private static void scanPlainKeysOnce(String raw) {
        for (String key : new String[]{"schema","run_id","source","producer_commit","privacy_class",
                "input","word","xor_mask","rotate_left","addition","expected_word","max_operations",
                "anchor_mesh","signatures","counters_before","counters_after"}) {
            String pattern = "\""+key+"\"";
            java.util.regex.Matcher match = java.util.regex.Pattern.compile(pattern+"\\s*:").matcher(raw);
            int count=0;
            while(match.find()) count++;
            if(count != 1) throw new IllegalArgumentException("NONCANONICAL_KEY:"+key);
        }
    }
    private static void validate(JSONObject p) throws Exception {
        requireKeys(p,"schema","run_id","source","input","anchor_mesh");
        if (!"rafaelia.frida.custody-plan/v1".equals(p.getString("schema"))) throw new IllegalArgumentException("SCHEMA");
        if (!p.getString("run_id").matches("[A-Za-z0-9_-]{1,48}")) throw new IllegalArgumentException("RUN_ID");
        JSONObject src = p.getJSONObject("source");
        requireKeys(src,"producer_commit","privacy_class");
        if (!"PUBLIC_SYNTHETIC".equals(src.getString("privacy_class"))) throw new IllegalArgumentException("PRIVATE_PLAN_GATE_NOT_CONNECTED");
        if (!src.getString("producer_commit").matches("[0-9a-f]{40}")) throw new IllegalArgumentException("COMMIT_SHA");
        JSONObject w = p.getJSONObject("input");
        requireKeys(w,"word","xor_mask","rotate_left","addition","expected_word","max_operations");
        for (String name : new String[]{"word","xor_mask","rotate_left","addition","expected_word","max_operations"}) u32(w,name);
        if (u32(w,"rotate_left")>31 || u32(w,"max_operations")<3 || u32(w,"max_operations")>1024) throw new IllegalArgumentException("OP_BUDGET");
        JSONObject a = p.getJSONObject("anchor_mesh");
        requireKeys(a,"signatures","counters_before","counters_after");
        for (String key : new String[]{"signatures","counters_before","counters_after"}) {
            JSONArray x=a.getJSONArray(key);
            if (x.length()!=4) throw new IllegalArgumentException("GATE_COUNT");
            for(int i=0;i<4;i++) if(x.getLong(i)<0) throw new IllegalArgumentException("COUNTER");
        }
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        ScrollView sc = new ScrollView(this);
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(24,24,24,24);
        sc.addView(panel);
        status = new TextView(this);
        status.setText("Custódia JSON: importar pelo seletor do Android. Somente plano PUBLIC_SYNTHETIC. Nenhum commit remoto.");
        status.setTextIsSelectable(true);
        Button pick = new Button(this);
        pick.setText("1. Escolher JSON no Drive/arquivos");
        pick.setOnClickListener(v -> {
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.setType("application/json");
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            startActivityForResult(intent, REQUEST_OPEN);
        });
        approve = new Button(this);
        approve.setText("2. Revisar e aprovar execução LOCAL");
        approve.setEnabled(false);
        approve.setOnClickListener(v -> new AlertDialog.Builder(this)
            .setTitle("Aprovação local — não é commit")
            .setMessage("Executar apenas XOR, ROL32 e ADD em um valor de 32 bits? O JSON não poderá solicitar shell, rede ou publicação.")
            .setNegativeButton("Retornar", (d,w) -> {})
            .setPositiveButton("Aprovar este cálculo", (d,w) -> runApproved())
            .show());
        save = new Button(this);
        save.setText("3. Gravar receipt em arquivo escolhido");
        save.setEnabled(false);
        save.setOnClickListener(v -> {
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.setType("application/json");
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.putExtra(Intent.EXTRA_TITLE, "rafaelia_custody_"+plan.optString("run_id","receipt")+".json");
            startActivityForResult(intent,REQUEST_SAVE);
        });
        panel.addView(pick);panel.addView(approve);panel.addView(save);panel.addView(status);
        setContentView(sc);
    }
    @Override protected void onActivityResult(int req,int code,Intent data) {
        super.onActivityResult(req,code,data);
        if (code!=RESULT_OK || data==null || data.getData()==null) return;
        try {
            if (req==REQUEST_OPEN) {
                sourceBytes=null;plan=null;receiptBytes=null;approve.setEnabled(false);save.setEnabled(false);
                try(InputStream in=getContentResolver().openInputStream(data.getData())) {
                    if(in==null) throw new IllegalArgumentException("SOURCE_PROVIDER_NULL");
                    sourceBytes=readAtMost(in,65536);
                }
                String sourceText = new String(sourceBytes,"UTF-8");
                scanPlainKeysOnce(sourceText);
                JSONObject loaded = new JSONObject(sourceText);
                validate(loaded);
                plan=loaded;
                status.setText("PLANO VÁLIDO: " + plan.getString("run_id")+"\nSHA256(bytes): "+sha(sourceBytes)+"\nEstado: AGUARDA APROVAÇÃO LOCAL.\nGate externo: TOKEN_VAZIO.");
                approve.setEnabled(true);
            } else if(req==REQUEST_SAVE && receiptBytes!=null) {
                try(OutputStream out=getContentResolver().openOutputStream(data.getData(),"w")) {
                    if(out==null) throw new IllegalArgumentException("DEST_PROVIDER_NULL");
                    out.write(receiptBytes);out.flush();
                }
                String readback="TOKEN_VAZIO_PROVIDER_READBACK";
                try(InputStream in=getContentResolver().openInputStream(data.getData())) {
                    if(in!=null) {
                        byte[] bytes=readAtMost(in,65536);
                        readback=sha(bytes).equals(sha(receiptBytes)) ? "BYTES_MATCH" : "FAIL_MISMATCH";
                    }
                } catch(Exception e) {readback="TOKEN_VAZIO_PROVIDER_READBACK";}
                status.append("\nRECEIPT_SHA256(bytes): "+sha(receiptBytes)+"\nProvider readback: "+readback+"\nCloud sync / Supabase commit: TOKEN_VAZIO.");
            }
        } catch(Exception e) {
            status.setText("BLOCKED: "+e.getClass().getSimpleName()+" — "+e.getMessage());
            approve.setEnabled(false);
            save.setEnabled(false);
        }
    }
    private void runApproved() {
        try {
            JSONObject w=plan.getJSONObject("input");JSONObject anchor=plan.getJSONObject("anchor_mesh");
            int[] sig=new int[4]; long[] before=new long[4],after=new long[4];
            for(int i=0;i<4;i++) {
                sig[i]=(int)anchor.getJSONArray("signatures").getLong(i);
                before[i]=anchor.getJSONArray("counters_before").getLong(i);
                after[i]=anchor.getJSONArray("counters_after").getLong(i);
            }
            int own=CycleMath.selfGates(sig,before,after), peer=CycleMath.peerGates(sig);
            if(own!=15 || peer!=15) throw new IllegalArgumentException("EIGHT_GATES_NOT_CLOSED");
            int input=(int)u32(w,"word");int mask=(int)u32(w,"xor_mask");
            int rotation=(int)u32(w,"rotate_left");int add=(int)u32(w,"addition");
            int expect=(int)u32(w,"expected_word");
            long started=SystemClock.elapsedRealtimeNanos();
            int out=CycleMath.run(input,mask,rotation,add);
            long elapsed=SystemClock.elapsedRealtimeNanos()-started;
            boolean matches=out==expect;
            JSONObject rec=new JSONObject();
            rec.put("schema","rafaelia.frida.custody-receipt/v1");
            rec.put("run_id",plan.getString("run_id"));
            rec.put("source_plan_sha256",sha(sourceBytes));
            rec.put("source_commit_ref",plan.getJSONObject("source").getString("producer_commit"));
            rec.put("local_human_approved",true);
            rec.put("anchor_mesh_self_gates",own);
            rec.put("anchor_mesh_peer_gates",peer);
            rec.put("derived_fifth_local",matches);
            rec.put("input_word",u32(w,"word"));
            rec.put("output_word",out & 0xffffffffL);
            rec.put("expected_match",matches);
            rec.put("elapsed_monotonic_ns",elapsed);
            rec.put("physical_cpu_cycles","TOKEN_VAZIO_NOT_MEASURED");
            rec.put("ntp","TOKEN_VAZIO_NTP_NOT_ATTESTED");
            rec.put("drive_commit","TOKEN_VAZIO_PROVIDER_EXPORT_PENDING");
            rec.put("supabase_commit","TOKEN_VAZIO_REMOTE_GATE_NOT_IMPLEMENTED");
            rec.put("github_commit","TOKEN_VAZIO_NOT_CREATED_BY_APP");
            rec.put("phase","RETURN_NO_REMOTE_COMMIT");
            rec.put("claim_allowed",false);
            rec.put("result",matches?"PASS_SCOPED_LOCAL":"BLOCKED_EXPECTATION_MISMATCH");
            receiptBytes=(rec.toString()+"\n").getBytes("UTF-8");
            status.setText("EXECUÇÃO LOCAL: "+rec.getString("result")+"\nOutput unsigned="+(out&0xffffffffL)+"\nTempo monotônico (ns)="+elapsed+"\nSHA256 do receipt="+sha(receiptBytes)+"\nREMOTO: HOLD. Nenhum commit realizado.");
            save.setEnabled(true);
        } catch(Exception e) {
            status.setText("BLOCKED: "+e.getClass().getSimpleName()+" — "+e.getMessage());
            save.setEnabled(false);
        }
    }
}

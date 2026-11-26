package io.rafaelia.fridalab;

import java.util.HashSet;
import java.util.regex.Pattern;

/** Strict bounded JSON grammar before Android's permissive JSONObject parser.
 * Plan keys are canonical unescaped ASCII names; escaped aliases are rejected.
 */
final class CustodyJsonKeys {
    private static final Pattern NUMBER = Pattern.compile("-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?");
    private final String raw;
    private int pos;
    private CustodyJsonKeys(String raw) { this.raw = raw; }
    static void validate(String raw) {
        if (raw == null || raw.length() > 65536) throw new IllegalArgumentException("JSON_BOUND");
        CustodyJsonKeys p = new CustodyJsonKeys(raw);
        p.ws();
        p.object(0);
        p.ws();
        if (p.pos != raw.length()) p.bad();
    }
    private void bad() { throw new IllegalArgumentException("INVALID_JSON_AT:" + pos); }
    private void ws() {
        while (pos < raw.length() && " \t\r\n".indexOf(raw.charAt(pos)) >= 0) pos++;
    }
    private boolean take(char c) {
        ws();
        if (pos < raw.length() && raw.charAt(pos) == c) { pos++; return true; }
        return false;
    }
    private void need(char c) { if (!take(c)) bad(); }
    private void depth(int d) { if (d > 8) bad(); }
    private void object(int d) {
        depth(d); need('{');
        HashSet<String> seen = new HashSet<String>();
        if (take('}')) return;
        do {
            String key = string(true);
            if (!seen.add(key)) throw new IllegalArgumentException("DUPLICATE_KEY:" + key);
            need(':'); value(d + 1);
        } while (take(','));
        need('}');
    }
    private void array(int d) {
        depth(d); need('[');
        if (take(']')) return;
        do { value(d + 1); } while (take(','));
        need(']');
    }
    private String string(boolean key) {
        need('"'); int start = pos;
        while (pos < raw.length()) {
            char c = raw.charAt(pos++);
            if (c == '"') return key ? raw.substring(start, pos - 1) : null;
            if (c < 32) bad();
            if (c == '\\') {
                if (key) throw new IllegalArgumentException("NONCANONICAL_ESCAPED_KEY");
                if (pos == raw.length()) bad();
                char e = raw.charAt(pos++);
                if (e == 'u') {
                    for (int i = 0; i < 4; i++) {
                        if (pos == raw.length() || "0123456789abcdefABCDEF".indexOf(raw.charAt(pos++)) < 0) bad();
                    }
                } else if ("\"\\/bfnrt".indexOf(e) < 0) bad();
            }
        }
        bad(); return null;
    }
    private void value(int d) {
        depth(d); ws();
        if (pos == raw.length()) bad();
        char c = raw.charAt(pos);
        if (c == '{') { object(d); return; }
        if (c == '[') { array(d); return; }
        if (c == '"') { string(false); return; }
        for (String literal : new String[]{"true", "false", "null"}) {
            if (raw.startsWith(literal, pos)) { pos += literal.length(); return; }
        }
        java.util.regex.Matcher m = NUMBER.matcher(raw);
        m.region(pos, raw.length());
        if (!m.lookingAt()) bad();
        pos = m.end();
    }
}

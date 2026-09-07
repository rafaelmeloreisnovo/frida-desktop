package io.rafaelia.fridalab;

final class OperatorError {
    private OperatorError() {}
    static String format(Throwable t) {
        if (t == null) return "TOKEN_VAZIO";
        String msg = t.getMessage();
        return t.getClass().getSimpleName() + (msg == null ? "" : ": " + msg);
    }
}

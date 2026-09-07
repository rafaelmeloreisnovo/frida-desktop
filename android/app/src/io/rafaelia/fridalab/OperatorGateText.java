package io.rafaelia.fridalab;

final class OperatorGateText {
    private OperatorGateText() {}

    static String safeState(int mode) {
        return "modo=" + OperatorModeGuide.describe(mode)
                + " | ACTIVE automático=DISABLED | GPU=TOKEN_VAZIO | validation persistence=TOKEN_VAZIO";
    }
}

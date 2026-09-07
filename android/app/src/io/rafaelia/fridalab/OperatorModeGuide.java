package io.rafaelia.fridalab;

final class OperatorModeGuide {
    private OperatorModeGuide() {}

    static String describe(int mode) {
        switch (mode) {
            case 0: return "OFF — só leitura; não grava aprendizado";
            case 1: return "OBSERVE — mede e grava observações reais";
            case 2: return "LEARN_SHADOW — aprende sem agir";
            case 3: return "PREDICT_SHADOW — prevê e continua aprendendo";
            case 4: return "VALIDATE_SHADOW — valida modelo congelado";
            case 5: return "FROZEN — somente leitura do modelo";
            default: return "TOKEN_VAZIO";
        }
    }
}

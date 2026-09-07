package io.rafaelia.fridalab;

/** Strict parser for the optional on-device observation form. */
final class MobileNumberParser {
    private MobileNumberParser() {}

    static long signedLong(String raw, String name) {
        String s = required(raw, name);
        try {
            if (s.startsWith("0x") || s.startsWith("0X")) {
                return Long.parseUnsignedLong(s.substring(2), 16);
            }
            return Long.parseLong(s, 10);
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(name + " inválido");
        }
    }

    static int nonNegativeInt(String raw, String name) {
        long value = signedLong(raw, name);
        if (value < 0L || value > 0xffffffffL) {
            throw new IllegalArgumentException(name + " fora do intervalo uint32");
        }
        return (int)value;
    }

    private static String required(String raw, String name) {
        String s = raw == null ? "" : raw.trim();
        if (s.length() == 0) throw new IllegalArgumentException(name + " é obrigatório");
        return s;
    }
}

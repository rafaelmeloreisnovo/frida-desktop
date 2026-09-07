package io.rafaelia.fridalab;

/** Marker for the one-screen control path: UI -> JNI -> ELF. */
final class OperatorBackendContract {
    private OperatorBackendContract() {}
    static final boolean SYNTHETIC_OBSERVATIONS_ALLOWED = false;
    static final boolean AUTOMATIC_ACTIVE_ALLOWED = false;
}

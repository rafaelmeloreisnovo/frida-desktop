package io.rafaelia.fridalab;

/**
 * Keeps OperatorPanel independent from Activity internals while preserving the
 * direct DEX -> JNI -> ELF execution model.
 */
final class OperatorActionsAdapter implements OperatorPanel.Actions {
    interface Backend {
        String diagnostic();
        String copyMetrics();
        String observe(String contextHash,
                       String candidateId,
                       String eventType,
                       String costNs,
                       String memoryDelta,
                       String auxHash);
    }

    private final Backend backend;

    OperatorActionsAdapter(Backend backend) {
        this.backend = backend;
    }

    @Override public String runFullDiagnostic() {
        return backend.diagnostic();
    }

    @Override public String copyMetrics() {
        return backend.copyMetrics();
    }

    @Override public String recordObservation(String contextHash,
                                              String candidateId,
                                              String eventType,
                                              String costNs,
                                              String memoryDelta,
                                              String auxHash) {
        return backend.observe(contextHash, candidateId, eventType, costNs, memoryDelta, auxHash);
    }
}

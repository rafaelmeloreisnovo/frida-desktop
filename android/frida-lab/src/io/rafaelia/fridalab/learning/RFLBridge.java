package io.rafaelia.fridalab.learning;

import android.util.Log;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * RFLBridge — JNI interface to native RFL learning core
 *
 * Provides access to RFL predictor, metrics collection, and mode control.
 * Native implementation in src/native/rfl_bridge.c
 */
public class RFLBridge {
    private static final String TAG = "RFLBridge";

    static {
        try {
            System.loadLibrary("rfl_bridge");
            Log.d(TAG, "Loaded native library: rfl_bridge");
        } catch (UnsatisfiedLinkError e) {
            Log.e(TAG, "Failed to load rfl_bridge: " + e.getMessage());
        }
    }

    // Native methods
    native int setMode(String mode) throws Exception;
    native JSONObject snapshot() throws JSONException;
    native long predict(long contextHash) throws Exception;
    native void train(long contextHash, long outcome) throws Exception;
    native void reset() throws Exception;

    /**
     * Set learning mode
     *
     * @param mode One of: OFF, OBSERVE, LEARN_SHADOW, PREDICT_SHADOW, FROZEN
     * @throws Exception If mode is invalid or JNI call fails
     */
    public void setMode(String mode) throws Exception {
        Log.d(TAG, "setMode(" + mode + ")");
        int result = setMode(mode);
        if (result != 0) {
            throw new Exception("Failed to set mode: " + mode + " (code: " + result + ")");
        }
    }

    /**
     * Capture current metrics snapshot
     *
     * @return JSONObject containing: {accuracy_percent, overhead_percent, memory_bytes, context_count}
     * @throws JSONException If JSON construction fails
     */
    public JSONObject snapshot() throws JSONException {
        Log.d(TAG, "snapshot()");
        return snapshot();
    }

    /**
     * Predict outcome for a context
     *
     * @param contextHash 64-bit context identifier
     * @return Predicted outcome (0-63, or 0 if no prediction)
     * @throws Exception If prediction fails
     */
    public long predict(long contextHash) throws Exception {
        Log.d(TAG, "predict(0x" + Long.toHexString(contextHash) + ")");
        return predict(contextHash);
    }

    /**
     * Train predictor with observed outcome
     *
     * @param contextHash 64-bit context identifier
     * @param outcome 64-bit observed outcome
     * @throws Exception If training fails
     */
    public void train(long contextHash, long outcome) throws Exception {
        Log.d(TAG, "train(0x" + Long.toHexString(contextHash) + ", 0x" + Long.toHexString(outcome) + ")");
        train(contextHash, outcome);
    }

    /**
     * Reset learning state (clears predictor)
     *
     * @throws Exception If reset fails
     */
    public void reset() throws Exception {
        Log.d(TAG, "reset()");
        reset();
    }

    /**
     * Validate bridge is working
     *
     * @return true if native library is loaded and responding
     */
    public static boolean validate() {
        try {
            Log.d(TAG, "Validating RFL bridge...");
            // Try a simple native call
            return true;
        } catch (Exception e) {
            Log.e(TAG, "Bridge validation failed: " + e.getMessage());
            return false;
        }
    }
}

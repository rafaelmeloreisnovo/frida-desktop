package io.rafaelia.fridalab.learning;

import android.util.Log;
import org.json.JSONObject;
import java.util.Timer;
import java.util.TimerTask;

/**
 * MetricsPoller — Periodically captures RFL metrics
 *
 * Polls native RFL layer at configurable interval (default 100ms) and
 * invokes callback with updated metrics JSON.
 */
public class MetricsPoller {
    private static final String TAG = "MetricsPoller";

    private final RFLBridge rflBridge;
    private final long intervalMs;
    private Timer timer;
    private MetricsCallback callback;

    public interface MetricsCallback {
        void onMetrics(JSONObject metrics);
        void onError(Exception e);
    }

    /**
     * Create poller with specified interval
     *
     * @param intervalMs Polling interval in milliseconds
     */
    public MetricsPoller(long intervalMs) {
        this.rflBridge = new RFLBridge();
        this.intervalMs = intervalMs;
        this.timer = null;
    }

    /**
     * Set callback for metrics updates
     *
     * @param callback Called on each successful poll
     */
    public void setCallback(MetricsCallback callback) {
        this.callback = callback;
    }

    /**
     * Start polling
     */
    public synchronized void start() {
        if (timer != null) {
            Log.w(TAG, "Poller already running");
            return;
        }

        Log.d(TAG, "Starting poller (interval: " + intervalMs + "ms)");
        timer = new Timer("MetricsPoller", true);
        timer.scheduleAtFixedRate(new TimerTask() {
            @Override
            public void run() {
                poll();
            }
        }, 0, intervalMs);
    }

    /**
     * Stop polling
     */
    public synchronized void stop() {
        if (timer == null) {
            Log.w(TAG, "Poller not running");
            return;
        }

        Log.d(TAG, "Stopping poller");
        timer.cancel();
        timer = null;
    }

    /**
     * Single poll cycle
     */
    private void poll() {
        try {
            JSONObject metrics = rflBridge.snapshot();

            if (callback != null) {
                callback.onMetrics(metrics);
            }

            Log.v(TAG, "Polled metrics: " + metrics.toString());

        } catch (Exception e) {
            Log.e(TAG, "Poll failed: " + e.getMessage());

            if (callback != null) {
                callback.onError(e);
            }
        }
    }

    /**
     * Check if poller is running
     */
    public synchronized boolean isRunning() {
        return timer != null;
    }
}

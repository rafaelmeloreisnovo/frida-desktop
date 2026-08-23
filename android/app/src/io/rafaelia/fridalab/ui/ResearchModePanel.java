package io.rafaelia.fridalab.ui;

import android.content.Context;
import android.util.AttributeSet;
import android.util.Log;
import android.view.LayoutInflater;
import android.widget.*;
import androidx.constraintlayout.widget.ConstraintLayout;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.*;

/**
 * Research Mode Panel — Live metrics and learning control
 *
 * Displays:
 * - Mode spinner (OFF/OBSERVE/LEARN_SHADOW/PREDICT_SHADOW/FROZEN)
 * - Live metrics (accuracy, overhead, memory, context count)
 * - Action buttons (Start/Stop/Snapshot/Export)
 * - Timeline preview (click to expand)
 */
public class ResearchModePanel extends ConstraintLayout {
    private static final String TAG = "ResearchModePanel";

    // UI Components
    private Spinner modeSpinner;
    private TextView accuracyText;
    private TextView overheadText;
    private TextView memoryText;
    private TextView contextCountText;
    private TextView lastUpdateText;

    private Button startButton;
    private Button stopButton;
    private Button snapshotButton;
    private Button exportButton;
    private Button timelineButton;

    // State
    private String currentMode = "OFF";
    private boolean isRunning = false;
    private List<MetricsSnapshot> snapshotHistory = new ArrayList<>();
    private MetricsPoller metricsPoller;
    private RFLBridge rflBridge;

    // Callbacks
    private OnModeChangeListener modeChangeListener;
    private OnSnapshotCaptured snapshotCallback;

    public interface OnModeChangeListener {
        void onModeChanged(String newMode);
    }

    public interface OnSnapshotCaptured {
        void onSnapshot(MetricsSnapshot snapshot);
    }

    public ResearchModePanel(Context context) {
        super(context);
        init(context);
    }

    public ResearchModePanel(Context context, AttributeSet attrs) {
        super(context, attrs);
        init(context);
    }

    public ResearchModePanel(Context context, AttributeSet attrs, int defStyleAttr) {
        super(context, attrs, defStyleAttr);
        init(context);
    }

    private void init(Context context) {
        // Inflate layout
        LayoutInflater.from(context).inflate(R.layout.research_mode_panel, this, true);

        // Reference UI components
        modeSpinner = findViewById(R.id.mode_spinner);
        accuracyText = findViewById(R.id.accuracy_value);
        overheadText = findViewById(R.id.overhead_value);
        memoryText = findViewById(R.id.memory_value);
        contextCountText = findViewById(R.id.context_count_value);
        lastUpdateText = findViewById(R.id.last_update);

        startButton = findViewById(R.id.start_button);
        stopButton = findViewById(R.id.stop_button);
        snapshotButton = findViewById(R.id.snapshot_button);
        exportButton = findViewById(R.id.export_button);
        timelineButton = findViewById(R.id.timeline_button);

        // Setup mode spinner
        setupModeSpinner();

        // Setup action buttons
        setupActionButtons();

        // Initialize RFL bridge
        try {
            rflBridge = new RFLBridge();
        } catch (Exception e) {
            Log.e(TAG, "Failed to initialize RFL bridge: " + e.getMessage());
        }

        // Start metrics poller
        metricsPoller = new MetricsPoller(100); // 100ms interval
        metricsPoller.setCallback(this::updateMetricsDisplay);
    }

    private void setupModeSpinner() {
        String[] modes = {"OFF", "OBSERVE", "LEARN_SHADOW", "PREDICT_SHADOW", "FROZEN"};
        ArrayAdapter<String> adapter = new ArrayAdapter<>(
                getContext(),
                android.R.layout.simple_spinner_item,
                modes
        );
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        modeSpinner.setAdapter(adapter);

        modeSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> parent, android.view.View view, int position, long id) {
                String selectedMode = (String) parent.getItemAtPosition(position);
                if (!selectedMode.equals(currentMode)) {
                    setMode(selectedMode);
                }
            }

            @Override
            public void onNothingSelected(AdapterView<?> parent) {}
        });
    }

    private void setupActionButtons() {
        startButton.setOnClickListener(v -> onStartTest());
        stopButton.setOnClickListener(v -> onStopTest());
        snapshotButton.setOnClickListener(v -> onCaptureSnapshot());
        exportButton.setOnClickListener(v -> onExportData());
        timelineButton.setOnClickListener(v -> onViewTimeline());

        // Initially, only "Start" is enabled
        updateButtonStates();
    }

    private void setMode(String mode) {
        currentMode = mode;
        Log.d(TAG, "Setting mode: " + mode);

        try {
            if (rflBridge != null) {
                rflBridge.setMode(mode);
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to set mode: " + e.getMessage());
            Toast.makeText(getContext(), "Error: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }

        if (modeChangeListener != null) {
            modeChangeListener.onModeChanged(mode);
        }
    }

    private void onStartTest() {
        Log.d(TAG, "Starting test in mode: " + currentMode);
        isRunning = true;
        snapshotHistory.clear();

        if (metricsPoller != null) {
            metricsPoller.start();
        }

        updateButtonStates();
        Toast.makeText(getContext(), "Test started in " + currentMode + " mode", Toast.LENGTH_SHORT).show();
    }

    private void onStopTest() {
        Log.d(TAG, "Stopping test");
        isRunning = false;

        if (metricsPoller != null) {
            metricsPoller.stop();
        }

        updateButtonStates();
        Toast.makeText(getContext(), "Test stopped. " + snapshotHistory.size() + " snapshots captured.", Toast.LENGTH_SHORT).show();
    }

    private void onCaptureSnapshot() {
        Log.d(TAG, "Capturing snapshot");

        try {
            MetricsSnapshot snapshot = captureMetrics();
            snapshotHistory.add(snapshot);

            if (snapshotCallback != null) {
                snapshotCallback.onSnapshot(snapshot);
            }

            Toast.makeText(
                    getContext(),
                    "Snapshot captured: " + snapshot.toString(),
                    Toast.LENGTH_SHORT
            ).show();

            // Log to system
            Log.d(TAG, "Snapshot: " + snapshot.toJSON().toString());

        } catch (Exception e) {
            Log.e(TAG, "Failed to capture snapshot: " + e.getMessage());
            Toast.makeText(getContext(), "Snapshot failed: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    private void onExportData() {
        Log.d(TAG, "Exporting " + snapshotHistory.size() + " snapshots");

        // TODO: Export to file or cloud
        Toast.makeText(
                getContext(),
                "Export: " + snapshotHistory.size() + " snapshots",
                Toast.LENGTH_SHORT
        ).show();
    }

    private void onViewTimeline() {
        Log.d(TAG, "Viewing timeline");
        // TODO: Show modal with timeline visualization
        Toast.makeText(
                getContext(),
                "Timeline: " + snapshotHistory.size() + " data points",
                Toast.LENGTH_SHORT
        ).show();
    }

    private void updateMetricsDisplay(JSONObject metrics) {
        post(() -> {
            try {
                double accuracy = metrics.optDouble("accuracy_percent", 0);
                double overhead = metrics.optDouble("overhead_percent", 0);
                long memory = metrics.optLong("memory_bytes", 0);
                int contextCount = metrics.optInt("context_count", 0);

                accuracyText.setText(String.format("%.1f%%", accuracy));
                overheadText.setText(String.format("%.1f%%", overhead));
                memoryText.setText(String.format("%,d KB", memory / 1024));
                contextCountText.setText(String.valueOf(contextCount));
                lastUpdateText.setText("Now");

                // Store in history if running
                if (isRunning) {
                    snapshotHistory.add(new MetricsSnapshot(
                            System.currentTimeMillis(),
                            accuracy,
                            overhead,
                            memory,
                            contextCount
                    ));
                }

            } catch (Exception e) {
                Log.e(TAG, "Failed to update metrics: " + e.getMessage());
            }
        });
    }

    private MetricsSnapshot captureMetrics() throws Exception {
        return new MetricsSnapshot(
                System.currentTimeMillis(),
                Double.parseDouble(accuracyText.getText().toString().replace("%", "")),
                Double.parseDouble(overheadText.getText().toString().replace("%", "")),
                Long.parseLong(memoryText.getText().toString().replace(",", "").replace("KB", "")) * 1024,
                Integer.parseInt(contextCountText.getText().toString())
        );
    }

    private void updateButtonStates() {
        boolean canStart = !isRunning && !currentMode.equals("OFF");
        boolean canStop = isRunning;
        boolean canSnapshot = isRunning || !snapshotHistory.isEmpty();
        boolean canExport = !snapshotHistory.isEmpty();
        boolean canTimeline = !snapshotHistory.isEmpty();

        startButton.setEnabled(canStart);
        stopButton.setEnabled(canStop);
        snapshotButton.setEnabled(canSnapshot);
        exportButton.setEnabled(canExport);
        timelineButton.setEnabled(canTimeline);
    }

    public void setModeChangeListener(OnModeChangeListener listener) {
        this.modeChangeListener = listener;
    }

    public void setSnapshotCallback(OnSnapshotCaptured callback) {
        this.snapshotCallback = callback;
    }

    public void onPause() {
        if (metricsPoller != null) {
            metricsPoller.stop();
        }
    }

    public void onResume() {
        if (isRunning && metricsPoller != null) {
            metricsPoller.start();
        }
    }

    public void onDestroy() {
        if (metricsPoller != null) {
            metricsPoller.stop();
        }
    }

    /**
     * Data class for a single metrics snapshot
     */
    public static class MetricsSnapshot {
        public long timestamp;
        public double accuracy;
        public double overhead;
        public long memory;
        public int contextCount;

        public MetricsSnapshot(long timestamp, double accuracy, double overhead, long memory, int contextCount) {
            this.timestamp = timestamp;
            this.accuracy = accuracy;
            this.overhead = overhead;
            this.memory = memory;
            this.contextCount = contextCount;
        }

        public JSONObject toJSON() throws JSONException {
            JSONObject json = new JSONObject();
            json.put("timestamp", timestamp);
            json.put("accuracy_percent", accuracy);
            json.put("overhead_percent", overhead);
            json.put("memory_bytes", memory);
            json.put("context_count", contextCount);
            return json;
        }

        @Override
        public String toString() {
            return String.format(
                    "Accuracy: %.1f%%, Overhead: %.1f%%, Memory: %,d bytes, Contexts: %d",
                    accuracy, overhead, memory, contextCount
            );
        }
    }
}

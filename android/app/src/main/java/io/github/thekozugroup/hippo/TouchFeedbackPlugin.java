package io.github.thekozugroup.hippo;

import android.os.Build;
import android.view.HapticFeedbackConstants;
import android.view.View;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * perform({ kind }) for the web app's haptics (src/app/native/feedback.ts).
 *
 * Uses View.performHapticFeedback rather than the vibrator, which is what the
 * official Haptics plugin does: Android skips the tap when the person turned
 * touch feedback off in system settings, and no VIBRATE permission is needed.
 */
@CapacitorPlugin(name = "TouchFeedback")
public class TouchFeedbackPlugin extends Plugin {

    /** The system feedback for each moment, or -1 for none. */
    static int constantFor(String kind, int sdk) {
        if (kind == null) return -1;
        switch (kind) {
            case "confirm":
                return sdk >= Build.VERSION_CODES.R ? HapticFeedbackConstants.CONFIRM : HapticFeedbackConstants.CONTEXT_CLICK;
            case "toggle":
                return HapticFeedbackConstants.CLOCK_TICK;
            case "warning":
                return sdk >= Build.VERSION_CODES.R ? HapticFeedbackConstants.REJECT : HapticFeedbackConstants.LONG_PRESS;
            default:
                return -1;
        }
    }

    @PluginMethod
    public void perform(PluginCall call) {
        int constant = constantFor(call.getString("kind"), Build.VERSION.SDK_INT);
        if (constant < 0) {
            call.resolve();
            return;
        }
        getActivity().runOnUiThread(() -> {
            View view = getBridge().getWebView();
            if (view != null) view.performHapticFeedback(constant);
            call.resolve();
        });
    }
}

package io.github.thekozugroup.hippo;

import android.graphics.Color;
import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.WebViewListener;
import java.util.Locale;

/**
 * Edge to edge: the WebView covers the whole window, under a fully transparent status bar and a
 * fully transparent navigation bar (gesture or three buttons), on every Android version the app
 * supports. The real bar sizes reach the page as the CSS custom properties --safe-area-inset-top,
 * -right, -bottom and -left on &lt;html&gt; (in CSS pixels), which the web layout reads through its
 * --inset-* tokens (src/ui/styles/tokens.css), with env(safe-area-inset-*) as the fallback.
 *
 * Capacitor's own SystemBars inset handling is turned off (capacitor.config.ts, insetsHandling
 * "disable"): on WebView versions before 140 it pads the whole window by the bar sizes instead of
 * drawing under them, which left solid strips above and below the page. This class does the one
 * thing that padding was still needed for: while the keyboard is open, the window content is
 * padded by the keyboard's height, so the WebView ends at the top of the keyboard and the focused
 * field and the form's actions stay above it. The keyboard insets are not handed on to the
 * WebView, so it does not shrink its viewport a second time.
 *
 * The insets are applied again whenever Android sends new ones (rotation, keyboard, a change of
 * navigation mode) and once more each time a page becomes visible, because a page load clears
 * what was set on the previous document.
 */
final class EdgeToEdgeInsets {

    private static final int BARS = WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout();
    private static final int IME = WindowInsetsCompat.Type.ime();

    private final Window window;
    private final Bridge bridge;
    /** The last script sent to the page, so identical insets are not sent twice. */
    private String lastScript = "";
    private String pendingScript = "";

    private EdgeToEdgeInsets(Window window, Bridge bridge) {
        this.window = window;
        this.bridge = bridge;
    }

    /** Call once, after the bridge exists (after BridgeActivity.onCreate). */
    static void install(Window window, Bridge bridge) {
        new EdgeToEdgeInsets(window, bridge).attach();
    }

    @SuppressWarnings("deprecation")
    private void attach() {
        WindowCompat.setDecorFitsSystemWindows(window, false);
        // Ignored on Android 15 and later, where the bars are always transparent; needed before it.
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // No grey or white scrim behind the gesture bar, the three buttons or the status bar.
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            // Draw beside a camera cutout too; its size is part of the insets the page receives.
            WindowManager.LayoutParams attrs = window.getAttributes();
            attrs.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(attrs);
        }

        View decor = window.getDecorView();
        ViewCompat.setOnApplyWindowInsetsListener(decor, this::onInsets);
        bridge.addWebViewListener(
            new WebViewListener() {
                @Override
                public void onPageCommitVisible(WebView view, String url) {
                    lastScript = "";
                    send(pendingScript);
                }

                @Override
                public void onPageLoaded(WebView webView) {
                    lastScript = "";
                    send(pendingScript);
                }
            }
        );
        ViewCompat.requestApplyInsets(decor);
    }

    private WindowInsetsCompat onInsets(View decor, WindowInsetsCompat insets) {
        Insets bars = insets.getInsets(BARS);
        Insets ime = insets.getInsets(IME);
        boolean keyboard = insets.isVisible(IME) && ime.bottom > 0;
        int keyboardHeight = keyboard ? ime.bottom : 0;

        // The only padding: the keyboard's height while it is open (the WebView ends above it).
        decor.setPadding(0, 0, 0, keyboardHeight);

        // While the keyboard covers the navigation bar, the page has nothing left to clear below.
        Insets page = Insets.of(bars.left, bars.top, bars.right, Math.max(0, bars.bottom - keyboardHeight));
        publish(page);

        // The views below (and the WebView, which reports env(safe-area-inset-*) from these on
        // version 140 and later) get the same bar insets the page uses, and no keyboard insets:
        // the WebView is already above the keyboard. Zero rather than consumed, so the WebView keeps
        // its inset state up to date (https://issues.chromium.org/issues/461332423).
        return new WindowInsetsCompat.Builder(insets).setInsets(BARS, page).setInsets(IME, Insets.NONE).setVisible(IME, false).build();
    }

    private void publish(Insets page) {
        float density = window.getContext().getResources().getDisplayMetrics().density;
        pendingScript = String.format(
            Locale.US,
            "(function(s){s.setProperty('--safe-area-inset-top','%.2fpx');s.setProperty('--safe-area-inset-right','%.2fpx');" +
            "s.setProperty('--safe-area-inset-bottom','%.2fpx');s.setProperty('--safe-area-inset-left','%.2fpx');})" +
            "(document.documentElement.style);",
            page.top / density,
            page.right / density,
            page.bottom / density,
            page.left / density
        );
        send(pendingScript);
    }

    private void send(String script) {
        if (script.isEmpty() || script.equals(lastScript)) return;
        WebView webView = bridge.getWebView();
        if (webView == null) return;
        lastScript = script;
        webView.post(() -> webView.evaluateJavascript(script, null));
    }
}

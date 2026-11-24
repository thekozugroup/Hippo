package io.github.thekozugroup.hippo;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import java.net.CookieHandler;
import java.net.CookieManager;
import java.net.CookiePolicy;

/**
 * Hippo's only activity: Capacitor's WebView with the web app from the APK.
 *
 * The three small plugins registered here live next to this file:
 * SharedTextPlugin (Android's Share into Hippo), PageFetchPlugin (reading a
 * shop page's name, picture and price) and TouchFeedbackPlugin (haptics).
 * EdgeToEdgeInsets draws the page under both system bars.
 *
 * WebView debugging (chrome://inspect, and the emulator check in the Android
 * workflow) follows the build: Capacitor turns it on only when the app is
 * debuggable, so debug builds allow it and release builds do not.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before the bridge is created in super.onCreate.
        registerPlugin(SharedTextPlugin.class);
        registerPlugin(PageFetchPlugin.class);
        registerPlugin(TouchFeedbackPlugin.class);
        // Android hands the activity its old start intent again after recreating it (the process was
        // stopped in the background) or reopening it from Recents. A share in it was already used, so
        // it is marked before super.onCreate passes it to the plugins.
        SharedTextPlugin.skipRedelivered(getIntent(), savedInstanceState != null);
        super.onCreate(savedInstanceState);
        // Capacitor installs a cookie handler that stores every cookie a native request receives and
        // sends it back later. Hippo uses no cookies, and its native requests (the clock check and
        // shop pages) must not carry or keep any, so native HTTP gets a handler that accepts none.
        // The WebView's own cookie store is separate and unaffected.
        CookieHandler.setDefault(new CookieManager(null, CookiePolicy.ACCEPT_NONE));
        // Edge to edge under transparent system bars, with the bar sizes handed to the page as CSS.
        EdgeToEdgeInsets.install(getWindow(), getBridge());
    }
}

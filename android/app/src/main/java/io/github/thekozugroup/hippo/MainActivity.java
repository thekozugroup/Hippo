package io.github.thekozugroup.hippo;

import android.content.Intent;
import android.net.Uri;
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
 * "Open in the Hippo app" from a browser arrives as hippo://open/<route> (OpenRoute): it is
 * checked here before Capacitor hands it to the web app as appUrlOpen (src/app/native/shell.ts,
 * which checks it again), at a cold start and while running. A route that is not allowed becomes
 * Home; an old intent Android hands back (Recents, a recreated activity) opens nothing.
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
        checkOpenRoute(getIntent(), savedInstanceState != null);
        super.onCreate(savedInstanceState);
        // Capacitor installs a cookie handler that stores every cookie a native request receives and
        // sends it back later. Hippo uses no cookies, and its native requests (the clock check and
        // shop pages) must not carry or keep any, so native HTTP gets a handler that accepts none.
        // The WebView's own cookie store is separate and unaffected.
        CookieHandler.setDefault(new CookieManager(null, CookiePolicy.ACCEPT_NONE));
        // Edge to edge under transparent system bars, with the bar sizes handed to the page as CSS.
        EdgeToEdgeInsets.install(getWindow(), getBridge());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        // The app is running (launchMode singleTask): check the route before the plugins see it.
        checkOpenRoute(intent, false);
        super.onNewIntent(intent);
    }

    /**
     * A hippo:// VIEW intent keeps only an allowed route (anything else becomes Home), and one that
     * Android hands back again opens nothing. Other intents are left alone. Nothing is logged.
     */
    static void checkOpenRoute(Intent intent, boolean restoredFromSavedState) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) return;
        Uri data = intent.getData();
        if (data == null) return;
        String route = OpenRoute.routeOf(data.toString());
        if (route == null) return;
        if (ShareInbox.isRedelivery(intent.getFlags(), restoredFromSavedState)) {
            intent.setData(null);
            return;
        }
        intent.setData(Uri.parse(OpenRoute.addressFor(route)));
    }
}

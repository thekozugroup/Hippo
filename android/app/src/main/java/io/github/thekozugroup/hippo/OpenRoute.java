package io.github.thekozugroup.hippo;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * "Open in the Hippo app" from a browser: an Android intent link opens {@code hippo://open/<route>}
 * here (the VIEW filter in AndroidManifest.xml). This is the app's side of the rules in
 * src/app/lib/app-route.ts, which the web app checks again: only these routes pass, anything else
 * becomes Home.
 *
 * <pre>
 *   /  /wishlist  /lists  /settings   a destination
 *   /l/&lt;payload&gt;                       a shared list
 *   /t/&lt;payload&gt;                       a transfer
 * </pre>
 *
 * A payload is 1 to 4096 characters of A-Z, a-z, 0-9, '_' and '-'. It is a secret (a list's key, or
 * the key to every list): nothing here logs it. Plain Java, no Android types, so it is unit tested on
 * the JVM; MainActivity applies it to intents.
 */
final class OpenRoute {

    static final String SCHEME = "hippo";
    static final String HOST = "open";
    static final String HOME = "/";

    private static final int MAX_CHARS = 8192;
    private static final Pattern ADDRESS = Pattern.compile("(?i)hippo://open(/[^?#]*)?");
    private static final Pattern PAYLOAD_ROUTE = Pattern.compile("/([lt])/([A-Za-z0-9_-]{1,4096})");

    private OpenRoute() {}

    /** Whether an address uses Hippo's own scheme (any case), whatever else it holds. */
    static boolean isHippoAddress(String uri) {
        return uri != null && uri.regionMatches(true, 0, SCHEME + ":", 0, SCHEME.length() + 1);
    }

    /** The route for a path: itself when it is one of the allowed shapes, else Home. */
    static String routeFor(String path) {
        if (path == null || path.isEmpty()) return HOME;
        if (path.length() > MAX_CHARS) return HOME;
        switch (path) {
            case "/":
            case "/wishlist":
            case "/lists":
            case "/settings":
                return path;
            default:
                return PAYLOAD_ROUTE.matcher(path).matches() ? path : HOME;
        }
    }

    /**
     * The route in a {@code hippo:} address: Home unless the address is exactly
     * {@code hippo://open<route>} with an allowed route and no query, fragment, user or port.
     * Null when the address is not a {@code hippo:} one.
     */
    static String routeOf(String uri) {
        if (!isHippoAddress(uri)) return null;
        if (uri.length() > MAX_CHARS) return HOME;
        Matcher m = ADDRESS.matcher(uri);
        if (!m.matches()) return HOME;
        return routeFor(m.group(1));
    }

    /** The address the web app receives for a route: always {@code hippo://open<route>}. */
    static String addressFor(String route) {
        return SCHEME + "://" + HOST + routeFor(route);
    }
}

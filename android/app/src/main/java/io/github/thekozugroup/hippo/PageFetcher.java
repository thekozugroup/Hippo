package io.github.thekozugroup.hippo;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.MalformedURLException;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.UnknownHostException;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.net.ssl.HttpsURLConnection;

/**
 * Fetches one shop page for its name, picture and price. The page and every
 * redirect are hostile input, so:
 *
 * - https only, default port only, no user name or password in the address;
 * - the host must be a public name (the same suffix rules as
 *   src/core/model/validate.ts isPublicHostname) and every address it resolves
 *   to must be public (no loopback, private, link-local, carrier-grade NAT,
 *   multicast or reserved ranges), checked again for each redirect;
 * - at most {@link #MAX_REDIRECTS} redirects, followed by hand;
 * - one deadline for the whole request, redirects included;
 * - at most maxBytes of the body are read; a longer page is cut;
 * - only HTML is read at all; any other type returns an empty body;
 * - no cookies (MainActivity installs a cookie handler that accepts none), no
 *   credentials, no cache.
 *
 * Known limit: the address check and the connection each resolve the name, so
 * a host that answers DNS differently between the two (DNS rebinding) is not
 * caught here. The request carries no cookies or credentials, and the web app
 * reads only the name, picture and price from the answer.
 *
 * Nothing here logs the address or the page.
 */
final class PageFetcher {

    static final int MAX_REDIRECTS = 5;

    /** Why a fetch was refused or failed: "blocked", "timeout" or "network". */
    static final class Failure extends Exception {
        final String code;

        Failure(String code) {
            super(code);
            this.code = code;
        }
    }

    static final class Page {
        final int status;
        final String url;
        final String contentType;
        final String body;
        final boolean truncated;

        Page(int status, String url, String contentType, String body, boolean truncated) {
            this.status = status;
            this.url = url;
            this.contentType = contentType;
            this.body = body;
            this.truncated = truncated;
        }
    }

    /** Resolves a host name; replaced in tests. */
    interface Resolver {
        InetAddress[] resolve(String host) throws UnknownHostException;
    }

    static final Resolver SYSTEM_RESOLVER = InetAddress::getAllByName;

    private static final String[] PRIVATE_SUFFIXES = { "localhost", "local", "localdomain", "internal", "intranet", "lan", "home.arpa" };
    private static final Pattern IPV4_LITERAL = Pattern.compile("^\\d+\\.\\d+\\.\\d+\\.\\d+$");
    private static final Pattern CHARSET = Pattern.compile("charset=\\s*\"?([A-Za-z0-9._:-]{1,40})", Pattern.CASE_INSENSITIVE);

    private PageFetcher() {}

    /** True for a host name that may be on the public internet (no IP literals, a dot, no private suffix). */
    static boolean isPublicHostName(String host) {
        if (host == null) return false;
        String h = host.toLowerCase(Locale.ROOT);
        if (h.endsWith(".")) h = h.substring(0, h.length() - 1);
        if (h.isEmpty() || h.startsWith("[") || h.indexOf(':') >= 0) return false;
        if (IPV4_LITERAL.matcher(h).matches()) return false;
        if (h.indexOf('.') < 0) return false;
        for (String s : PRIVATE_SUFFIXES) {
            if (h.equals(s) || h.endsWith("." + s)) return false;
        }
        return true;
    }

    /** True for an address on the public internet. */
    static boolean isPublicAddress(InetAddress a) {
        if (a == null) return false;
        if (a.isAnyLocalAddress() || a.isLoopbackAddress() || a.isLinkLocalAddress() || a.isSiteLocalAddress() || a.isMulticastAddress()) {
            return false;
        }
        byte[] b = a.getAddress();
        if (a instanceof Inet4Address && b.length == 4) {
            int b0 = b[0] & 0xff;
            int b1 = b[1] & 0xff;
            int b2 = b[2] & 0xff;
            if (b0 == 0 || b0 == 10 || b0 == 127 || b0 >= 224) return false;
            if (b0 == 100 && b1 >= 64 && b1 <= 127) return false; // carrier-grade NAT
            if (b0 == 169 && b1 == 254) return false; // link-local
            if (b0 == 172 && b1 >= 16 && b1 <= 31) return false;
            if (b0 == 192 && b1 == 168) return false;
            if (b0 == 192 && b1 == 0 && b2 == 0) return false;
            if (b0 == 198 && (b1 == 18 || b1 == 19)) return false; // benchmarking
            return true;
        }
        if (a instanceof Inet6Address && b.length == 16) {
            // Only global unicast (2000::/3), as in the web app; not 6to4 (2002::/16) or documentation (2001:db8::/32).
            if ((b[0] & 0xe0) != 0x20) return false;
            if ((b[0] & 0xff) == 0x20 && (b[1] & 0xff) == 0x02) return false;
            if ((b[0] & 0xff) == 0x20 && (b[1] & 0xff) == 0x01 && (b[2] & 0xff) == 0x0d && (b[3] & 0xff) == 0xb8) return false;
            return true;
        }
        return false;
    }

    /** Throws "blocked" unless the address may be fetched: https, default port, no credentials, a public host that resolves to public addresses only. */
    static void check(URL url, Resolver resolver) throws Failure {
        if (!"https".equalsIgnoreCase(url.getProtocol())) throw new Failure("blocked");
        if (url.getUserInfo() != null) throw new Failure("blocked");
        if (url.getPort() != -1 && url.getPort() != 443) throw new Failure("blocked");
        String host = url.getHost();
        if (!isPublicHostName(host)) throw new Failure("blocked");
        InetAddress[] addresses;
        try {
            addresses = resolver.resolve(host);
        } catch (UnknownHostException e) {
            throw new Failure("network");
        }
        if (addresses == null || addresses.length == 0) throw new Failure("network");
        for (InetAddress a : addresses) {
            if (!isPublicAddress(a)) throw new Failure("blocked");
        }
    }

    static boolean isJson(String contentType) {
        if (contentType == null) return false;
        String t = contentType.trim().toLowerCase(Locale.ROOT);
        return t.startsWith("application/json") || t.startsWith("text/json");
    }

    static boolean isHtml(String contentType) {
        if (contentType == null) return false;
        String t = contentType.trim().toLowerCase(Locale.ROOT);
        return t.startsWith("text/html") || t.startsWith("application/xhtml+xml");
    }

    static Charset charsetOf(String contentType) {
        if (contentType != null) {
            Matcher m = CHARSET.matcher(contentType);
            if (m.find()) {
                try {
                    return Charset.forName(m.group(1));
                } catch (RuntimeException ignored) {
                    // Unknown or unsupported: fall back to UTF-8.
                }
            }
        }
        return StandardCharsets.UTF_8;
    }

    private static int remaining(long deadline) throws Failure {
        long left = deadline - System.nanoTime();
        if (left <= 0) throw new Failure("timeout");
        return (int) Math.max(1, Math.min(Integer.MAX_VALUE, left / 1_000_000L));
    }

    static Page fetch(String address, int timeoutMs, int maxBytes, String userAgent, String language, Resolver resolver) throws Failure {
        return fetch(address, timeoutMs, maxBytes, userAgent, language, resolver, false);
    }

    /**
     * With {@code json} true, the one other use: a Hippo website's small hippo.json (the app's
     * "Use my own Hippo site" check). The same rules apply; only JSON is read instead of HTML.
     */
    static Page fetch(String address, int timeoutMs, int maxBytes, String userAgent, String language, Resolver resolver, boolean json) throws Failure {
        long deadline = System.nanoTime() + timeoutMs * 1_000_000L;
        URL url;
        try {
            url = new URL(address);
        } catch (MalformedURLException e) {
            throw new Failure("blocked");
        }
        for (int hop = 0;; hop++) {
            check(url, resolver);
            HttpURLConnection c = null;
            try {
                c = (HttpsURLConnection) url.openConnection();
                c.setInstanceFollowRedirects(false);
                c.setUseCaches(false);
                c.setAllowUserInteraction(false);
                c.setConnectTimeout(remaining(deadline));
                c.setReadTimeout(remaining(deadline));
                c.setRequestProperty("Accept", json ? "application/json" : "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1");
                if (userAgent != null && !userAgent.isEmpty()) c.setRequestProperty("User-Agent", userAgent);
                if (language != null && !language.isEmpty()) c.setRequestProperty("Accept-Language", language);
                int status = c.getResponseCode();
                if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                    String location = c.getHeaderField("Location");
                    if (location == null || hop >= MAX_REDIRECTS) throw new Failure("network");
                    try {
                        url = new URL(url, location);
                    } catch (MalformedURLException e) {
                        throw new Failure("blocked");
                    }
                    continue;
                }
                String type = c.getContentType();
                if (json ? !isJson(type) : !isHtml(type)) return new Page(status, url.toString(), type == null ? "" : type, "", false);
                InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
                if (in == null) return new Page(status, url.toString(), type, "", false);
                ByteArrayOutputStream out = new ByteArrayOutputStream(Math.min(maxBytes, 64 * 1024));
                byte[] buffer = new byte[16 * 1024];
                boolean truncated = false;
                try (InputStream stream = in) {
                    while (true) {
                        remaining(deadline);
                        int room = maxBytes - out.size();
                        if (room <= 0) {
                            truncated = true;
                            break;
                        }
                        int n = stream.read(buffer, 0, Math.min(buffer.length, room));
                        if (n < 0) break;
                        out.write(buffer, 0, n);
                    }
                }
                return new Page(status, url.toString(), type, new String(out.toByteArray(), charsetOf(type)), truncated);
            } catch (SocketTimeoutException e) {
                throw new Failure("timeout");
            } catch (IOException | ClassCastException e) {
                throw new Failure("network");
            } finally {
                if (c != null) c.disconnect();
            }
        }
    }
}
